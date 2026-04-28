# Execution Semantics

Status: Current implementation guide
Date: 2026-04-28
Audience: Product and engineering

This document explains how Paperclip interprets issue assignment, issue status, execution runs, wakeups, parent/sub-issue structure, and blocker relationships.

`doc/SPEC-implementation.md` remains the V1 contract. This document is the detailed execution model behind that contract.

## 1. Core Model

Paperclip separates four concepts that are easy to blur together:

1. structure: parent/sub-issue relationships
2. dependency: blocker relationships
3. ownership: who is responsible for the issue now
4. execution: whether the control plane currently has a live path to move the issue forward

The system works best when those are kept separate.

## 2. Assignee Semantics

An issue has at most one assignee.

- `assigneeAgentId` means the issue is owned by an agent
- `assigneeUserId` means the issue is owned by a human board user
- both cannot be set at the same time

This is a hard invariant. Paperclip is single-assignee by design.

## 3. Status Semantics

Paperclip issue statuses are not just UI labels. They imply different expectations about ownership and execution.

### `backlog`

The issue is not ready for active work.

- no execution expectation
- no pickup expectation
- safe resting state for future work

### `todo`

The issue is actionable but not actively claimed.

- it may be assigned or unassigned
- no checkout/execution lock is required yet
- for agent-assigned work, Paperclip may still need a wake path to ensure the assignee actually sees it

### `in_progress`

The issue is actively owned work.

- requires an assignee
- for agent-owned issues, this is a strict execution-backed state
- for user-owned issues, this is a human ownership state and is not backed by heartbeat execution

For agent-owned issues, `in_progress` should not be allowed to become a silent dead state.

### `blocked`

The issue cannot proceed until something external changes.

This is the right state for:

- waiting on another issue
- waiting on a human decision
- waiting on an external dependency or system
- work that automatic recovery could not safely continue

### `in_review`

Execution work is paused because the next move belongs to a reviewer or approver, not the current executor.

### `done`

The work is complete and terminal.

### `cancelled`

The work will not continue and is terminal.

## 4. Agent-Owned vs User-Owned Execution

The execution model differs depending on assignee type.

### Agent-owned issues

Agent-owned issues are part of the control plane's execution loop.

- Paperclip can wake the assignee
- Paperclip can track runs linked to the issue
- Paperclip can recover some lost execution state after crashes/restarts

### User-owned issues

User-owned issues are not executed by the heartbeat scheduler.

- Paperclip can track the ownership and status
- Paperclip cannot rely on heartbeat/run semantics to keep them moving
- stranded-work reconciliation does not apply to them

This is why `in_progress` can be strict for agents without forcing the same runtime rules onto human-held work.

## 5. Checkout and Active Execution

Checkout is the bridge from issue ownership to active agent execution.

- checkout is required to move an issue into agent-owned `in_progress`
- `checkoutRunId` represents issue-ownership lock for the current agent run
- `executionRunId` represents the currently active execution path for the issue

These are related but not identical:

- `checkoutRunId` answers who currently owns execution rights for the issue
- `executionRunId` answers which run is actually live right now

Paperclip already clears stale execution locks and can adopt some stale checkout locks when the original run is gone.

## 6. Parent/Sub-Issue vs Blockers

Paperclip uses two different relationships for different jobs.

### Parent/Sub-Issue (`parentId`)

This is structural.

Use it for:

- work breakdown
- rollup context
- explaining why a child issue exists
- waking the parent assignee when all direct children become terminal

Do not treat `parentId` as execution dependency by itself.

### Blockers (`blockedByIssueIds`)

This is dependency semantics.

Use it for:

- \"this issue cannot continue until that issue changes state\"
- explicit waiting relationships
- automatic wakeups when all blockers resolve

Blocked issues should stay idle while blockers remain unresolved. Paperclip should not create a queued heartbeat run for that issue until the final blocker is done and the `issue_blockers_resolved` wake can start real work.

If a parent is truly waiting on a child, model that with blockers. Do not rely on the parent/child relationship alone.

## 7. Non-Terminal Issue Liveness Contract

For agent-owned, non-terminal issues, Paperclip should never leave work in a state where nobody is responsible for the next move and nothing will wake or surface it.

This is a visibility contract, not an auto-completion contract. If Paperclip cannot safely infer the next action, it should surface the ambiguity with a blocked state, a visible comment, or an explicit recovery issue. It must not silently mark work done from prose comments or guess that a dependency is complete.

An issue is healthy when the product can answer "what moves this forward next?" without requiring a human to reconstruct intent from the whole thread. An issue is stalled when it is non-terminal but has no live execution path, no explicit waiting path, and no recovery path.

The valid action-path primitives are:

- an active run linked to the issue
- a queued wake or continuation that can be delivered to the responsible agent
- a scheduled retry or deferred issue-execution wake that is tied to the issue
- an active subtree pause hold that intentionally suppresses execution for the issue
- a typed execution-policy participant, such as `executionState.currentParticipant`
- a pending issue-thread interaction or linked approval that is waiting for a specific responder
- a human owner via `assigneeUserId`
- a first-class blocker chain whose unresolved leaf issues are themselves healthy
- an open explicit recovery issue that names the owner and action needed to restore liveness

Run progress and issue liveness are separate questions. A finished heartbeat can prove that the agent did useful work during that run, but the finished run is not itself a live path for a non-terminal agent-owned issue. After a heartbeat exits, a non-terminal issue must still have a terminal state, explicit waiting path, explicit live path, or recovery/review path.

### Agent-assigned `todo`

This is dispatch state: ready to start, not yet actively claimed.

A healthy dispatch state means at least one of these is true:

- the issue already has a queued wake path
- the issue is intentionally resting in `todo` after a completed agent heartbeat, with no interrupted dispatch evidence
- the issue has been explicitly surfaced as stranded through a visible blocked/recovery path

An assigned `todo` issue is stalled when dispatch was interrupted, no wake remains queued or running, and no recovery path has been opened.

If an assigned `todo` issue has no latest issue-linked run, no queued issue wake, no active execution path, no active pause hold, and the assignee is invokable and not budget-blocked, periodic recovery may enqueue one initial assignment dispatch backstop. This is a dispatch backstop, not proof that the issue has already been worked.

### Agent-assigned `in_progress`

This is active-work state.

A healthy active-work state means at least one of these is true:

- there is an active run for the issue
- there is already a queued continuation wake
- there is a scheduled retry or deferred issue-execution wake for the issue
- the issue is covered by an active pause hold
- there is an open explicit recovery issue for the lost execution path

An agent-owned `in_progress` issue is stalled when it has no active run, no queued continuation, and no explicit recovery surface. A still-running but silent process is not automatically stalled; it is handled by the active-run watchdog contract.

For terminal successful runs, Paperclip evaluates the post-run issue disposition instead of treating success as liveness. The disposition is:

- `terminal`: the issue is `done` or `cancelled`
- `explicitly_live`: an active run, queued wake, scheduled retry, or deferred issue-execution wake owns the next step
- `explicitly_waiting`: a blocker, active pause hold, `in_review`, pending interaction, linked approval, execution-policy state, or explicit recovery issue owns the next step
- `invalid`: the issue is non-terminal and no live, waiting, or recovery path exists

Only `terminal`, `explicitly_live`, and `explicitly_waiting` are healthy resting states. `invalid` must become a bounded continuation, explicit recovery/review work, or a visible blocked state.

### `in_review`

This is review/approval state: execution is paused because the next move belongs to a reviewer, approver, board user, or recovery owner.

A healthy `in_review` issue has at least one valid action path:

- a typed execution-policy participant who can approve or request changes
- a pending issue-thread interaction or linked approval waiting for a named responder
- a human owner via `assigneeUserId`
- an active run or queued wake that is expected to process the review state
- an open explicit recovery issue for an ambiguous review handoff

Agent-assigned `in_review` with no typed participant is only healthy when one of the other paths exists. Assignment to the same agent that produced the handoff is not, by itself, a review path.

An `in_review` issue is stalled when it has no typed participant, no pending interaction or approval, no user owner, no active run, no queued wake, and no explicit recovery issue. Paperclip should surface that state as recovery work rather than silently completing the issue or leaving blocker chains parked indefinitely.

### `blocked`

This is explicit waiting state.

A healthy `blocked` issue has an explicit waiting path:

- first-class blockers exist, and each unresolved leaf has a valid action path under this contract
- the issue is blocked on an explicit recovery issue that itself has a live or waiting path
- the issue is waiting on a pending interaction, linked approval, human owner, or clearly named external owner/action

A blocker chain is covered only when its unresolved leaf is live or explicitly waiting. An intermediate `blocked` issue does not make the chain healthy by itself.

A `blocked` issue is stalled when the unresolved blocker leaf has no active run, queued wake, typed participant, pending interaction or approval, user owner, external owner/action, or recovery issue. In that case the parent should show the first stalled leaf instead of presenting the dependency as calmly covered.

## 8. Crash and Restart Recovery

Paperclip now treats crash/restart recovery as a stranded-assigned-work problem, not just a stranded-run problem.

There are two distinct failure modes.

### 8.1 Stranded assigned `todo`

Example:

- issue is assigned to an agent
- status is `todo`
- the original wake/run died during or after dispatch, or dispatch never produced a run
- after restart there is no queued wake and nothing picks the issue back up

Recovery rule:

- if no issue-linked run exists yet, no queued wake exists, no pause hold suppresses recovery, and the assignee is invokable and not budget-blocked, Paperclip queues an initial assignment dispatch wake
- if the latest issue-linked run failed/timed out/cancelled and no live execution path remains, Paperclip queues one automatic assignment recovery wake
- if that recovery wake also finishes and the issue is still stranded, Paperclip moves the issue to `blocked` and posts a visible comment

This is a dispatch recovery, not a continuation recovery.

### 8.2 Stranded assigned `in_progress`

Example:

- issue is assigned to an agent
- status is `in_progress`
- the live run disappeared
- after restart there is no active run and no queued continuation

Recovery rule:

- if the latest run failed/timed out/cancelled and no live execution path remains, Paperclip queues one automatic continuation wake
- if the latest successful run is terminal and the post-run issue disposition is invalid, Paperclip examines the run liveness state, next action, and actionability before continuing
- if bounded continuation is safe, Paperclip queues a `run_liveness_continuation` wake with a stable idempotency key and continuation attempt count
- if bounded continuation is exhausted or unsafe, Paperclip creates/reuses explicit recovery work or moves the issue to `blocked` with a visible comment

This is an active-work continuity recovery.

### 8.3 Run liveness classification and bounded continuation

Run liveness classification describes what the just-finished run did. It is not the same thing as issue liveness.

The current classifier records:

- `completed` when the issue is terminal
- `advanced` when the run produced concrete action evidence such as comments, document revisions, work products, activity events, or tool/action events
- `blocked` when the issue or run output declares a concrete blocker
- `needs_followup` when output indicates review, ambiguous follow-up, or useful output without concrete action evidence
- `plan_only` when the run described runnable future work without concrete action evidence
- `empty_response` when the run succeeded without useful output or concrete action evidence
- `failed` when the run itself did not succeed

The classifier also extracts a `nextAction` and actionability signal: `runnable`, `manager_review`, `blocked_external`, `approval_required`, or `unknown`.

Bounded liveness continuation may be queued for:

- `plan_only`
- `empty_response`
- `advanced` only when there is an explicit runnable `nextAction`

Bounded continuation is not queued when:

- the issue is terminal, `blocked`, `in_review`, or otherwise not in `todo`/`in_progress`
- the issue is no longer assigned to the source run agent
- execution-policy state owns the next decision
- the assignee is not invokable
- a budget hard stop applies
- an equivalent continuation wake already exists
- the max continuation attempts have been used
- a productivity review or active subtree pause hold suppresses continuation

The default max continuation attempts is 2. Exhaustion records a "Bounded liveness continuation exhausted" comment rather than silently spinning.

## 9. Startup and Periodic Reconciliation

Startup recovery and periodic recovery are different from normal wakeup delivery.

On startup and on the periodic recovery loop, Paperclip now does these things in sequence:

1. reap orphaned `running` runs
2. promote due scheduled retries
3. resume persisted `queued` runs
4. reconcile stranded assigned work
5. reconcile issue-graph liveness
6. scan silent active runs and create or update explicit watchdog review issues
7. reconcile productivity/progression reviews

The stranded-work pass closes the gap where issue state survives a crash but the wake/run path does not. The issue-graph pass covers invalid blocker/review dependency leaves. The silent-run scan covers the separate case where a live process exists but has stopped producing observable output. The productivity-review pass covers unusual but still productive execution patterns that need manager judgment, not automatic failure recovery.

## 10. Silent Active-Run Watchdog

An active run can still be unhealthy even when its process is `running`. Paperclip treats prolonged output silence as a watchdog signal, not as proof that the run is failed.

The recovery service owns this contract:

- classify active-run output silence as `ok`, `suspicious`, `critical`, `snoozed`, or `not_applicable`
- collect bounded evidence from run logs, recent run events, child issues, and blockers
- preserve redaction and truncation before evidence is written to issue descriptions
- create at most one open `stale_active_run_evaluation` issue per run
- honor active snooze decisions before creating more review work
- build the `outputSilence` summary shown by live-run and active-run API responses

Suspicious silence creates a medium-priority review issue for the selected recovery owner. Critical silence raises that review issue to high priority and blocks the source issue on the explicit evaluation task without cancelling the active process.

Watchdog decisions are explicit operator/recovery-owner decisions:

- `snooze` records an operator-chosen future quiet-until time and suppresses scan-created review work during that window
- `continue` records that the current evidence is acceptable, does not cancel or mutate the active run, and sets a 30-minute default re-arm window before the watchdog evaluates the still-silent run again
- `dismissed_false_positive` records why the review was not actionable

Operators should prefer `snooze` for known time-bounded quiet periods. `continue` is only a short acknowledgement of the current evidence; if the run remains silent after the re-arm window, the periodic watchdog scan can create or update review work again.

The board can record watchdog decisions. The assigned owner of the watchdog evaluation issue can also record them. Other agents cannot.

## 11. Productivity and Progression Review

Productivity review is a separate lane from liveness recovery.

Liveness recovery asks: "does this issue have an accountable live/waiting/recovery path?" Productivity review asks: "is this autonomous progression pattern still a good use of time?"

The productivity review reconciler scans agent-owned `todo` and `in_progress` issues. It skips user-owned issues, hidden issues, productivity-review issues, and descendants of productivity-review issues.

It creates or updates at most one open `issue_productivity_review` child issue per source issue when one of these triggers fires:

- no-comment streak: 10 consecutive completed issue-linked runs by the assigned agent without a run-created issue comment
- long active duration: default 6 hours in the current active episode
- high churn: default 10 runs or assignee run-linked comments in 1 hour, or 30 in 6 hours

The review issue includes source issue, assigned agent, trigger reasons, sampled run/comment evidence, cost evidence when available, thresholds, and current next action. It is assigned to the source assignee's manager when possible, then creator, project lead, CTO/CEO-style fallback, subject to same-company and invokable/budget checks. The source issue is not automatically cancelled or reassigned by this review.

Open productivity reviews can hold further automatic liveness continuations for soft-stop triggers:

- no-comment streak
- high churn

Long active duration creates review work but does not interrupt an already active run by itself.

Closing a productivity review as `done` acts as a short snooze for repeat review creation on the same source issue. The default resolved-review snooze is 6 hours.

Productivity review issues must not create productivity-review descendants. They are manager decision points, not new autonomous loops.

## 12. Pause Holds and Recovery Suppression

Subtree pause/cancel/restore holds are execution-control primitives. While an issue is covered by an active pause hold, Paperclip treats the hold as an explicit waiting path and suppresses automatic recovery and liveness continuation for that issue.

This includes:

- assigned `todo` dispatch backstops
- assigned `todo` or `in_progress` recovery wakes
- bounded `run_liveness_continuation` wakes
- scheduled retry promotion
- deferred issue-execution promotion

Pause holds do not make the issue complete. They intentionally stop automatic execution while preserving visible ownership, blockers, comments, and recovery evidence. Explicit human/operator actions can still resolve, reassign, unblock, or restore the held tree through the relevant tree-control flow.

During startup and periodic reconciliation, pause-hold checks run inside the affected passes rather than as a separate top-level phase. The current sequence remains: reap orphaned `running` runs, promote due scheduled retries, resume persisted `queued` runs, reconcile stranded assigned work, reconcile issue-graph liveness, scan silent active runs, then reconcile productivity/progression reviews. Any pass that would otherwise dispatch, promote, continue, or escalate held issue work must recognize the active pause hold first and leave the issue quiet until the hold is released.

User-visible history should retain attribution for these control actions. `issue.tree_hold_created` records who paused or cancelled the tree, and `issue.tree_hold_released` records who resumed or restored it. Raw heartbeat-run cancellation caused by the hold is a process interruption detail; it is not itself the same as pausing issue work.

## 13. Auto-Recover vs Explicit Recovery vs Human Escalation

Paperclip uses three different recovery outcomes, depending on how much it can safely infer.

### Auto-Recover

Auto-recovery is allowed when ownership is clear and the control plane only lost execution continuity.

Examples:

- queue an initial dispatch wake for an assigned `todo` issue with no run and no queued wake
- requeue one dispatch wake for an assigned `todo` issue whose latest run failed, timed out, or was cancelled
- requeue one continuation wake for an assigned `in_progress` issue whose live execution path disappeared
- queue bounded liveness continuation when a terminal successful run left a runnable next action but no live path
- assign an orphan blocker back to its creator when that blocker is already preventing other work

Auto-recovery preserves the existing owner. It does not choose a replacement agent.

### Explicit Recovery Issue

Paperclip creates an explicit recovery issue when the system can identify a problem but cannot safely complete the work itself.

Examples:

- automatic stranded-work retry was already exhausted
- a dependency graph has an invalid/uninvokable owner, unassigned blocker, or invalid review participant
- an active run is silent past the watchdog threshold
- a terminal successful run left a non-terminal issue with no safe runnable action path
- a stranded recovery issue itself failed; recovery issues are blocked in place rather than spawning nested stranded-recovery issues

The source issue remains visible and blocked on the recovery issue when blocking is necessary for correctness. The recovery owner must restore a live path, resolve the source issue manually, or record the reason it is a false positive.

Instance-level issue-graph liveness auto-recovery is disabled by default. When enabled, its lookback window means "dependency paths updated within the last N hours"; older findings remain advisory and are counted as outside the configured lookback instead of creating recovery issues automatically. This is an operator noise control, not the older staleness delay for determining whether a chain is old enough to surface.

### Human Escalation

Human escalation is required when the next safe action depends on board judgment, budget/approval policy, or information unavailable to the control plane.

Examples:

- all candidate recovery owners are paused, terminated, pending approval, or budget-blocked
- the issue is human-owned rather than agent-owned
- the run is intentionally quiet but needs an operator decision before cancellation or continuation

In these cases Paperclip should leave a visible issue/comment trail instead of silently retrying.

## 14. What This Does Not Mean

These semantics do not change V1 into an auto-reassignment system.

Paperclip still does not:

- automatically reassign work to a different agent
- infer dependency semantics from `parentId` alone
- treat human-held work as heartbeat-managed execution
- treat productivity review as proof of failure or as permission to cancel active work automatically

The recovery model is intentionally conservative:

- preserve ownership
- retry once when the control plane lost execution continuity
- continue productive work only through bounded, idempotent continuation paths
- create explicit recovery work when the system can identify a bounded recovery owner/action
- create productivity review work when the work is progressing but unusual enough to need manager judgment
- escalate visibly when the system cannot safely keep going

## 15. Practical Interpretation

For a board operator, the intended meaning is:

- agent-owned `in_progress` should mean \"this is live work or clearly surfaced as a problem\"
- agent-owned `todo` should not stay assigned forever after a crash with no remaining wake path
- productive work can continue, but unusual no-comment or high-churn patterns become manager-visible productivity reviews
- pause-held trees are intentionally quiet until restored or manually acted on
- parent/sub-issue explains structure
- blockers explain waiting

That is the execution contract Paperclip should present to operators.
