import { definePlugin, runWorker, type PluginApiRequestInput, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  WIKI_MAINTENANCE_ROUTINE_KEYS,
  WIKI_ROOT_FOLDER_KEY,
} from "./manifest.js";
import {
  bootstrapWikiRoot,
  assemblePaperclipSourceBundle,
  captureWikiSource,
  createPaperclipDistillationRun,
  createPaperclipDistillationWorkItem,
  createOperationIssue,
  distillPaperclipProjectPage,
  fileQueryAnswerAsPage,
  getDistillationOverview,
  getDistillationPageProvenance,
  getDistillationAutoApplyRestriction,
  getEventIngestionSettings,
  getOverview,
  handlePaperclipEventIngestion,
  listWikiAgentOptions,
  listWikiProjectOptions,
  listOperations,
  listPages,
  listSources,
  readCompanyIdFromParams,
  readTemplate,
  readWikiPage,
  recordPaperclipDistillationOutcome,
  reconcileWikiAgentResource,
  reconcileWikiProjectResource,
  reconcileWikiRoutineResources,
  registerWikiTools,
  resetWikiAgentResource,
  resetWikiProjectResource,
  selectWikiAgentResource,
  selectWikiProjectResource,
  startWikiQuerySession,
  updateEventIngestionSettings,
  writeTemplate,
  writeWikiPage,
} from "./wiki.js";

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function routineKeyField(value: unknown): (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number] {
  const routineKey = stringField(value) ?? WIKI_MAINTENANCE_ROUTINE_KEYS[0];
  if (!WIKI_MAINTENANCE_ROUTINE_KEYS.includes(routineKey as (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number])) {
    throw new Error(`Unknown managed routine: ${routineKey}`);
  }
  return routineKey as (typeof WIKI_MAINTENANCE_ROUTINE_KEYS)[number];
}

let activeContext: PluginContext | null = null;
const PAPERCLIP_EVENT_INGESTION_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.comment.created",
  "issue.document.created",
  "issue.document.updated",
] as const;

function requireContext(): PluginContext {
  if (!activeContext) throw new Error("LLM Wiki plugin has not been set up");
  return activeContext;
}

const plugin = definePlugin({
  async setup(ctx) {
    activeContext = ctx;
    await registerWikiTools(ctx);

    for (const eventName of PAPERCLIP_EVENT_INGESTION_EVENTS) {
      ctx.events.on(eventName, async (event) => {
        const result = await handlePaperclipEventIngestion(ctx, event);
        if (result.status === "recorded") {
          ctx.logger.info("LLM Wiki recorded Paperclip event for cursor discovery", {
            eventType: event.eventType,
            companyId: event.companyId,
            sourceKind: result.sourceKind,
            sourceId: result.sourceId,
            cursorId: result.cursorId,
          });
        }
      });
    }

    ctx.jobs.register("folder-health-check", async (job) => {
      ctx.logger.info("LLM Wiki folder health job invoked", { runId: job.runId, trigger: job.trigger });
    });

    ctx.data.register("overview", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      return getOverview(ctx, companyId);
    });

    ctx.data.register("health", async (params) => {
      const companyId = stringField(params.companyId);
      return companyId
        ? getOverview(ctx, companyId)
        : { status: "ok", checkedAt: new Date().toISOString(), message: "LLM Wiki worker is running" };
    });

    ctx.actions.register("bootstrap-root", async (params) => {
      return bootstrapWikiRoot(ctx, {
        companyId: readCompanyIdFromParams(params),
        path: stringField(params.path),
      });
    });

    ctx.actions.register("create-operation", async (params) => {
      const operationType = stringField(params.operationType);
      if (
        operationType !== "ingest" &&
        operationType !== "query" &&
        operationType !== "lint" &&
        operationType !== "file-as-page" &&
        operationType !== "index" &&
        operationType !== "distill" &&
        operationType !== "backfill"
      ) {
        throw new Error("operationType must be ingest, query, lint, file-as-page, index, distill, or backfill");
      }
      return createOperationIssue(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        operationType,
        title: stringField(params.title),
        prompt: stringField(params.prompt),
      });
    });

    ctx.actions.register("capture-source", async (params) => {
      return captureWikiSource(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        sourceType: stringField(params.sourceType),
        title: stringField(params.title),
        url: stringField(params.url),
        contents: typeof params.contents === "string" ? params.contents : "",
        rawPath: stringField(params.rawPath),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("write-page", async (params) => {
      return writeWikiPage(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        path: stringField(params.path) ?? "",
        contents: typeof params.contents === "string" ? params.contents : "",
        expectedHash: stringField(params.expectedHash),
        summary: stringField(params.summary),
        sourceRefs: params.sourceRefs,
        writer: "board_ui",
      });
    });

    ctx.actions.register("write-template", async (params) => {
      return writeTemplate(ctx, {
        companyId: readCompanyIdFromParams(params),
        path: stringField(params.path) ?? "",
        contents: typeof params.contents === "string" ? params.contents : "",
      });
    });

    ctx.actions.register("update-event-ingestion-settings", async (params) => {
      const sources = typeof params.sources === "object" && params.sources != null && !Array.isArray(params.sources)
        ? params.sources as Record<string, unknown>
        : {};
      return updateEventIngestionSettings(ctx, {
        companyId: readCompanyIdFromParams(params),
        settings: {
          enabled: params.enabled === true,
          wikiId: stringField(params.wikiId) ?? undefined,
          maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : undefined,
          sources: {
            issues: sources.issues === true,
            comments: sources.comments === true,
            documents: sources.documents === true,
          },
        },
      });
    });

    ctx.actions.register("ingest-source", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const wikiId = stringField(params.wikiId);
      const sourceType = stringField(params.sourceType) ?? "text";
      const title = stringField(params.title) ?? sourceType.toUpperCase();
      const contents = typeof params.contents === "string" ? params.contents : "";
      const url = stringField(params.url);
      const captured = await captureWikiSource(ctx, {
        companyId,
        wikiId,
        sourceType,
        title,
        url,
        contents,
        rawPath: stringField(params.rawPath),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
      const op = await createOperationIssue(ctx, {
        companyId,
        wikiId,
        operationType: "ingest",
        title: `Ingest ${sourceType}: ${title}`,
        prompt: [
          `Ingest a captured source from raw/${captured.rawPath.replace(/^raw\//, "")}.`,
          url ? `Source URL: ${url}` : null,
          "Read the captured raw file, summarize, propose new or updated wiki pages, and update wiki/index.md / wiki/log.md.",
        ].filter(Boolean).join("\n"),
      });
      return { status: "ok", source: captured, operation: op };
    });

    ctx.actions.register("assemble-paperclip-source-bundle", async (params) => {
      return assemblePaperclipSourceBundle(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
      });
    });

    ctx.actions.register("create-paperclip-distillation-run", async (params) => {
      return createPaperclipDistillationRun(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        workItemId: stringField(params.workItemId),
        operationIssueId: stringField(params.operationIssueId),
      });
    });

    ctx.actions.register("record-paperclip-distillation-outcome", async (params) => {
      const status = stringField(params.status);
      if (status !== "succeeded" && status !== "failed" && status !== "review_required") {
        throw new Error("status must be succeeded, failed, or review_required");
      }
      const runId = stringField(params.runId);
      if (!runId) throw new Error("runId is required");
      return recordPaperclipDistillationOutcome(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        runId,
        cursorId: stringField(params.cursorId),
        status,
        sourceHash: stringField(params.sourceHash),
        sourceWindowEnd: stringField(params.sourceWindowEnd),
        warning: stringField(params.warning),
        costCents: typeof params.costCents === "number" ? params.costCents : null,
        retryCount: typeof params.retryCount === "number" ? params.retryCount : null,
      });
    });

    ctx.actions.register("distill-paperclip-project-page", async (params) => {
      return distillPaperclipProjectPage(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt: stringField(params.backfillStartAt),
        backfillEndAt: stringField(params.backfillEndAt),
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        workItemId: stringField(params.workItemId),
        operationIssueId: stringField(params.operationIssueId),
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
      });
    });

    ctx.actions.register("distill-paperclip-now", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const projectId = stringField(params.projectId);
      const rootIssueId = stringField(params.rootIssueId);
      if (!projectId && !rootIssueId) throw new Error("projectId or rootIssueId is required");
      const idempotencyScope = rootIssueId ? `root:${rootIssueId}` : `project:${projectId}`;
      const workItem = await createPaperclipDistillationWorkItem(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        kind: "manual",
        projectId,
        rootIssueId,
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: "medium",
        idempotencyKey: stringField(params.idempotencyKey) ?? `manual:${idempotencyScope}`,
        metadata: { requestedFrom: "distill-paperclip-now" },
      });
      const operation = await createOperationIssue(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        operationType: "distill",
        title: rootIssueId ? "Distill Paperclip root issue into wiki" : "Distill Paperclip project into wiki",
        prompt: [
          "Manual LLM Wiki distillation requested outside recurring cadence.",
          projectId ? `Project ID: ${projectId}` : null,
          rootIssueId ? `Root issue ID: ${rootIssueId}` : null,
          "Assemble a bounded Paperclip source bundle, propose wiki patches, and record provenance/cost warnings.",
        ].filter(Boolean).join("\n"),
      });
      const result = await distillPaperclipProjectPage(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        projectId,
        rootIssueId,
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
        workItemId: workItem.workItemId,
        operationIssueId: operation.issue.id,
      });
      return { ...result, workItem, operation };
    });

    ctx.actions.register("backfill-paperclip-distillation", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const projectId = stringField(params.projectId);
      const rootIssueId = stringField(params.rootIssueId);
      if (!projectId && !rootIssueId) throw new Error("projectId or rootIssueId is required");
      const backfillStartAt = stringField(params.backfillStartAt);
      const backfillEndAt = stringField(params.backfillEndAt);
      const idempotencyScope = rootIssueId ? `root:${rootIssueId}` : `project:${projectId}`;
      const workItem = await createPaperclipDistillationWorkItem(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        kind: "backfill",
        projectId,
        rootIssueId,
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: "low",
        idempotencyKey: stringField(params.idempotencyKey) ?? `backfill:${idempotencyScope}:${backfillStartAt ?? "begin"}:${backfillEndAt ?? "now"}`,
        metadata: { backfillStartAt, backfillEndAt, requestedFrom: "backfill-paperclip-distillation" },
      });
      const operation = await createOperationIssue(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        operationType: "backfill",
        title: rootIssueId ? "Backfill Paperclip root issue wiki history" : "Backfill Paperclip project wiki history",
        prompt: [
          "Backfill LLM Wiki distillation requested for a bounded Paperclip source window.",
          projectId ? `Project ID: ${projectId}` : null,
          rootIssueId ? `Root issue ID: ${rootIssueId}` : null,
          backfillStartAt ? `Start: ${backfillStartAt}` : null,
          backfillEndAt ? `End: ${backfillEndAt}` : null,
          "Do not process whole-company history; stay within the selected project/root issue and date window.",
        ].filter(Boolean).join("\n"),
      });
      const result = await distillPaperclipProjectPage(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        projectId,
        rootIssueId,
        maxCharacters: typeof params.maxCharacters === "number" ? params.maxCharacters : null,
        maxCharactersPerSource: typeof params.maxCharactersPerSource === "number" ? params.maxCharactersPerSource : null,
        backfillStartAt,
        backfillEndAt,
        routineRun: params.routineRun === true,
        includeComments: params.includeComments !== false,
        includeDocuments: params.includeDocuments !== false,
        autoApply: params.autoApply === true ? true : params.autoApply === false ? false : undefined,
        expectedProjectPageHash: stringField(params.expectedProjectPageHash),
        includeSupportingPages: params.includeSupportingPages !== false,
        workItemId: workItem.workItemId,
        operationIssueId: operation.issue.id,
      });
      return { ...result, workItem, operation };
    });

    ctx.actions.register("create-paperclip-distillation-work-item", async (params) => {
      const kind = stringField(params.kind);
      if (
        kind !== "manual" &&
        kind !== "retry" &&
        kind !== "backfill" &&
        kind !== "priority_override" &&
        kind !== "review_patch"
      ) {
        throw new Error("kind must be manual, retry, backfill, priority_override, or review_patch");
      }
      const priority = stringField(params.priority);
      if (priority && priority !== "critical" && priority !== "high" && priority !== "medium" && priority !== "low") {
        throw new Error("priority must be critical, high, medium, or low");
      }
      return createPaperclipDistillationWorkItem(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        kind,
        projectId: stringField(params.projectId),
        rootIssueId: stringField(params.rootIssueId),
        requestedByIssueId: stringField(params.requestedByIssueId),
        priority: priority as "critical" | "high" | "medium" | "low" | null,
        idempotencyKey: stringField(params.idempotencyKey),
        metadata: typeof params.metadata === "object" && params.metadata != null ? params.metadata as Record<string, unknown> : null,
      });
    });

    ctx.actions.register("file-as-page", async (params) => {
      return fileQueryAnswerAsPage(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        querySessionId: stringField(params.querySessionId),
        question: stringField(params.question),
        answer: stringField(params.answer),
        path: stringField(params.path) ?? "",
        title: stringField(params.title),
        contents: stringField(params.contents),
        expectedHash: stringField(params.expectedHash),
      });
    });

    ctx.actions.register("start-query", async (params) => {
      return startWikiQuerySession(ctx, {
        companyId: readCompanyIdFromParams(params),
        wikiId: stringField(params.wikiId),
        question: stringField(params.question) ?? "",
        title: stringField(params.title),
      });
    });

    ctx.actions.register("reset-managed-agent", async (params) => {
      return resetWikiAgentResource(ctx, readCompanyIdFromParams(params));
    });

    ctx.actions.register("reset-managed-project", async (params) => {
      return resetWikiProjectResource(ctx, readCompanyIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-agent", async (params) => {
      return reconcileWikiAgentResource(ctx, readCompanyIdFromParams(params));
    });

    ctx.actions.register("reconcile-managed-project", async (params) => {
      return reconcileWikiProjectResource(ctx, readCompanyIdFromParams(params));
    });

    ctx.actions.register("select-managed-agent", async (params) => {
      const agentId = stringField(params.agentId);
      if (!agentId) throw new Error("agentId is required");
      return selectWikiAgentResource(ctx, {
        companyId: readCompanyIdFromParams(params),
        agentId,
      });
    });

    ctx.actions.register("select-managed-project", async (params) => {
      const projectId = stringField(params.projectId);
      if (!projectId) throw new Error("projectId is required");
      return selectWikiProjectResource(ctx, {
        companyId: readCompanyIdFromParams(params),
        projectId,
      });
    });

    ctx.actions.register("reset-managed-routine", async (params) => {
      return ctx.routines.managed.reset(routineKeyField(params.routineKey), readCompanyIdFromParams(params), {
        assigneeAgentId: stringField(params.assigneeAgentId),
        projectId: stringField(params.projectId),
      });
    });

    ctx.actions.register("reconcile-managed-routine", async (params) => {
      return ctx.routines.managed.reconcile(routineKeyField(params.routineKey), readCompanyIdFromParams(params), {
        assigneeAgentId: stringField(params.assigneeAgentId),
        projectId: stringField(params.projectId),
      });
    });

    ctx.actions.register("reconcile-managed-routines", async (params) => {
      return reconcileWikiRoutineResources(ctx, readCompanyIdFromParams(params));
    });

    ctx.actions.register("update-managed-routine-status", async (params) => {
      const status = stringField(params.status);
      if (!status) throw new Error("status is required");
      return ctx.routines.managed.update(routineKeyField(params.routineKey), readCompanyIdFromParams(params), {
        status,
      });
    });

    ctx.actions.register("run-managed-routine", async (params) => {
      return ctx.routines.managed.run(routineKeyField(params.routineKey), readCompanyIdFromParams(params), {
        assigneeAgentId: stringField(params.assigneeAgentId),
        projectId: stringField(params.projectId),
      });
    });

    ctx.data.register("pages", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      return listPages(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        pageType: stringField(params.pageType),
        includeRaw: params.includeRaw === true || params.includeRaw === "true",
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("sources", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      return listSources(ctx, { companyId, wikiId: stringField(params.wikiId), limit: typeof params.limit === "number" ? params.limit : null });
    });

    ctx.data.register("page-content", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const path = stringField(params.path);
      if (!path) throw new Error("path is required");
      return readWikiPage(ctx, { companyId, wikiId: stringField(params.wikiId), path });
    });

    ctx.data.register("template", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const path = stringField(params.path) ?? "AGENTS.md";
      return readTemplate(ctx, { companyId, path });
    });

    ctx.data.register("operations", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      return listOperations(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        operationType: stringField(params.operationType),
        status: stringField(params.status),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("distillation-overview", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      return getDistillationOverview(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        limit: typeof params.limit === "number" ? params.limit : null,
      });
    });

    ctx.data.register("distillation-page-provenance", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const pagePath = stringField(params.pagePath);
      if (!pagePath) {
        return { binding: null, runs: [], snapshot: null, cursor: null };
      }
      return getDistillationPageProvenance(ctx, {
        companyId,
        wikiId: stringField(params.wikiId),
        pagePath,
      });
    });

    ctx.data.register("settings", async (params) => {
      const companyId = readCompanyIdFromParams(params);
      const folder = await ctx.localFolders.status(companyId, WIKI_ROOT_FOLDER_KEY);
      const overview = await getOverview(ctx, companyId);
      const managedRoutines = await Promise.all(
        WIKI_MAINTENANCE_ROUTINE_KEYS.map((routineKey) => ctx.routines.managed.get(routineKey, companyId)),
      );
      return {
        folder,
        managedAgent: overview.managedAgent,
        managedProject: overview.managedProject,
        managedRoutine: managedRoutines[0],
        managedRoutines,
        distillationPolicy: getDistillationAutoApplyRestriction(),
        eventIngestion: await getEventIngestionSettings(ctx, companyId),
        agentOptions: await listWikiAgentOptions(ctx, companyId),
        projectOptions: await listWikiProjectOptions(ctx, companyId),
        capabilities: ctx.manifest.capabilities,
      };
    });
  },

  async onApiRequest(input: PluginApiRequestInput) {
    const ctx = requireContext();
    if (input.routeKey === "overview") {
      return { body: await getOverview(ctx, input.companyId) };
    }

    if (input.routeKey === "bootstrap") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await bootstrapWikiRoot(ctx, {
          companyId: input.companyId,
          path: stringField(body?.path),
        }),
      };
    }

    if (input.routeKey === "capture-source") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await captureWikiSource(ctx, {
          companyId: input.companyId,
          wikiId: stringField(body?.wikiId),
          sourceType: stringField(body?.sourceType),
          title: stringField(body?.title),
          url: stringField(body?.url),
          contents: typeof body?.contents === "string" ? body.contents : "",
          rawPath: stringField(body?.rawPath),
          metadata: typeof body?.metadata === "object" && body.metadata != null ? body.metadata as Record<string, unknown> : null,
        }),
      };
    }

    if (input.routeKey === "operations") {
      return {
        body: await listOperations(ctx, {
          companyId: input.companyId,
          wikiId: stringField(input.query.wikiId),
          operationType: stringField(input.query.operationType),
          status: stringField(input.query.status),
          limit: typeof input.query.limit === "string" ? Number(input.query.limit) : null,
        }),
      };
    }

    if (input.routeKey === "start-query") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await startWikiQuerySession(ctx, {
          companyId: input.companyId,
          wikiId: stringField(body?.wikiId),
          question: stringField(body?.question) ?? "",
          title: stringField(body?.title),
        }),
      };
    }

    if (input.routeKey === "file-as-page") {
      const body = input.body as Record<string, unknown> | null;
      return {
        status: 201,
        body: await fileQueryAnswerAsPage(ctx, {
          companyId: input.companyId,
          wikiId: stringField(body?.wikiId),
          querySessionId: stringField(body?.querySessionId),
          question: stringField(body?.question),
          answer: stringField(body?.answer),
          path: stringField(body?.path) ?? "",
          title: stringField(body?.title),
          contents: stringField(body?.contents),
          expectedHash: stringField(body?.expectedHash),
        }),
      };
    }

    return { status: 404, body: { error: `Unknown LLM Wiki route: ${input.routeKey}` } };
  },

  async onHealth() {
    return {
      status: "ok",
      message: "LLM Wiki plugin worker is running",
      details: {
        surfaces: ["page", "sidebar", "settings", "tools", "database", "local-folder"],
      },
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
