import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  memoryExtractionJobs,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
} from "./helpers/embedded-postgres.js";
import { startMemoryJobTestDatabase } from "./helpers/memory-job-test-db.ts";
import { createMemoryJobDispatcher } from "../services/memory-job-dispatcher.ts";
import { memoryJobStore } from "../services/memory-job-store.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres memory job dispatcher tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function insertCompany(db: ReturnType<typeof createDb>, companyId: string) {
  await db.insert(companies).values({
    id: companyId,
    name: "Paperclip",
    issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    requireBoardApprovalForNewAgents: false,
  });
}

async function waitForJobStatus(
  store: ReturnType<typeof memoryJobStore>,
  companyId: string,
  jobId: string,
  status: string,
  now: Date,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const detail = await store.getDetail(companyId, jobId, { now });
    if (detail?.status === status) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return store.getDetail(companyId, jobId, { now });
}

describeEmbeddedPostgres("memory job dispatcher", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startMemoryJobTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startMemoryJobTestDatabase("paperclip-memory-job-dispatcher-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(memoryExtractionJobs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("claims queued jobs and completes them with handler output", async () => {
    const companyId = randomUUID();
    let currentTime = new Date("2026-04-21T20:00:00.000Z");
    await insertCompany(db, companyId);

    const store = memoryJobStore(db);
    const queued = await store.enqueue({
      companyId,
      bindingId: randomUUID(),
      bindingKey: "primary",
      operationType: "capture",
      sourceKind: "manual",
    });

    const dispatcher = createMemoryJobDispatcher({
      store,
      now: () => currentTime,
      resolveHandler: () => async () => ({
        outcome: "succeeded",
        providerJobId: "provider-job-1",
        resultSummary: "Captured 3 records",
        costCents: 7,
        usageJson: {
          provider: "test-provider",
          model: "test-model",
          inputTokens: 10,
          outputTokens: 4,
          latencyMs: 55,
        },
        resultJson: { recordsCaptured: 3 },
      }),
    });

    await dispatcher.tick();

    const detail = await waitForJobStatus(store, companyId, queued.id, "succeeded", currentTime);

    expect(detail).toMatchObject({
      id: queued.id,
      status: "succeeded",
      effectiveState: "succeeded",
      providerJobId: "provider-job-1",
      resultSummary: "Captured 3 records",
      costCents: 7,
    });
    expect(detail?.usageJson).toMatchObject({
      provider: "test-provider",
      model: "test-model",
      inputTokens: 10,
      outputTokens: 4,
      latencyMs: 55,
    });
    expect(detail?.resultJson).toEqual({ recordsCaptured: 3 });
  });

  it("keeps provider-managed jobs running until the recovery sweep expires their lease", async () => {
    const companyId = randomUUID();
    let currentTime = new Date("2026-04-21T21:00:00.000Z");
    await insertCompany(db, companyId);

    const store = memoryJobStore(db);
    const queued = await store.enqueue({
      companyId,
      bindingId: randomUUID(),
      bindingKey: "primary",
      operationType: "capture",
      sourceKind: "manual",
    });

    const dispatcher = createMemoryJobDispatcher({
      store,
      now: () => currentTime,
      leaseDurationMs: 5_000,
      resolveHandler: () => async () => ({
        outcome: "running",
        providerJobId: "provider-job-async",
        resultSummary: "Submitted to provider",
        leaseDurationMs: 1_000,
        resultJson: { submitted: true },
      }),
    });

    await dispatcher.tick();

    const runningDetail = await waitForJobStatus(store, companyId, queued.id, "running", currentTime);
    expect(runningDetail).toMatchObject({
      id: queued.id,
      status: "running",
      effectiveState: "running",
      providerJobId: "provider-job-async",
      resultSummary: "Submitted to provider",
    });

    currentTime = new Date("2026-04-21T21:00:02.000Z");

    const staleDetail = await store.getDetail(companyId, queued.id, { now: currentTime });
    expect(staleDetail).toMatchObject({
      id: queued.id,
      status: "running",
      effectiveState: "stuck",
    });

    const recovery = await dispatcher.sweepExpiredLeases();
    const recoveredDetail = await store.getDetail(companyId, queued.id, { now: currentTime });

    expect(recovery).toEqual({ recovered: 1, jobIds: [queued.id] });
    expect(recoveredDetail).toMatchObject({
      id: queued.id,
      status: "failed",
      effectiveState: "failed",
      errorCode: "lease_expired",
      error: "Memory job lease expired before completion",
      providerJobId: "provider-job-async",
    });
  });
});
