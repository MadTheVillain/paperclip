import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companies,
  createDb,
  memoryExtractionJobs,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
} from "./helpers/embedded-postgres.js";
import { startMemoryJobTestDatabase } from "./helpers/memory-job-test-db.ts";
import { errorHandler } from "../middleware/index.js";
import { memoryJobRoutes } from "../routes/memory-jobs.js";

const logActivityMock = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  logActivity: logActivityMock,
}));

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres memory job route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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

function createApp(db: ReturnType<typeof createDb>, actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as never;
    next();
  });
  app.use("/api", memoryJobRoutes(db as never));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("memory job routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startMemoryJobTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startMemoryJobTestDatabase("paperclip-memory-job-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    logActivityMock.mockReset();
    logActivityMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await db.delete(memoryExtractionJobs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("lists company-scoped jobs with derived stuck-state filters", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const stuckJobId = randomUUID();
    const otherJobId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    await insertCompany(db, companyId);
    await insertCompany(db, otherCompanyId);

    await db.insert(memoryExtractionJobs).values([
      {
        id: stuckJobId,
        companyId,
        bindingId: randomUUID(),
        bindingKey: "primary",
        operationType: "capture",
        status: "running",
        sourceKind: "manual",
        sourceAgentId: agentId,
        sourceIssueId: issueId,
        sourceHeartbeatRunId: runId,
        submittedAt: new Date("2026-04-21T18:00:00.000Z"),
        startedAt: new Date("2026-04-21T18:01:00.000Z"),
        leaseExpiresAt: new Date("2026-04-21T18:05:00.000Z"),
      },
      {
        id: otherJobId,
        companyId: otherCompanyId,
        bindingId: randomUUID(),
        bindingKey: "primary",
        operationType: "capture",
        status: "running",
        sourceKind: "manual",
        sourceAgentId: agentId,
        sourceIssueId: issueId,
        sourceHeartbeatRunId: runId,
        submittedAt: new Date("2026-04-21T18:10:00.000Z"),
        startedAt: new Date("2026-04-21T18:11:00.000Z"),
        leaseExpiresAt: new Date("2026-04-21T18:12:00.000Z"),
      },
    ]);

    const app = createApp(db, {
      type: "board",
      userId: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const res = await request(app).get(
      `/api/companies/${companyId}/memory/jobs?effectiveState=stuck&bindingKey=primary&operationType=capture&agentId=${agentId}&issueId=${issueId}&runId=${runId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.nextOffset).toBeNull();
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0]).toMatchObject({
      id: stuckJobId,
      effectiveState: "stuck",
      sourceAgentId: agentId,
      sourceIssueId: issueId,
      sourceHeartbeatRunId: runId,
    });
  });

  it("rejects ambiguous status and effective-state filters", async () => {
    const companyId = randomUUID();
    await insertCompany(db, companyId);

    const app = createApp(db, {
      type: "board",
      userId: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const res = await request(app).get(
      `/api/companies/${companyId}/memory/jobs?status=succeeded&effectiveState=stuck`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("effectiveState and status cannot be used together");
  });

  it("returns job detail scoped to the requested company", async () => {
    const companyId = randomUUID();
    const jobId = randomUUID();
    await insertCompany(db, companyId);

    await db.insert(memoryExtractionJobs).values({
      id: jobId,
      companyId,
      bindingId: randomUUID(),
      bindingKey: "capture-main",
      operationType: "capture",
      status: "failed",
      sourceKind: "manual",
      submittedAt: new Date("2026-04-21T18:00:00.000Z"),
      finishedAt: new Date("2026-04-21T18:03:00.000Z"),
      errorCode: "provider_error",
      error: "Provider timed out",
    });

    const app = createApp(db, {
      type: "board",
      userId: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const res = await request(app).get(`/api/companies/${companyId}/memory/jobs/${jobId}`);

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({
      id: jobId,
      bindingKey: "capture-main",
      status: "failed",
      effectiveState: "failed",
      errorCode: "provider_error",
      rerunEligible: true,
    });
  });

  it("reruns an eligible job, preserves lineage, and logs activity", async () => {
    const companyId = randomUUID();
    const jobId = randomUUID();
    await insertCompany(db, companyId);

    await db.insert(memoryExtractionJobs).values({
      id: jobId,
      companyId,
      bindingId: randomUUID(),
      bindingKey: "primary",
      operationType: "capture",
      status: "failed",
      sourceKind: "manual",
      submittedAt: new Date("2026-04-21T18:00:00.000Z"),
      finishedAt: new Date("2026-04-21T18:02:00.000Z"),
      costCents: 41,
      resultSummary: "Provider failed",
      errorCode: "provider_error",
      error: "Provider timed out",
    });

    const app = createApp(db, {
      type: "board",
      userId: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .post(`/api/companies/${companyId}/memory/jobs/${jobId}/rerun`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.job).toMatchObject({
      status: "queued",
      bindingKey: "primary",
      retryOfJobId: jobId,
      attemptNumber: 2,
      costCents: 0,
      resultSummary: null,
      errorCode: null,
      error: null,
      rerunEligible: false,
    });
    expect(logActivityMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        companyId,
        action: "memory_job_rerun",
        entityType: "memory_job",
        entityId: res.body.job.id,
        details: expect.objectContaining({
          sourceJobId: jobId,
          retryOfJobId: jobId,
          attemptNumber: 2,
        }),
      }),
    );
  });
});
