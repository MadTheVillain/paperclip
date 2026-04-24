/**
 * Canonical status & priority color definitions.
 *
 * Every component that renders a status indicator (StatusIcon, StatusBadge,
 * agent status dots, etc.) should import from here so colors stay consistent.
 */

// ---------------------------------------------------------------------------
// Issue status colors
// ---------------------------------------------------------------------------

/** StatusIcon circle: text + border classes */
export const issueStatusIcon: Record<string, string> = {
  backlog: "text-muted-foreground border-muted-foreground",
  todo: "text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400",
  in_progress: "text-yellow-600 border-yellow-600 dark:text-yellow-400 dark:border-yellow-400",
  in_review: "text-violet-600 border-violet-600 dark:text-violet-400 dark:border-violet-400",
  done: "text-green-600 border-green-600 dark:text-green-400 dark:border-green-400",
  cancelled: "text-neutral-500 border-neutral-500",
  blocked: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
};

export const issueStatusIconDefault = "text-muted-foreground border-muted-foreground";

/** Text-only color for issue statuses (dropdowns, labels) */
export const issueStatusText: Record<string, string> = {
  backlog: "text-muted-foreground",
  todo: "text-blue-600 dark:text-blue-400",
  in_progress: "text-yellow-600 dark:text-yellow-400",
  in_review: "text-violet-600 dark:text-violet-400",
  done: "text-green-600 dark:text-green-400",
  cancelled: "text-neutral-500",
  blocked: "text-red-600 dark:text-red-400",
};

export const issueStatusTextDefault = "text-muted-foreground";

// ---------------------------------------------------------------------------
// Badge colors — used by StatusBadge for all entity types
// ---------------------------------------------------------------------------

export const statusBadge: Record<string, string> = {
  // Agent statuses
  active: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  running: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  scheduled_retry: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  idle: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
  archived: "bg-muted text-muted-foreground",

  // Goal statuses
  planned: "bg-muted text-muted-foreground",
  achieved: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",

  // Run statuses
  failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  timed_out: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  succeeded: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  terminated: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",

  // Approval statuses
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  revision_requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",

  // Issue statuses — consistent hues with issueStatusIcon above
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  in_progress: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
  in_review: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground",
};

export const statusBadgeDefault = "bg-muted text-muted-foreground";

// ---------------------------------------------------------------------------
// Agent status dot — solid background for small indicator dots
// ---------------------------------------------------------------------------

export const agentStatusDot: Record<string, string> = {
  running: "bg-cyan-400 animate-pulse",
  active: "bg-green-400",
  paused: "bg-yellow-400",
  idle: "bg-yellow-400",
  pending_approval: "bg-amber-400",
  error: "bg-red-400",
  archived: "bg-neutral-400",
};

export const agentStatusDotDefault = "bg-neutral-400";

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

export const priorityColor: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low: "text-blue-600 dark:text-blue-400",
};

export const priorityColorDefault = "text-yellow-600 dark:text-yellow-400";

// ---------------------------------------------------------------------------
// External object status — colors & severity ranking
// ---------------------------------------------------------------------------
//
// Categories come from `EXTERNAL_OBJECT_STATUS_CATEGORIES` in @paperclipai/shared.
// The map keys here intentionally mirror the union — keep them in sync.
//
// Tone reuse rationale (see UX spec §1):
//   unknown   → backlog hue (muted, dashed circle)
//   open      → todo / blue
//   waiting   → amber (distinct from internal in_progress yellow)
//   running   → cyan, animated when motion is allowed
//   succeeded → done / green
//   failed    → red
//   blocked   → red
//   closed    → muted neutral
//   archived  → muted neutral
//   auth_required → amber + dashed
//   unreachable   → red + dashed

export const externalObjectStatusIcon: Record<string, string> = {
  unknown: "text-muted-foreground border-muted-foreground",
  open: "text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400",
  waiting: "text-amber-600 border-amber-600 dark:text-amber-400 dark:border-amber-400",
  running: "text-cyan-600 border-cyan-600 dark:text-cyan-400 dark:border-cyan-400",
  succeeded: "text-green-600 border-green-600 dark:text-green-400 dark:border-green-400",
  failed: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
  blocked: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
  closed: "text-neutral-500 border-neutral-500",
  archived: "text-neutral-500 border-neutral-500",
  auth_required: "text-amber-600 border-amber-600 dark:text-amber-400 dark:border-amber-400",
  unreachable: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
};

export const externalObjectStatusIconDefault = "text-muted-foreground border-muted-foreground";

export const externalObjectStatusBadge: Record<string, string> = {
  unknown: "bg-muted text-muted-foreground",
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  waiting: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  running: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  succeeded: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  closed: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
  auth_required: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  unreachable: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

export const externalObjectStatusBadgeDefault = "bg-muted text-muted-foreground";

/**
 * Liveness overlay applied on top of the base status tone. We deliberately
 * encode it as utility classes (not a tone change) so callers can append the
 * overlay to any pill, icon, or marker without redefining colors.
 *
 * The dashed border + reduced opacity guarantees a non-color differentiator
 * for stale / auth_required / unreachable per WCAG 1.4.1.
 */
export const externalObjectLivenessOverlay: Record<string, string> = {
  unknown: "",
  fresh: "",
  stale: "opacity-70 [border-style:dashed]",
  auth_required: "[border-style:dashed]",
  unreachable: "[border-style:dashed]",
};

/**
 * Severity ranking used by sidebar/list rollups. Higher number = more
 * attention-worthy. Anything ≤ `muted` should be hidden when summarising.
 */
export const externalObjectStatusToneSeverity: Record<string, number> = {
  muted: 0,
  neutral: 1,
  success: 2,
  info: 3,
  warning: 4,
  danger: 5,
};

export const externalObjectStatusToneSeverityDefault = 0;
