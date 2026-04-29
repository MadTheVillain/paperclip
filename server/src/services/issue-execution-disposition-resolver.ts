import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  approvals,
  heartbeatRuns,
  issueApprovals,
  issueRelations,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import type {
  IssueExecutionDisposition,
  IssueOriginKind,
  IssueRelationIssueSummary,
  IssueStatus,
} from "@paperclipai/shared";
import {
  isLiveExplicitApprovalWaitingPath,
  isLiveExplicitInteractionWaitingPath,
} from "./recovery/explicit-waiting-paths.js";
import {
  classifyIssueExecutionDisposition,
  type IssueExecutionParticipantState,
  type IssueExecutionRunLivenessState,
  type IssueExecutionRunStatus,
} from "./issue-execution-disposition.js";

const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_WAKE_STATUSES = ["queued", "deferred_issue_execution"] as const;
const PENDING_INTERACTION_STATUSES = ["pending"] as const;
const WAITING_INTERACTION_KINDS = ["request_confirmation", "ask_user_questions", "suggest_tasks"] as const;
const PENDING_APPROVAL_STATUSES = ["pending", "revision_requested"] as const;
const STRANDED_RECOVERY_ORIGIN_KIND = "stranded_issue_recovery" as const;
const HARNESS_LIVENESS_ESCALATION_ORIGIN_KIND = "harness_liveness_escalation" as const;
const PRODUCTIVITY_REVIEW_ORIGIN_KIND = "issue_productivity_review" as const;
const NON_TERMINAL_RECOVERY_STATUSES = ["done", "cancelled"] as const;
const INVOKABLE_AGENT_STATUSES: ReadonlySet<string> = new Set(["active", "idle", "running", "error"]);
const DEFAULT_MAX_CONTINUATION_ATTEMPTS = 2;
const QUERY_CHUNK_SIZE = 500;

export interface IssueExecutionDispositionInputNode {
  id: string;
  companyId: string;
  status: IssueStatus | string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  originKind: IssueOriginKind | string | null;
  executionRunId: string | null;
  executionState?: Record<string, unknown> | null;
  blockedBy?: IssueRelationIssueSummary[];
}

interface ExplicitInteractionRow {
  companyId: string;
  issueId: string;
  status: string;
  createdByUserId: string | null;
  createdAt: Date;
}

interface ExplicitApprovalRow {
  companyId: string;
  issueId: string;
  status: string;
  requestedByUserId: string | null;
  linkedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  linkedAt: Date;
}

interface LatestRunRow {
  issueId: string;
  status: string;
  livenessState: string | null;
  continuationAttempt: number | null;
  contextSnapshot: unknown;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function readPrincipalAgentId(principal: unknown): string | null {
  if (!principal || typeof principal !== "object") return null;
  const value = principal as Record<string, unknown>;
  return value.type === "agent" && typeof value.agentId === "string" && value.agentId.length > 0
    ? value.agentId
    : null;
}

function principalIsResolvableUser(principal: unknown): boolean {
  if (!principal || typeof principal !== "object") return false;
  const value = principal as Record<string, unknown>;
  return value.type === "user" && typeof value.userId === "string" && value.userId.length > 0;
}

function participantStateForExecutionState(
  executionState: Record<string, unknown> | null | undefined,
  agentStatusById: ReadonlyMap<string, string>,
): IssueExecutionParticipantState {
  if (!executionState) return "none";
  const status = (executionState.status as string | undefined) ?? null;
  if (!status || status === "satisfied") return "none";
  const principal = executionState.currentParticipant ?? null;
  if (!principal) return "none";
  const agentId = readPrincipalAgentId(principal);
  if (agentId) {
    const agentStatus = agentStatusById.get(agentId);
    if (agentStatus && INVOKABLE_AGENT_STATUSES.has(agentStatus)) return "valid";
    return "invalid";
  }
  if (principalIsResolvableUser(principal)) return "valid";
  return "invalid";
}

function readNextActionFlag(contextSnapshot: unknown): boolean {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return false;
  const next = (contextSnapshot as Record<string, unknown>).nextAction;
  return typeof next === "string" && next.trim().length > 0;
}

export async function listIssueExecutionDispositionsMap(
  dbOrTx: any,
  companyId: string,
  issueRows: IssueExecutionDispositionInputNode[],
): Promise<Map<string, IssueExecutionDisposition>> {
  const result = new Map<string, IssueExecutionDisposition>();
  const sameCompanyRows = issueRows.filter((row) => row.companyId === companyId);
  if (sameCompanyRows.length === 0) return result;

  const issueIds = sameCompanyRows.map((row) => row.id);

  // The list select drops executionState for performance; rehydrate it from the DB
  // for the issues that actually need participant evidence (in_review).
  const reviewIdsMissingState = sameCompanyRows
    .filter((row) => row.status === "in_review" && row.executionState === undefined)
    .map((row) => row.id);
  const executionStateById = new Map<string, Record<string, unknown> | null>();
  for (const part of chunk(reviewIdsMissingState, QUERY_CHUNK_SIZE)) {
    const rows: Array<{ id: string; executionState: Record<string, unknown> | null }> = await dbOrTx
      .select({ id: issues.id, executionState: issues.executionState })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, part)));
    for (const r of rows) executionStateById.set(r.id, r.executionState ?? null);
  }
  const resolvedExecutionStateFor = (row: IssueExecutionDispositionInputNode) =>
    row.executionState !== undefined ? row.executionState : executionStateById.get(row.id) ?? null;

  const agentIds = new Set<string>();
  for (const row of sameCompanyRows) {
    if (row.assigneeAgentId) agentIds.add(row.assigneeAgentId);
    const state = resolvedExecutionStateFor(row);
    const participant = state?.currentParticipant ?? null;
    const participantAgentId = readPrincipalAgentId(participant);
    if (participantAgentId) agentIds.add(participantAgentId);
  }

  const activeRunIssueIds = new Set<string>();
  const queuedWakeIssueIds = new Set<string>();
  const explicitInteractionLive = new Set<string>();
  const explicitApprovalLive = new Set<string>();
  const openRecoveryIssueOrigins = new Set<string>();
  const openProductivityReviewOrigins = new Set<string>();
  const latestRunByIssueId = new Map<string, LatestRunRow>();

  // Active runs: any heartbeatRun in queued/running referencing the issue via contextSnapshot.
  for (const part of chunk(issueIds, QUERY_CHUNK_SIZE)) {
    const rows: Array<{ issueId: string | null }> = await dbOrTx
      .select({
        issueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, [...ACTIVE_RUN_STATUSES]),
          inArray(sql<string>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`, part),
        ),
      );
    for (const row of rows) {
      if (row.issueId) activeRunIssueIds.add(row.issueId);
    }
  }

  // Active runs by executionRunId — covers cases where the run claimed the issue but the
  // contextSnapshot lookup misses (legacy snapshots).
  const executionRunIds = sameCompanyRows
    .map((row) => row.executionRunId)
    .filter((value): value is string => Boolean(value));
  for (const part of chunk(executionRunIds, QUERY_CHUNK_SIZE)) {
    const rows: Array<{ id: string }> = await dbOrTx
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, [...ACTIVE_RUN_STATUSES]),
          inArray(heartbeatRuns.id, part),
        ),
      );
    if (rows.length === 0) continue;
    const liveExecutionRunIds = new Set(rows.map((row) => row.id));
    for (const row of sameCompanyRows) {
      if (row.executionRunId && liveExecutionRunIds.has(row.executionRunId)) {
        activeRunIssueIds.add(row.id);
      }
    }
  }

  // Queued wakes: agent_wakeup_requests with issueId payload, no runId yet.
  for (const part of chunk(issueIds, QUERY_CHUNK_SIZE)) {
    const rows: Array<{ issueId: string | null }> = await dbOrTx
      .select({
        issueId: sql<string | null>`${agentWakeupRequests.payload} ->> 'issueId'`,
      })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          inArray(agentWakeupRequests.status, [...ACTIVE_WAKE_STATUSES]),
          sql`${agentWakeupRequests.runId} is null`,
          inArray(sql<string>`${agentWakeupRequests.payload} ->> 'issueId'`, part),
        ),
      );
    for (const row of rows) {
      if (row.issueId) queuedWakeIssueIds.add(row.issueId);
    }
  }

  // Pending interactions.
  const interactionsByIssueId = new Map<string, ExplicitInteractionRow[]>();
  for (const part of chunk(issueIds, QUERY_CHUNK_SIZE)) {
    const rows: ExplicitInteractionRow[] = await dbOrTx
      .select({
        companyId: issueThreadInteractions.companyId,
        issueId: issueThreadInteractions.issueId,
        status: issueThreadInteractions.status,
        createdByUserId: issueThreadInteractions.createdByUserId,
        createdAt: issueThreadInteractions.createdAt,
      })
      .from(issueThreadInteractions)
      .where(
        and(
          eq(issueThreadInteractions.companyId, companyId),
          inArray(issueThreadInteractions.status, [...PENDING_INTERACTION_STATUSES]),
          inArray(issueThreadInteractions.kind, [...WAITING_INTERACTION_KINDS]),
          inArray(issueThreadInteractions.issueId, part),
        ),
      );
    for (const row of rows) {
      const list = interactionsByIssueId.get(row.issueId) ?? [];
      list.push(row);
      interactionsByIssueId.set(row.issueId, list);
    }
  }

  // Pending approvals.
  const approvalsByIssueId = new Map<string, ExplicitApprovalRow[]>();
  for (const part of chunk(issueIds, QUERY_CHUNK_SIZE)) {
    const rows: ExplicitApprovalRow[] = await dbOrTx
      .select({
        companyId: issueApprovals.companyId,
        issueId: issueApprovals.issueId,
        status: approvals.status,
        requestedByUserId: approvals.requestedByUserId,
        linkedByUserId: issueApprovals.linkedByUserId,
        createdAt: approvals.createdAt,
        updatedAt: approvals.updatedAt,
        linkedAt: issueApprovals.createdAt,
      })
      .from(issueApprovals)
      .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
      .where(
        and(
          eq(issueApprovals.companyId, companyId),
          inArray(approvals.status, [...PENDING_APPROVAL_STATUSES]),
          inArray(issueApprovals.issueId, part),
        ),
      );
    for (const row of rows) {
      const list = approvalsByIssueId.get(row.issueId) ?? [];
      list.push(row);
      approvalsByIssueId.set(row.issueId, list);
    }
  }

  const now = new Date();
  for (const row of sameCompanyRows) {
    const issueShape = {
      companyId: row.companyId,
      id: row.id,
      assigneeUserId: row.assigneeUserId,
      executionState: resolvedExecutionStateFor(row),
    };
    const interactions = interactionsByIssueId.get(row.id) ?? [];
    if (interactions.some((entry) => isLiveExplicitInteractionWaitingPath(issueShape, entry, now))) {
      explicitInteractionLive.add(row.id);
    }
    const approvalsForIssue = approvalsByIssueId.get(row.id) ?? [];
    if (approvalsForIssue.some((entry) => isLiveExplicitApprovalWaitingPath(issueShape, entry, now))) {
      explicitApprovalLive.add(row.id);
    }
  }

  // Open recovery / harness escalation / productivity review issues whose origin points at our inputs.
  const recoveryOriginKinds = [STRANDED_RECOVERY_ORIGIN_KIND, HARNESS_LIVENESS_ESCALATION_ORIGIN_KIND];
  for (const part of chunk(issueIds, QUERY_CHUNK_SIZE)) {
    const rows: Array<{ originId: string | null }> = await dbOrTx
      .select({ originId: issues.originId })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          inArray(issues.originKind, recoveryOriginKinds),
          isNull(issues.hiddenAt),
          inArray(issues.originId, part),
          notInArray(issues.status, [...NON_TERMINAL_RECOVERY_STATUSES]),
        ),
      );
    for (const r of rows) {
      if (r.originId) openRecoveryIssueOrigins.add(r.originId);
    }
  }
  for (const part of chunk(issueIds, QUERY_CHUNK_SIZE)) {
    const rows: Array<{ originId: string | null }> = await dbOrTx
      .select({ originId: issues.originId })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.originKind, PRODUCTIVITY_REVIEW_ORIGIN_KIND),
          isNull(issues.hiddenAt),
          inArray(issues.originId, part),
          notInArray(issues.status, [...NON_TERMINAL_RECOVERY_STATUSES]),
        ),
      );
    for (const r of rows) {
      if (r.originId) openProductivityReviewOrigins.add(r.originId);
    }
  }

  // Latest issue-linked run, used to populate run evidence.
  const recoveryCandidateIds = sameCompanyRows
    .filter((row) =>
      row.assigneeAgentId &&
      !activeRunIssueIds.has(row.id) &&
      !queuedWakeIssueIds.has(row.id) &&
      (row.status === "todo" || row.status === "in_progress"),
    )
    .map((row) => row.id);
  for (const part of chunk(recoveryCandidateIds, QUERY_CHUNK_SIZE)) {
    const rows: LatestRunRow[] = await dbOrTx
      .select({
        issueId: sql<string>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`,
        status: heartbeatRuns.status,
        livenessState: heartbeatRuns.livenessState,
        continuationAttempt: heartbeatRuns.continuationAttempt,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(sql<string>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`, part),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id));
    for (const row of rows) {
      if (!row.issueId) continue;
      if (latestRunByIssueId.has(row.issueId)) continue;
      latestRunByIssueId.set(row.issueId, row);
    }
  }

  // Agents.
  const agentStatusById = new Map<string, string>();
  if (agentIds.size > 0) {
    const rows: Array<{ id: string; status: string }> = await dbOrTx
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), inArray(agents.id, [...agentIds])));
    for (const r of rows) agentStatusById.set(r.id, r.status);
  }

  for (const row of sameCompanyRows) {
    const agentStatus = row.assigneeAgentId ? agentStatusById.get(row.assigneeAgentId) ?? null : null;
    const latestRun = latestRunByIssueId.get(row.id) ?? null;
    const productivityReviewNeeded = openProductivityReviewOrigins.has(row.id);
    const openRecoveryIssue = openRecoveryIssueOrigins.has(row.id);
    const blockers = (row.blockedBy ?? []).map((blocker) => ({
      issue: {
        id: blocker.id,
        status: blocker.status as IssueStatus,
        assigneeAgentId: blocker.assigneeAgentId ?? null,
        assigneeUserId: blocker.assigneeUserId ?? null,
      },
    }));

    const disposition = classifyIssueExecutionDisposition({
      issue: {
        id: row.id,
        status: row.status as IssueStatus,
        assigneeAgentId: row.assigneeAgentId,
        assigneeUserId: row.assigneeUserId,
        originKind: row.originKind ?? null,
      },
      agent: row.assigneeAgentId
        ? { id: row.assigneeAgentId, status: agentStatus ?? "terminated" }
        : null,
      execution: {
        activeRun: activeRunIssueIds.has(row.id),
        queuedWake: queuedWakeIssueIds.has(row.id),
      },
      waits: {
        participant: participantStateForExecutionState(resolvedExecutionStateFor(row), agentStatusById),
        pendingInteraction: explicitInteractionLive.has(row.id) ? "live" : "none",
        pendingApproval: explicitApprovalLive.has(row.id) ? "live" : "none",
        openRecoveryIssue,
        openProductivityReviewIssue: productivityReviewNeeded,
        productivityReviewNeeded,
      },
      latestRun: latestRun
        ? {
            latestRunStatus: latestRun.status as IssueExecutionRunStatus,
            livenessState: (latestRun.livenessState as IssueExecutionRunLivenessState | null) ?? null,
            nextAction: readNextActionFlag(latestRun.contextSnapshot) ? "runnable" : "none",
            continuationAttempt: latestRun.continuationAttempt,
            maxContinuationAttempts: DEFAULT_MAX_CONTINUATION_ATTEMPTS,
          }
        : null,
      blockers,
    });

    result.set(row.id, disposition);
  }

  return result;
}

// Helper: load blockedBy relation summaries for issues that don't already have them on the input.
export async function backfillBlockedBySummaries(
  dbOrTx: any,
  companyId: string,
  rows: IssueExecutionDispositionInputNode[],
): Promise<void> {
  const needsBackfill = rows.filter((row) => row.status === "blocked" && !row.blockedBy);
  if (needsBackfill.length === 0) return;
  const ids = needsBackfill.map((row) => row.id);
  const blockerRows: Array<{
    issueId: string;
    blockerIssueId: string;
    identifier: string | null;
    title: string;
    status: string;
    priority: string | null;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
  }> = await dbOrTx
    .select({
      issueId: issueRelations.relatedIssueId,
      blockerIssueId: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
    })
    .from(issueRelations)
    .innerJoin(issues, eq(issueRelations.issueId, issues.id))
    .where(
      and(
        eq(issueRelations.companyId, companyId),
        eq(issueRelations.type, "blocks"),
        inArray(issueRelations.relatedIssueId, ids),
        eq(issues.companyId, companyId),
        ne(issues.status, "done"),
      ),
    );
  const blockersByIssueId = new Map<string, IssueRelationIssueSummary[]>();
  for (const row of blockerRows) {
    const list = blockersByIssueId.get(row.issueId) ?? [];
    list.push({
      id: row.blockerIssueId,
      identifier: row.identifier,
      title: row.title,
      status: row.status as IssueStatus,
      priority: (row.priority ?? "medium") as IssueRelationIssueSummary["priority"],
      assigneeAgentId: row.assigneeAgentId,
      assigneeUserId: row.assigneeUserId,
    });
    blockersByIssueId.set(row.issueId, list);
  }
  for (const row of needsBackfill) {
    row.blockedBy = blockersByIssueId.get(row.id) ?? [];
  }
}
