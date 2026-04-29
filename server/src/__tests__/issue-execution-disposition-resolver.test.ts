import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  approvals,
  companies,
  createDb,
  heartbeatRuns,
  issueApprovals,
  issueRelations,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  backfillBlockedBySummaries,
  listIssueExecutionDispositionsMap,
} from "../services/issue-execution-disposition-resolver.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres execution-disposition resolver tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("issue execution disposition resolver", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-execution-disposition-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issueThreadInteractions);
    await db.delete(issueApprovals);
    await db.delete(approvals);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed(prefix = "DSP") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Company ${prefix}`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `${prefix} Agent`,
      role: "engineer",
      status: "idle",
    });
    return { companyId, agentId };
  }

  async function insertIssue(input: {
    companyId: string;
    identifier: string;
    title: string;
    status: string;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    originKind?: string | null;
  }) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId: input.companyId,
      identifier: input.identifier,
      title: input.title,
      status: input.status,
      priority: "medium",
      assigneeAgentId: input.assigneeAgentId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      originKind: input.originKind ?? "manual",
    });
    return id;
  }

  function inputFor(input: {
    id: string;
    companyId: string;
    status: string;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    originKind?: string | null;
  }) {
    return {
      id: input.id,
      companyId: input.companyId,
      status: input.status,
      assigneeAgentId: input.assigneeAgentId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      originKind: input.originKind ?? "manual",
      executionRunId: null as string | null,
      executionState: null as Record<string, unknown> | null,
    };
  }

  it("classifies an idle agent-owned todo as dispatchable", async () => {
    const { companyId, agentId } = await seed();
    const issueId = await insertIssue({
      companyId,
      identifier: "DSP-1",
      title: "Ready",
      status: "todo",
      assigneeAgentId: agentId,
    });
    const map = await listIssueExecutionDispositionsMap(db, companyId, [
      inputFor({ id: issueId, companyId, status: "todo", assigneeAgentId: agentId }),
    ]);
    const disposition = map.get(issueId);
    expect(disposition?.kind).toBe("dispatchable");
  });

  it("classifies an in_progress issue with an active heartbeat run as live", async () => {
    const { companyId, agentId } = await seed();
    const issueId = await insertIssue({
      companyId,
      identifier: "DSP-2",
      title: "Running",
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      contextSnapshot: { issueId },
    });

    const map = await listIssueExecutionDispositionsMap(db, companyId, [
      inputFor({ id: issueId, companyId, status: "in_progress", assigneeAgentId: agentId }),
    ]);
    expect(map.get(issueId)?.kind).toBe("live");
  });

  it("classifies a pending interaction as waiting on interaction", async () => {
    const { companyId, agentId } = await seed();
    const issueId = await insertIssue({
      companyId,
      identifier: "DSP-3",
      title: "Waiting on confirmation",
      status: "in_review",
      assigneeAgentId: agentId,
    });
    await db.insert(issueThreadInteractions).values({
      id: randomUUID(),
      companyId,
      issueId,
      kind: "request_confirmation",
      status: "pending",
      payload: { target: { type: "issue_document", key: "plan", revisionId: "r1" } },
      createdByAgentId: agentId,
    });

    const map = await listIssueExecutionDispositionsMap(db, companyId, [
      inputFor({ id: issueId, companyId, status: "in_review", assigneeAgentId: agentId }),
    ]);
    const disposition = map.get(issueId);
    expect(disposition?.kind).toBe("waiting");
    if (disposition?.kind === "waiting") {
      expect(disposition.path).toBe("interaction");
    }
  });

  it("flags an in_review issue without any action path as invalid", async () => {
    const { companyId, agentId } = await seed();
    const issueId = await insertIssue({
      companyId,
      identifier: "DSP-4",
      title: "Stalled review",
      status: "in_review",
      assigneeAgentId: agentId,
    });
    const map = await listIssueExecutionDispositionsMap(db, companyId, [
      inputFor({ id: issueId, companyId, status: "in_review", assigneeAgentId: agentId }),
    ]);
    const disposition = map.get(issueId);
    expect(disposition?.kind).toBe("invalid");
    if (disposition?.kind === "invalid") {
      expect(disposition.reason).toBe("in_review_without_action_path");
    }
  });

  it("classifies a blocked issue with a healthy chain leaf as waiting on blocker chain", async () => {
    const { companyId, agentId } = await seed();
    const blockerId = await insertIssue({
      companyId,
      identifier: "DSP-5b",
      title: "Blocker",
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    const blockedId = await insertIssue({
      companyId,
      identifier: "DSP-5",
      title: "Blocked",
      status: "blocked",
      assigneeAgentId: agentId,
    });
    await db.insert(issueRelations).values({
      id: randomUUID(),
      companyId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      contextSnapshot: { issueId: blockerId },
    });

    const inputs = [
      inputFor({ id: blockedId, companyId, status: "blocked", assigneeAgentId: agentId }),
    ];
    await backfillBlockedBySummaries(db, companyId, inputs);
    const map = await listIssueExecutionDispositionsMap(db, companyId, inputs);
    const disposition = map.get(blockedId);
    expect(disposition?.kind).toBe("waiting");
    if (disposition?.kind === "waiting") {
      expect(disposition.path).toBe("blocker_chain");
    }
  });

  it("flags a blocked issue with a cancelled blocker as invalid", async () => {
    const { companyId, agentId } = await seed();
    const blockerId = await insertIssue({
      companyId,
      identifier: "DSP-6b",
      title: "Cancelled blocker",
      status: "cancelled",
      assigneeAgentId: agentId,
    });
    const blockedId = await insertIssue({
      companyId,
      identifier: "DSP-6",
      title: "Blocked by cancelled",
      status: "blocked",
      assigneeAgentId: agentId,
    });
    await db.insert(issueRelations).values({
      id: randomUUID(),
      companyId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });

    const inputs = [
      inputFor({ id: blockedId, companyId, status: "blocked", assigneeAgentId: agentId }),
    ];
    await backfillBlockedBySummaries(db, companyId, inputs);
    const map = await listIssueExecutionDispositionsMap(db, companyId, inputs);
    const disposition = map.get(blockedId);
    // The cancelled blocker is filtered out by ne(status, "done") + companyId checks; backfill
    // excludes it because it's not "open". So the issue ends up blocked-without-an-action-path,
    // which is also invalid. Either invalid form is acceptable here; assert the kind only.
    expect(disposition?.kind).toBe("invalid");
  });
});
