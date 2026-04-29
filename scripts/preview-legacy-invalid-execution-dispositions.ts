type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";

type InvalidDisposition = {
  kind: "invalid";
  reason: string;
  suggestedCorrection: string;
};

type IssueSummary = {
  id: string;
  identifier?: string | null;
  title: string;
  status: IssueStatus;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  executionDisposition?: { kind: string } | InvalidDisposition;
  blockerAttention?: {
    state?: string | null;
    reason?: string | null;
    sampleBlockerIdentifier?: string | null;
    sampleStalledBlockerIdentifier?: string | null;
    nextActionOwner?: unknown;
    nextActionHint?: string | null;
  } | null;
  blockedBy?: Array<{
    id: string;
    identifier?: string | null;
    title: string;
    status: IssueStatus;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
  }>;
};

type PreviewGroup = {
  reason: string;
  suggestedCorrection: string;
  status: string;
  owner: string;
  blockerAttentionSample: string;
  proposedAction: string;
  issues: IssueSummary[];
};

const NON_TERMINAL_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;
const PAGE_LIMIT = 1000;
const DEFAULT_LOOKBACK_HOURS = 48;

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function requireConfig(name: string, value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function readPositiveIntegerFlag(name: string): number | null {
  const raw = readFlag(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function dateValue(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function issueScopeTimestamp(issue: IssueSummary): Date | null {
  return dateValue(issue.updatedAt) ?? dateValue(issue.createdAt);
}

function filterIssuesByLookback(issues: IssueSummary[], cutoff: Date | null): IssueSummary[] {
  if (!cutoff) return issues;
  return issues.filter((issue) => {
    const timestamp = issueScopeTimestamp(issue);
    return timestamp ? timestamp >= cutoff : false;
  });
}

function ownerKey(issue: IssueSummary): string {
  if (issue.assigneeAgentId && issue.assigneeUserId) {
    return `dual:agent:${issue.assigneeAgentId}:user:${issue.assigneeUserId}`;
  }
  if (issue.assigneeAgentId) return `agent:${issue.assigneeAgentId}`;
  if (issue.assigneeUserId) return `user:${issue.assigneeUserId}`;
  return "unassigned";
}

function blockerOwnerKey(issue: IssueSummary): string {
  if (issue.assigneeAgentId) return `agent:${issue.assigneeAgentId}`;
  if (issue.assigneeUserId) return `user:${issue.assigneeUserId}`;
  return "unassigned";
}

function sampleValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string" && typeof record.agentId === "string") {
      return `${record.type}:${record.agentId}`;
    }
    if (typeof record.type === "string" && typeof record.userId === "string") {
      return `${record.type}:${record.userId}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function blockerAttentionSample(issue: IssueSummary): string {
  const attention = issue.blockerAttention;
  if (attention && attention.state && attention.state !== "none") {
    const parts = [
      attention.state,
      attention.reason,
      attention.sampleBlockerIdentifier ? `sample:${attention.sampleBlockerIdentifier}` : null,
      attention.sampleStalledBlockerIdentifier ? `stalled:${attention.sampleStalledBlockerIdentifier}` : null,
      attention.nextActionOwner ? `owner:${sampleValue(attention.nextActionOwner)}` : null,
      attention.nextActionHint ? `hint:${attention.nextActionHint}` : null,
    ].filter(Boolean);
    return parts.join(" ");
  }

  const sampleBlocker = issue.blockedBy?.[0];
  if (sampleBlocker) {
    return `blocker:${sampleBlocker.identifier ?? sampleBlocker.id} status:${sampleBlocker.status} owner:${blockerOwnerKey(sampleBlocker)}`;
  }

  return "none";
}

function hasSafeCancelledBlockerCorrection(issue: IssueSummary): boolean {
  if (issue.status !== "blocked") return false;
  const blockers = issue.blockedBy ?? [];
  const cancelledBlockerCount = blockers.filter((blocker) => blocker.status === "cancelled").length;
  const remainingUnresolvedBlockerCount = blockers.filter(
    (blocker) => blocker.status !== "cancelled" && blocker.status !== "done",
  ).length;
  return cancelledBlockerCount > 0 && remainingUnresolvedBlockerCount > 0;
}

function proposedAction(reason: string, issue: IssueSummary): string {
  if (reason === "blocked_by_cancelled_issue" && hasSafeCancelledBlockerCorrection(issue)) {
    return "apply-safe: remove cancelled blocker links while preserving remaining unresolved blockers";
  }
  switch (reason) {
    case "dual_assignee":
      return "follow-up: choose exactly one owner and clear the other assignee";
    case "invalid_review_participant":
      return "follow-up: repair the execution participant or replace it with a live wait path";
    case "in_review_without_action_path":
      return "follow-up: add a typed review/approval/interaction, assign a human owner, or move to an actionable status";
    case "blocked_by_invalid_issue":
      return "follow-up: repair the invalid blocker leaf first";
    case "blocked_by_cancelled_issue":
      return "follow-up: replace the cancelled blocker or define a new owner/action path";
    case "blocked_by_unassigned_issue":
      return "follow-up: assign the blocker, replace it, or escalate to a human owner";
    case "blocked_by_resting_issue":
      return "follow-up: give the blocker a lawful next action, replace it, or escalate";
    case "blocked_without_action_path":
      return "follow-up: add first-class blockers, a live wait primitive, or an external owner/action";
    default:
      return "follow-up: inspect and define the lawful next action";
  }
}

async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(path, apiUrl);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(runId ? { "X-Paperclip-Run-Id": runId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url.pathname}${url.search} failed: ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

async function listNonTerminalIssues(companyId: string): Promise<IssueSummary[]> {
  const result: IssueSummary[] = [];
  for (const status of NON_TERMINAL_STATUSES) {
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const query = new URLSearchParams({
        status,
        includeBlockedBy: "true",
        limit: String(PAGE_LIMIT),
        offset: String(offset),
      });
      const page = await requestJson<IssueSummary[]>("GET", `/api/companies/${companyId}/issues?${query}`);
      result.push(...page);
      if (page.length < PAGE_LIMIT) break;
    }
  }
  return result;
}

function buildGroups(issues: IssueSummary[]): PreviewGroup[] {
  const groups = new Map<string, PreviewGroup>();
  for (const issue of issues) {
    const disposition = issue.executionDisposition;
    if (disposition?.kind !== "invalid") continue;
    const invalid = disposition as InvalidDisposition;
    const action = proposedAction(invalid.reason, issue);
    const sample = blockerAttentionSample(issue);
    const key = [
      invalid.reason,
      invalid.suggestedCorrection,
      issue.status,
      ownerKey(issue),
      sample,
      action,
    ].join("\u0000");
    const existing = groups.get(key);
    if (existing) {
      existing.issues.push(issue);
    } else {
      groups.set(key, {
        reason: invalid.reason,
        suggestedCorrection: invalid.suggestedCorrection,
        status: issue.status,
        owner: ownerKey(issue),
        blockerAttentionSample: sample,
        proposedAction: action,
        issues: [issue],
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    const byReason = a.reason.localeCompare(b.reason);
    if (byReason !== 0) return byReason;
    const byStatus = a.status.localeCompare(b.status);
    if (byStatus !== 0) return byStatus;
    return b.issues.length - a.issues.length;
  });
}

function formatIssue(issue: IssueSummary): string {
  return `${issue.identifier ?? issue.id} (${issue.status}, ${ownerKey(issue)}): ${issue.title}`;
}

function printPreview(
  companyId: string,
  totalFetched: number,
  totalScanned: number,
  cutoff: Date | null,
  groups: PreviewGroup[],
  appliedCount: number,
) {
  const invalidCount = groups.reduce((sum, group) => sum + group.issues.length, 0);
  const safeCandidateCount = groups.reduce(
    (sum, group) => sum + group.issues.filter(hasSafeCancelledBlockerCorrection).length,
    0,
  );
  const byReason = new Map<string, number>();
  for (const group of groups) {
    byReason.set(group.reason, (byReason.get(group.reason) ?? 0) + group.issues.length);
  }

  console.log(`# Legacy execution-disposition reconciliation preview`);
  console.log("");
  console.log(`Company: ${companyId}`);
  console.log(`Lookback: ${cutoff ? `updated since ${cutoff.toISOString()}` : "all non-terminal issues"}`);
  console.log(`Non-terminal issues fetched: ${totalFetched}`);
  console.log(`Non-terminal issues scanned: ${totalScanned}`);
  console.log(`Invalid issues found: ${invalidCount}`);
  console.log(`Safe cancelled-blocker corrections available: ${safeCandidateCount}`);
  console.log(`Safe corrections applied: ${appliedCount}`);
  console.log("");
  if (groups.length === 0) {
    console.log("No invalid non-terminal issue dispositions found.");
    return;
  }

  console.log("## Counts by invalid reason");
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`- ${reason}: ${count}`);
  }
  console.log("");

  for (const group of groups) {
    console.log(`## ${group.reason} (${group.issues.length})`);
    console.log(`- Status: ${group.status}`);
    console.log(`- Owner: ${group.owner}`);
    console.log(`- Blocker-attention sample: ${group.blockerAttentionSample}`);
    console.log(`- Suggested correction: ${group.suggestedCorrection}`);
    console.log(`- Proposed action: ${group.proposedAction}`);
    console.log("- Sample issues:");
    for (const issue of group.issues.slice(0, 5)) {
      console.log(`  - ${formatIssue(issue)}`);
    }
    if (group.issues.length > 5) {
      console.log(`  - ... ${group.issues.length - 5} more`);
    }
    console.log("");
  }
}

async function applySafeCorrections(groups: PreviewGroup[]): Promise<number> {
  let applied = 0;
  for (const group of groups) {
    for (const issue of group.issues) {
      if (!hasSafeCancelledBlockerCorrection(issue)) continue;
      const remainingBlockerIds = (issue.blockedBy ?? [])
        .filter((blocker) => blocker.status !== "cancelled" && blocker.status !== "done")
        .map((blocker) => blocker.id);
      if (remainingBlockerIds.length === 0) continue;
      await requestJson("PATCH", `/api/issues/${issue.id}`, {
        blockedByIssueIds: remainingBlockerIds,
        comment:
          "Legacy execution-disposition reconciliation: removed cancelled blocker links while preserving remaining unresolved blockers.",
      });
      applied += 1;
    }
  }
  return applied;
}

const apiUrl = requireConfig(
  "PAPERCLIP_API_URL or --api-url",
  readFlag("--api-url") ?? process.env.PAPERCLIP_API_URL,
);
const apiKey = requireConfig("PAPERCLIP_API_KEY", process.env.PAPERCLIP_API_KEY);
const runId = process.env.PAPERCLIP_RUN_ID?.trim();

async function main() {
  const companyId = requireConfig(
    "PAPERCLIP_COMPANY_ID or --company",
    readFlag("--company") ?? process.env.PAPERCLIP_COMPANY_ID,
  );
  const applySafe = process.argv.includes("--apply-safe");
  const allIssues = process.argv.includes("--all");
  const lookbackHours = allIssues ? null : (readPositiveIntegerFlag("--since-hours") ?? DEFAULT_LOOKBACK_HOURS);
  const cutoff = lookbackHours === null ? null : new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  let fetchedIssues = await listNonTerminalIssues(companyId);
  let issues = filterIssuesByLookback(fetchedIssues, cutoff);
  let groups = buildGroups(issues);
  let appliedCount = 0;

  if (applySafe) {
    appliedCount = await applySafeCorrections(groups);
    fetchedIssues = await listNonTerminalIssues(companyId);
    issues = filterIssuesByLookback(fetchedIssues, cutoff);
    groups = buildGroups(issues);
  }

  printPreview(companyId, fetchedIssues.length, issues.length, cutoff, groups, appliedCount);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Legacy execution-disposition reconciliation preview failed: ${message}`);
  process.exitCode = 1;
});
