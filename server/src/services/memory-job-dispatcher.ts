import type {
  MemoryExtractionJobAttributionMode,
  MemoryExtractionJobUsage,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import type { MemoryJobStore } from "./memory-job-store.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_RECOVERY_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_JOBS = 2;

type ClaimedMemoryJob = NonNullable<Awaited<ReturnType<MemoryJobStore["claimNext"]>>>;

interface MemoryJobHandlerResultBase {
  providerJobId?: string | null;
  attributionMode?: MemoryExtractionJobAttributionMode;
  costCents?: number;
  resultSummary?: string | null;
  usageJson?: MemoryExtractionJobUsage | null;
  resultJson?: Record<string, unknown> | null;
}

export type MemoryJobHandlerResult =
  | ({ outcome: "succeeded" } & MemoryJobHandlerResultBase)
  | ({ outcome: "failed"; error?: string | null; errorCode?: string | null } & MemoryJobHandlerResultBase)
  | ({ outcome: "running"; leaseDurationMs?: number | null } & MemoryJobHandlerResultBase);

export type MemoryJobHandler = (
  job: ClaimedMemoryJob,
) => Promise<MemoryJobHandlerResult> | MemoryJobHandlerResult;

export interface MemoryJobDispatcherOptions {
  store: MemoryJobStore;
  resolveHandler: (job: ClaimedMemoryJob) => Promise<MemoryJobHandler | null> | MemoryJobHandler | null;
  pollIntervalMs?: number;
  recoveryIntervalMs?: number;
  leaseDurationMs?: number;
  maxConcurrentJobs?: number;
  now?: () => Date;
}

export interface MemoryJobDispatcherDiagnostics {
  running: boolean;
  activeJobCount: number;
  activeJobIds: string[];
  tickCount: number;
  lastTickAt: string | null;
  recoveryCount: number;
  lastRecoveryAt: string | null;
}

export interface MemoryJobDispatcher {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  sweepExpiredLeases(): Promise<Awaited<ReturnType<MemoryJobStore["recoverExpiredLeases"]>>>;
  diagnostics(): MemoryJobDispatcherDiagnostics;
}

function childLogger(bindings: Record<string, unknown>): typeof logger {
  return typeof logger.child === "function" ? logger.child(bindings) : logger;
}

export function createMemoryJobDispatcher(
  options: MemoryJobDispatcherOptions,
): MemoryJobDispatcher {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const recoveryIntervalMs = options.recoveryIntervalMs ?? DEFAULT_RECOVERY_INTERVAL_MS;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const maxConcurrentJobs = options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
  const now = options.now ?? (() => new Date());
  const log = childLogger({ service: "memory_job_dispatcher" });

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let recoveryTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let tickInProgress = false;
  let recoveryInProgress = false;
  let tickCount = 0;
  let recoveryCount = 0;
  let lastTickAt: Date | null = null;
  let lastRecoveryAt: Date | null = null;

  const activeJobs = new Set<string>();

  async function runClaimedJob(job: ClaimedMemoryJob): Promise<void> {
    const jobLog = typeof log.child === "function" ? log.child({
      jobId: job.id,
      companyId: job.companyId,
      bindingKey: job.bindingKey,
      operationType: job.operationType,
    }) : log;

    try {
      const handler = await options.resolveHandler(job);
      if (!handler) {
        await options.store.fail({
          companyId: job.companyId,
          jobId: job.id,
          now: now(),
          errorCode: "handler_not_configured",
          error: `No in-process memory job handler configured for ${job.operationType}`,
        });
        jobLog.warn("failed memory job because no handler was configured");
        return;
      }

      const result = await handler(job);
      const settledAt = now();

      if (result.outcome === "succeeded") {
        await options.store.complete({
          companyId: job.companyId,
          jobId: job.id,
          now: settledAt,
          ...(result.providerJobId !== undefined ? { providerJobId: result.providerJobId } : {}),
          ...(result.attributionMode !== undefined ? { attributionMode: result.attributionMode } : {}),
          ...(result.costCents !== undefined ? { costCents: result.costCents } : {}),
          ...(result.resultSummary !== undefined ? { resultSummary: result.resultSummary } : {}),
          ...(result.usageJson !== undefined ? { usageJson: result.usageJson } : {}),
          ...(result.resultJson !== undefined ? { resultJson: result.resultJson } : {}),
        });
        jobLog.info("completed memory job successfully");
        return;
      }

      if (result.outcome === "failed") {
        await options.store.fail({
          companyId: job.companyId,
          jobId: job.id,
          now: settledAt,
          ...(result.providerJobId !== undefined ? { providerJobId: result.providerJobId } : {}),
          ...(result.attributionMode !== undefined ? { attributionMode: result.attributionMode } : {}),
          ...(result.costCents !== undefined ? { costCents: result.costCents } : {}),
          ...(result.resultSummary !== undefined ? { resultSummary: result.resultSummary } : {}),
          ...(result.usageJson !== undefined ? { usageJson: result.usageJson } : {}),
          ...(result.resultJson !== undefined ? { resultJson: result.resultJson } : {}),
          errorCode: result.errorCode,
          error: result.error ?? "Memory job handler reported a failure",
        });
        jobLog.warn("memory job handler returned a failure result");
        return;
      }

      await options.store.updateRunning({
        companyId: job.companyId,
        jobId: job.id,
        now: settledAt,
        ...(result.providerJobId !== undefined ? { providerJobId: result.providerJobId } : {}),
        ...(result.attributionMode !== undefined ? { attributionMode: result.attributionMode } : {}),
        ...(result.costCents !== undefined ? { costCents: result.costCents } : {}),
        ...(result.resultSummary !== undefined ? { resultSummary: result.resultSummary } : {}),
        ...(result.usageJson !== undefined ? { usageJson: result.usageJson } : {}),
        ...(result.resultJson !== undefined ? { resultJson: result.resultJson } : {}),
        leaseDurationMs: result.leaseDurationMs ?? leaseDurationMs,
      });
      jobLog.info("memory job remains running after provider handoff");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      try {
        await options.store.fail({
          companyId: job.companyId,
          jobId: job.id,
          now: now(),
          errorCode: "handler_exception",
          error: message,
        });
      } catch (persistError) {
        jobLog.error(
          { persistError: persistError instanceof Error ? persistError.message : String(persistError) },
          "failed to persist handler exception on memory job",
        );
      }

      jobLog.error({ error: message }, "memory job handler threw an exception");
    } finally {
      activeJobs.delete(job.id);
    }
  }

  async function tick(): Promise<void> {
    if (tickInProgress) {
      return;
    }

    tickInProgress = true;
    tickCount += 1;
    lastTickAt = now();

    try {
      while (activeJobs.size < maxConcurrentJobs) {
        const claimed = await options.store.claimNext({
          dispatcherKind: "in_process",
          leaseDurationMs,
          now: now(),
        });

        if (!claimed) {
          break;
        }

        activeJobs.add(claimed.id);
        void runClaimedJob(claimed);
      }
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "memory job dispatcher tick failed",
      );
    } finally {
      tickInProgress = false;
    }
  }

  async function sweepExpiredLeases() {
    if (recoveryInProgress) {
      return { recovered: 0, jobIds: [] };
    }

    recoveryInProgress = true;
    recoveryCount += 1;
    lastRecoveryAt = now();

    try {
      const result = await options.store.recoverExpiredLeases({ now: now() });
      if (result.recovered > 0) {
        log.warn({ recovered: result.recovered, jobIds: result.jobIds }, "recovered expired memory job leases");
      }
      return result;
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "memory job recovery sweep failed",
      );
      return { recovered: 0, jobIds: [] };
    } finally {
      recoveryInProgress = false;
    }
  }

  function start(): void {
    if (running) {
      return;
    }

    running = true;
    pollTimer = setInterval(() => {
      void tick();
    }, pollIntervalMs);
    recoveryTimer = setInterval(() => {
      void sweepExpiredLeases();
    }, recoveryIntervalMs);
    pollTimer.unref?.();
    recoveryTimer.unref?.();

    void sweepExpiredLeases();
    void tick();

    log.info({ pollIntervalMs, recoveryIntervalMs, leaseDurationMs, maxConcurrentJobs }, "memory job dispatcher started");
  }

  function stop(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (recoveryTimer !== null) {
      clearInterval(recoveryTimer);
      recoveryTimer = null;
    }
    if (!running) {
      return;
    }

    running = false;
    log.info({ activeJobCount: activeJobs.size }, "memory job dispatcher stopped");
  }

  function diagnostics(): MemoryJobDispatcherDiagnostics {
    return {
      running,
      activeJobCount: activeJobs.size,
      activeJobIds: [...activeJobs],
      tickCount,
      lastTickAt: lastTickAt?.toISOString() ?? null,
      recoveryCount,
      lastRecoveryAt: lastRecoveryAt?.toISOString() ?? null,
    };
  }

  return {
    start,
    stop,
    tick,
    sweepExpiredLeases,
    diagnostics,
  };
}
