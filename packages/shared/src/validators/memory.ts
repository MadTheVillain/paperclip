import { z } from "zod";
import {
  MEMORY_EXTRACTION_JOB_ATTRIBUTION_MODES,
  MEMORY_EXTRACTION_JOB_DISPATCHER_KINDS,
  MEMORY_EXTRACTION_JOB_EFFECTIVE_STATES,
  MEMORY_EXTRACTION_JOB_HOOK_KINDS,
  MEMORY_EXTRACTION_JOB_OPERATION_TYPES,
  MEMORY_EXTRACTION_JOB_SOURCE_KINDS,
  MEMORY_EXTRACTION_JOB_STATUSES,
} from "../constants.js";

const memoryBindingKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Binding key must be lowercase letters, numbers, _ or -");

export const memoryExtractionJobOperationTypeSchema = z.enum(MEMORY_EXTRACTION_JOB_OPERATION_TYPES);
export const memoryExtractionJobStatusSchema = z.enum(MEMORY_EXTRACTION_JOB_STATUSES);
export const memoryExtractionJobHookKindSchema = z.enum(MEMORY_EXTRACTION_JOB_HOOK_KINDS);
export const memoryExtractionJobSourceKindSchema = z.enum(MEMORY_EXTRACTION_JOB_SOURCE_KINDS);
export const memoryExtractionJobDispatcherKindSchema = z.enum(MEMORY_EXTRACTION_JOB_DISPATCHER_KINDS);
export const memoryExtractionJobAttributionModeSchema = z.enum(MEMORY_EXTRACTION_JOB_ATTRIBUTION_MODES);
export const memoryExtractionJobEffectiveStateSchema = z.enum(MEMORY_EXTRACTION_JOB_EFFECTIVE_STATES);

export const listMemoryExtractionJobsQuerySchema = z
  .object({
    status: memoryExtractionJobStatusSchema.optional(),
    effectiveState: memoryExtractionJobEffectiveStateSchema.optional(),
    bindingKey: memoryBindingKeySchema.optional(),
    operationType: memoryExtractionJobOperationTypeSchema.optional(),
    agentId: z.string().uuid().optional(),
    issueId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    submittedAfter: z.coerce.date().optional(),
    submittedBefore: z.coerce.date().optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status && value.effectiveState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveState"],
        message: "effectiveState and status cannot be used together",
      });
    }
    if (value.submittedAfter && value.submittedBefore && value.submittedAfter > value.submittedBefore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submittedAfter"],
        message: "submittedAfter must be before or equal to submittedBefore",
      });
    }
  });

export type ListMemoryExtractionJobsQuery = z.infer<typeof listMemoryExtractionJobsQuerySchema>;

export const rerunMemoryExtractionJobSchema = z.object({}).strict();

export type RerunMemoryExtractionJob = z.infer<typeof rerunMemoryExtractionJobSchema>;
