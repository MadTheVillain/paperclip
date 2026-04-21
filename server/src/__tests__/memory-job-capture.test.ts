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
import {
  buildSyntheticMemoryBindingId,
  createPostRunMemoryCaptureHandler,
  enqueuePostRunMemoryCaptureJob,
} from "../services/memory-job-capture.ts";
import { createMemoryJobDispatcher } from "../services/memory-job-dispatcher.ts";
import { memoryJobStore } from "../services/memory-job-store.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres memory job capture tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const detail = await store.getDetail(companyId, jobId);
    if (detail?.status === status) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return store.getDetail(companyId, jobId);
}

describeEmbeddedPostgres("memory job capture", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startMemoryJobTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startMemoryJobTestDatabase("paperclip-memory-job-capture-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(memoryExtractionJobs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("enqueues issue-scoped post-run capture jobs with provenance and included run cost", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const projectId = randomUUID();
    const goalId = randomUUID();
    await insertCompany(db, companyId);

    const store = memoryJobStore(db);
    const queued = await enqueuePostRunMemoryCaptureJob({
      store,
      run: {
        id: randomUUID(),
        companyId,
        agentId,
        status: "succeeded",
        invocationSource: "heartbeat",
        triggerDetail: "manual",
        usageJson: {
          provider: "codex",
          biller: "openai",
          model: "o4-mini",
          billingType: "metered_api",
          inputTokens: 120,
          cachedInputTokens: 30,
          outputTokens: 42,
          latencyMs: 88,
          costUsd: 0.12,
          rawInputTokens: 144,
        },
        resultJson: {
          summary: "Implemented the requested memory-job wiring.",
          total_cost_usd: 0.12,
        },
        error: null,
        errorCode: null,
        sessionIdAfter: "codex-session-1",
      },
      sourceIssueId: issueId,
      sourceProjectId: projectId,
      sourceGoalId: goalId,
    });

    expect(queued).toMatchObject({
      companyId,
      bindingId: buildSyntheticMemoryBindingId(companyId, "primary"),
      bindingKey: "primary",
      operationType: "capture",
      status: "queued",
      sourceKind: "run",
      sourceAgentId: agentId,
      sourceIssueId: issueId,
      sourceProjectId: projectId,
      sourceGoalId: goalId,
      hookKind: "post_run_capture",
      attributionMode: "included_in_run",
      costCents: 12,
      resultSummary: "Implemented the requested memory-job wiring.",
    });
    expect(queued.usageJson).toMatchObject({
      provider: "codex",
      biller: "openai",
      model: "o4-mini",
      billingType: "metered_api",
      inputTokens: 120,
      cachedInputTokens: 30,
      outputTokens: 42,
      latencyMs: 88,
      costCents: 12,
      details: {
        rawInputTokens: 144,
      },
    });
    expect(queued.sourceRefJson).toMatchObject({
      invocationSource: "heartbeat",
      triggerDetail: "manual",
      sourceRunStatus: "succeeded",
      sessionIdAfter: "codex-session-1",
    });
    expect(queued.resultJson).toMatchObject({
      captureState: "queued",
      hookKind: "post_run_capture",
      sourceKind: "run",
      sourceRunId: queued.sourceHeartbeatRunId,
      sourceRunStatus: "succeeded",
      sourceSessionIdAfter: "codex-session-1",
      sourceResult: {
        summary: "Implemented the requested memory-job wiring.",
        total_cost_usd: 0.12,
      },
    });
  });

  it("supports direct-billed capture overrides and reruns capture-originated jobs", async () => {
    const companyId = randomUUID();
    const runId = randomUUID();
    await insertCompany(db, companyId);

    const store = memoryJobStore(db);
    const queued = await enqueuePostRunMemoryCaptureJob({
      store,
      run: {
        id: runId,
        companyId,
        agentId: randomUUID(),
        status: "succeeded",
        invocationSource: "heartbeat",
        triggerDetail: "issue_assigned",
        usageJson: null,
        resultJson: {
          summary: "Posted a concise issue handoff.",
        },
        error: null,
        errorCode: null,
        sessionIdAfter: null,
      },
      sourceIssueId: randomUUID(),
      sourceProjectId: randomUUID(),
      sourceGoalId: randomUUID(),
      attributionMode: "billed_directly",
      costCents: 31,
      usageJson: {
        provider: "memory-provider",
        biller: "memory-provider",
        model: "capture-v1",
        billingType: "metered_api",
        inputTokens: 11,
        outputTokens: 5,
        costCents: 31,
        latencyMs: 54,
      },
    });

    const dispatcher = createMemoryJobDispatcher({
      store,
      resolveHandler: () => createPostRunMemoryCaptureHandler(),
    });

    await dispatcher.tick();

    const completed = await waitForJobStatus(store, companyId, queued.id, "succeeded");
    expect(completed).toMatchObject({
      id: queued.id,
      status: "succeeded",
      effectiveState: "succeeded",
      attributionMode: "billed_directly",
      costCents: 31,
      resultSummary: "Posted a concise issue handoff.",
    });
    expect(completed?.usageJson).toMatchObject({
      provider: "memory-provider",
      model: "capture-v1",
      costCents: 31,
    });
    expect(completed?.resultJson).toMatchObject({
      captureState: "succeeded",
      sourceRunId: runId,
      persistedUsageSummary: true,
    });

    const rerun = await store.rerun(companyId, queued.id, {
      now: new Date("2026-04-21T22:00:00.000Z"),
    });

    expect(rerun).toMatchObject({
      status: "queued",
      retryOfJobId: queued.id,
      attemptNumber: 2,
      sourceKind: "run",
      hookKind: "post_run_capture",
      sourceHeartbeatRunId: runId,
      bindingKey: "primary",
      attributionMode: "billed_directly",
    });
  });
});
