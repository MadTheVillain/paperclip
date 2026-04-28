import type { ActivityEvent } from "@paperclipai/shared";

export interface IssueTimelineAssignee {
  agentId: string | null;
  userId: string | null;
}

type IssueTreeHoldTimelineAction = "paused" | "resumed" | "cancelled" | "restored";

export interface IssueTimelineEvent {
  id: string;
  createdAt: Date | string;
  actorType: ActivityEvent["actorType"];
  actorId: string;
  treeHoldChange?: {
    action: IssueTreeHoldTimelineAction;
    mode: string | null;
    reason: string | null;
  };
  statusChange?: {
    from: string | null;
    to: string | null;
  };
  assigneeChange?: {
    from: IssueTimelineAssignee;
    to: IssueTimelineAssignee;
  };
  commentId?: string | null;
  followUpRequested?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function treeHoldAction(eventAction: string, mode: string | null): IssueTreeHoldTimelineAction | null {
  if (eventAction === "issue.tree_hold_created") return mode === "cancel" ? "cancelled" : "paused";
  if (eventAction === "issue.tree_hold_released") return mode === "cancel" ? "restored" : "resumed";
  return null;
}

function toTimestamp(value: Date | string) {
  return new Date(value).getTime();
}

function sameAssignee(left: IssueTimelineAssignee, right: IssueTimelineAssignee) {
  return left.agentId === right.agentId && left.userId === right.userId;
}

export function formatIssueTimelineTreeHoldAction(event: IssueTimelineEvent): string | null {
  const action = event.treeHoldChange?.action;
  if (!action) return null;
  if (action === "paused") return "paused work";
  if (action === "resumed") return "resumed work";
  if (action === "cancelled") return "cancelled this subtree";
  return "restored this subtree";
}

function sortTimelineEvents<T extends { createdAt: Date | string; id: string }>(events: T[]) {
  return [...events].sort((a, b) => {
    const createdAtDiff = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });
}

export function extractIssueTimelineEvents(activity: ActivityEvent[] | null | undefined): IssueTimelineEvent[] {
  const events: IssueTimelineEvent[] = [];

  for (const event of activity ?? []) {
    const details = asRecord(event.details);
    if (!details) continue;

    if (event.action === "issue.comment_added") {
      if (details.followUpRequested !== true && details.resumeIntent !== true) continue;
      if (details.reopened === true) continue;
      const commentId = nullableString(details.commentId);
      events.push({
        id: event.id,
        createdAt: event.createdAt,
        actorType: event.actorType,
        actorId: event.actorId,
        commentId,
        followUpRequested: true,
      });
      continue;
    }

    if (event.action === "issue.tree_hold_created" || event.action === "issue.tree_hold_released") {
      const mode = nullableString(details.mode);
      const action = treeHoldAction(event.action, mode);
      if (!action) continue;
      events.push({
        id: event.id,
        createdAt: event.createdAt,
        actorType: event.actorType,
        actorId: event.actorId,
        treeHoldChange: {
          action,
          mode,
          reason: nullableString(details.reason),
        },
      });
      continue;
    }

    if (event.action !== "issue.updated") continue;

    const previous = asRecord(details._previous);
    const timelineEvent: IssueTimelineEvent = {
      id: event.id,
      createdAt: event.createdAt,
      actorType: event.actorType,
      actorId: event.actorId,
    };
    if (details.followUpRequested === true || details.resumeIntent === true) {
      timelineEvent.followUpRequested = true;
      timelineEvent.commentId = nullableString(details.commentId);
    }

    if (hasOwn(details, "status")) {
      const from = nullableString(previous?.status) ?? nullableString(details.reopenedFrom);
      const to = nullableString(details.status);
      if (from !== to) {
        timelineEvent.statusChange = { from, to };
      }
    }

    if (hasOwn(details, "assigneeAgentId") || hasOwn(details, "assigneeUserId")) {
      const previousAssignee: IssueTimelineAssignee = {
        agentId: nullableString(previous?.assigneeAgentId),
        userId: nullableString(previous?.assigneeUserId),
      };
      const nextAssignee: IssueTimelineAssignee = {
        agentId: hasOwn(details, "assigneeAgentId")
          ? nullableString(details.assigneeAgentId)
          : previousAssignee.agentId,
        userId: hasOwn(details, "assigneeUserId")
          ? nullableString(details.assigneeUserId)
          : previousAssignee.userId,
      };

      if (!sameAssignee(previousAssignee, nextAssignee)) {
        timelineEvent.assigneeChange = {
          from: previousAssignee,
          to: nextAssignee,
        };
      }
    }

    if (timelineEvent.statusChange || timelineEvent.assigneeChange || timelineEvent.followUpRequested) {
      events.push(timelineEvent);
    }
  }

  return sortTimelineEvents(events);
}
