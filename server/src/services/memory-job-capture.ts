import { createHash } from "node:crypto";
import type {
  BillingType,
  MemoryExtractionJobAttributionMode,
  MemoryExtractionJobDispatcherKind,
  MemoryExtractionJobSourceRef,
  MemoryExtractionJobUsage,
} from "@paperclipai/shared";
import {
  buildHeartbeatRunIssueComment,
  summarizeHeartbeatRunResultJson,
} from "./heartbeat-run-summary.js";
import type { MemoryJobHandler } from "./memory-job-dispatcher.js";
import type { MemoryJobStore } from "./memory-job-store.js";

export const DEFAULT_POST_RUN_MEMORY_BINDING_KEY = "primary";

type PostRunMemoryCaptureSource = {
  id: string;
  companyId: string;
  agentId: string;
  status: string;
  invocationSource: string;
  triggerDetail: string | null;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  error: string | null;
  errorCode: string | null;
  sessionIdAfter: string | null;
};

export interface EnqueuePostRunMemoryCaptureInput {
  store: MemoryJobStore;
  run: PostRunMemoryCaptureSource;
  sourceIssueId?: string | null;
  sourceProjectId?: string | null;
  sourceGoalId?: string | null;
  bindingKey?: string;
  bindingId?: string;
  attributionMode?: MemoryExtractionJobAttributionMode;
  costCents?: number;
  usageJson?: MemoryExtractionJobUsage | null;
  resultSummary?: string | null;
  resultJson?: Record<string, unknown> | null;
  sourceRefJson?: MemoryExtractionJobSourceRef | null;
  dispatcherKind?: MemoryExtractionJobDispatcherKind;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFiniteField(record: Record<string, unknown> | null, key: string): number | null {
  return record ? readFiniteNumber(record[key]) : null;
}

function formatUuidFromHex(hex: string): string {
  const version = `4${hex.slice(13, 16)}`;
  const variant = `${((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
}

export function buildSyntheticMemoryBindingId(companyId: string, bindingKey: string): string {
  const digest = createHash("sha256")
    .update(`memory-binding:${companyId}:${bindingKey}`)
    .digest("hex");
  return formatUuidFromHex(digest);
}

function normalizeBillingType(value: unknown): BillingType | null {
  const raw = readNonEmptyString(value);
  switch (raw) {
    case "metered_api":
    case "api":
      return "metered_api";
    case "subscription_included":
    case "subscription":
      return "subscription_included";
    case "subscription_overage":
      return "subscription_overage";
    case "credits":
      return "credits";
    case "fixed":
      return "fixed";
    case "unknown":
      return "unknown";
    default:
      return null;
  }
}

function costCentsFromUsage(usageJson: MemoryExtractionJobUsage | null): number | null {
  if (!usageJson) {
    return null;
  }
  if (typeof usageJson.costCents === "number" && Number.isFinite(usageJson.costCents)) {
    return Math.max(0, Math.round(usageJson.costCents));
  }
  return null;
}

function buildUsageSummaryFromRun(
  usageJson: Record<string, unknown> | null,
): MemoryExtractionJobUsage | null {
  const usage = asRecord(usageJson);
  if (!usage) {
    return null;
  }

  const billingType = normalizeBillingType(usage.billingType);
  const rawCostCents = readFiniteField(usage, "costCents");
  const rawCostUsd = readFiniteField(usage, "costUsd");
  const derivedCostCents =
    rawCostCents !== null
      ? Math.max(0, Math.round(rawCostCents))
      : rawCostUsd !== null
        ? Math.max(0, Math.round(rawCostUsd * 100))
        : null;

  const details = Object.fromEntries(
    Object.entries(usage).filter(([key]) => ![
      "provider",
      "biller",
      "model",
      "billingType",
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
      "embeddingTokens",
      "costCents",
      "costUsd",
      "latencyMs",
    ].includes(key)),
  );

  if (
    Object.keys(usage).length === 0
    && Object.keys(details).length === 0
  ) {
    return null;
  }

  return {
    provider: readNonEmptyString(usage.provider) ?? "unknown",
    biller: readNonEmptyString(usage.biller),
    model: readNonEmptyString(usage.model),
    billingType,
    inputTokens: readFiniteField(usage, "inputTokens"),
    cachedInputTokens: readFiniteField(usage, "cachedInputTokens"),
    outputTokens: readFiniteField(usage, "outputTokens"),
    embeddingTokens: readFiniteField(usage, "embeddingTokens"),
    costCents: derivedCostCents,
    latencyMs: readFiniteField(usage, "latencyMs"),
    details: Object.keys(details).length > 0 ? details : null,
  };
}

function resolveAttribution(input: {
  attributionMode?: MemoryExtractionJobAttributionMode;
  costCents?: number;
  usageJson: MemoryExtractionJobUsage | null;
}) {
  const derivedCostCents = costCentsFromUsage(input.usageJson);

  if (input.attributionMode) {
    return {
      attributionMode: input.attributionMode,
      costCents:
        typeof input.costCents === "number" && Number.isFinite(input.costCents)
          ? Math.max(0, Math.round(input.costCents))
          : derivedCostCents ?? 0,
    };
  }

  if (input.usageJson) {
    return {
      attributionMode: "included_in_run" as const,
      costCents: derivedCostCents ?? 0,
    };
  }

  return {
    attributionMode: "untracked" as const,
    costCents: 0,
  };
}

function truncateSummary(summary: string | null): string | null {
  if (!summary) {
    return null;
  }
  return summary.length > 500 ? summary.slice(0, 500) : summary;
}

function deriveResultSummary(run: PostRunMemoryCaptureSource): string {
  const commentSummary = truncateSummary(buildHeartbeatRunIssueComment(run.resultJson));
  if (commentSummary) {
    return commentSummary;
  }

  const summarizedResult = summarizeHeartbeatRunResultJson(run.resultJson);
  const resultRecord = asRecord(summarizedResult);
  const resultSummary = truncateSummary(
    readNonEmptyString(resultRecord?.result)
    ?? readNonEmptyString(resultRecord?.message)
    ?? readNonEmptyString(resultRecord?.error)
    ?? readNonEmptyString(run.error),
  );
  if (resultSummary) {
    return resultSummary;
  }

  return `Run ${run.id} finished with status ${run.status}`;
}

function buildQueuedCaptureResultJson(
  run: PostRunMemoryCaptureSource,
  resultJson: Record<string, unknown> | null,
): Record<string, unknown> {
  const sourceResult = summarizeHeartbeatRunResultJson(run.resultJson);
  return {
    captureState: "queued",
    hookKind: "post_run_capture",
    sourceKind: "run",
    sourceRunId: run.id,
    sourceRunStatus: run.status,
    ...(run.errorCode ? { sourceErrorCode: run.errorCode } : {}),
    ...(run.sessionIdAfter ? { sourceSessionIdAfter: run.sessionIdAfter } : {}),
    ...(sourceResult ? { sourceResult } : {}),
    ...(resultJson ?? {}),
  };
}

function mergeCaptureResultJson(
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...patch,
  };
}

export async function enqueuePostRunMemoryCaptureJob(
  input: EnqueuePostRunMemoryCaptureInput,
) {
  const bindingKey = input.bindingKey ?? DEFAULT_POST_RUN_MEMORY_BINDING_KEY;
  const bindingId = input.bindingId ?? buildSyntheticMemoryBindingId(input.run.companyId, bindingKey);
  const usageJson = input.usageJson ?? buildUsageSummaryFromRun(input.run.usageJson);
  const attribution = resolveAttribution({
    attributionMode: input.attributionMode,
    costCents: input.costCents,
    usageJson,
  });

  return input.store.enqueue({
    companyId: input.run.companyId,
    bindingId,
    bindingKey,
    operationType: "capture",
    sourceKind: "run",
    sourceAgentId: input.run.agentId,
    sourceIssueId: input.sourceIssueId ?? null,
    sourceProjectId: input.sourceProjectId ?? null,
    sourceGoalId: input.sourceGoalId ?? null,
    sourceHeartbeatRunId: input.run.id,
    hookKind: "post_run_capture",
    dispatcherKind: input.dispatcherKind ?? "in_process",
    attributionMode: attribution.attributionMode,
    costCents: attribution.costCents,
    usageJson,
    resultSummary: truncateSummary(input.resultSummary ?? deriveResultSummary(input.run)),
    resultJson: buildQueuedCaptureResultJson(input.run, input.resultJson ?? null),
    sourceRefJson: {
      invocationSource: input.run.invocationSource,
      ...(input.run.triggerDetail ? { triggerDetail: input.run.triggerDetail } : {}),
      sourceRunStatus: input.run.status,
      ...(input.run.sessionIdAfter ? { sessionIdAfter: input.run.sessionIdAfter } : {}),
      ...(input.sourceRefJson ?? {}),
    },
  });
}

export function createPostRunMemoryCaptureHandler(): MemoryJobHandler {
  return async (job) => {
    if (job.sourceKind !== "run" || job.hookKind !== "post_run_capture") {
      return {
        outcome: "failed",
        errorCode: "unsupported_post_run_capture_source",
        error: `Post-run capture handler only supports run/post_run_capture jobs; received ${job.sourceKind}/${job.hookKind ?? "null"}`,
        resultSummary: job.resultSummary ?? "Unsupported post-run capture source",
        resultJson: mergeCaptureResultJson(job.resultJson ?? null, { captureState: "failed" }),
      };
    }

    if (!job.sourceHeartbeatRunId) {
      return {
        outcome: "failed",
        errorCode: "source_run_missing",
        error: "Post-run capture job is missing source heartbeat run provenance",
        resultSummary: job.resultSummary ?? "Missing source run for post-run capture",
        resultJson: mergeCaptureResultJson(job.resultJson ?? null, { captureState: "failed" }),
      };
    }

    return {
      outcome: "succeeded",
      resultSummary: job.resultSummary ?? `Post-run capture recorded for run ${job.sourceHeartbeatRunId}`,
      resultJson: mergeCaptureResultJson(job.resultJson ?? null, {
        captureState: "succeeded",
        sourceRunId: job.sourceHeartbeatRunId,
        persistedUsageSummary: job.usageJson != null,
        persistedSourceIssueId: job.sourceIssueId,
        persistedSourceProjectId: job.sourceProjectId,
        persistedSourceGoalId: job.sourceGoalId,
      }),
    };
  };
}
