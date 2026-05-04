import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_AGENT_INSTRUCTIONS } from "./templates.js";

export const PLUGIN_ID = "paperclipai.plugin-llm-wiki";
export const WIKI_ROOT_FOLDER_KEY = "wiki-root";
export const WIKI_MAINTAINER_AGENT_KEY = "wiki-maintainer";
export const WIKI_PROJECT_KEY = "llm-wiki";
export const CURSOR_WINDOW_ROUTINE_KEY = "cursor-window-processing";
export const NIGHTLY_LINT_ROUTINE_KEY = "nightly-wiki-lint";
export const INDEX_REFRESH_ROUTINE_KEY = "index-refresh";
export const DEFAULT_MAX_SOURCE_BYTES = 250000;
export const DEFAULT_MAX_PAPERCLIP_ISSUE_SOURCE_CHARS = 12000;
export const DEFAULT_MAX_PAPERCLIP_CURSOR_WINDOW_CHARS = 60000;
export const DEFAULT_MAX_PAPERCLIP_ROUTINE_RUN_CHARS = 120000;
export const DEFAULT_MAX_PAPERCLIP_ROUTINE_RUN_COST_CENTS = 100;
export const DEFAULT_PAPERCLIP_COST_CENTS_PER_1K_CHARS = 1;
export const WIKI_MAINTENANCE_ROUTINE_KEYS = [
  CURSOR_WINDOW_ROUTINE_KEY,
  NIGHTLY_LINT_ROUTINE_KEY,
  INDEX_REFRESH_ROUTINE_KEY,
] as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "LLM Wiki",
  description: "Local-file LLM Wiki plugin for source ingestion, wiki browsing, query, lint, and maintenance workflows.",
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: [
    "events.subscribe",
    "jobs.schedule",
    "api.routes.register",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "companies.read",
    "projects.read",
    "projects.managed",
    "issues.read",
    "issue.subtree.read",
    "issues.create",
    "issues.update",
    "issues.wakeup",
    "issues.orchestration.read",
    "issue.comments.read",
    "issue.comments.create",
    "issue.documents.read",
    "issue.documents.write",
    "agents.read",
    "agents.managed",
    "agent.sessions.create",
    "agent.sessions.list",
    "agent.sessions.send",
    "agent.sessions.close",
    "routines.managed",
    "local.folders",
    "agent.tools.register",
    "metrics.write",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "ui.sidebar.register",
    "ui.page.register",
    "instance.settings.register"
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      autoApplyIngestPatches: {
        type: "boolean",
        title: "Auto-apply ingest patches",
        default: false,
        description: "Allow ingest operations to apply generated wiki changes without a manual accept step. Ignored in authenticated/public deployments, which always require manual review before wiki writes."
      },
      maxSourceBytes: {
        type: "number",
        title: "Maximum source size",
        default: DEFAULT_MAX_SOURCE_BYTES,
        description: "Maximum bytes accepted for pasted or fetched source content."
      },
      maxPaperclipIssueSourceCharacters: {
        type: "number",
        title: "Maximum Paperclip source characters per issue",
        default: DEFAULT_MAX_PAPERCLIP_ISSUE_SOURCE_CHARS,
        description: "Maximum characters included from one Paperclip issue, comment, or document during distillation."
      },
      maxPaperclipCursorWindowCharacters: {
        type: "number",
        title: "Maximum Paperclip cursor window characters",
        default: DEFAULT_MAX_PAPERCLIP_CURSOR_WINDOW_CHARS,
        description: "Maximum characters included in one cursor-window distillation bundle."
      },
      maxPaperclipRoutineRunCharacters: {
        type: "number",
        title: "Maximum Paperclip routine run characters",
        default: DEFAULT_MAX_PAPERCLIP_ROUTINE_RUN_CHARS,
        description: "Maximum source characters processed by one managed distillation routine run."
      },
      maxPaperclipRoutineRunCostCents: {
        type: "number",
        title: "Maximum Paperclip routine run cost",
        default: DEFAULT_MAX_PAPERCLIP_ROUTINE_RUN_COST_CENTS,
        description: "Estimated cost cap in cents for one Paperclip distillation run. Runs are refused before page generation when the estimate exceeds this cap."
      },
      paperclipCostCentsPerThousandSourceCharacters: {
        type: "number",
        title: "Paperclip source cost estimate",
        default: DEFAULT_PAPERCLIP_COST_CENTS_PER_1K_CHARS,
        description: "Conservative cost estimate used to stop Paperclip distillation before runaway token spend."
      }
    }
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  database: {
    namespaceSlug: "llm_wiki",
    migrationsDir: "migrations",
    coreReadTables: ["companies", "issues", "projects", "agents"]
  },
  localFolders: [
    {
      folderKey: WIKI_ROOT_FOLDER_KEY,
      displayName: "Wiki root",
      description: "Company-scoped local folder that stores raw sources, wiki pages, AGENTS.md, IDEA.md, wiki/index.md, and wiki/log.md.",
      access: "readWrite",
      requiredDirectories: [
        "raw",
        "wiki",
        "wiki/sources",
        "wiki/projects",
        "wiki/entities",
        "wiki/concepts",
        "wiki/synthesis"
      ],
      requiredFiles: ["AGENTS.md", "IDEA.md", "wiki/index.md", "wiki/log.md"]
    }
  ],
  agents: [
    {
      agentKey: WIKI_MAINTAINER_AGENT_KEY,
      displayName: "Wiki Maintainer",
      role: "knowledge-maintainer",
      title: "LLM Wiki Maintainer",
      icon: "book-open",
      capabilities: "Ingests source material, maintains local wiki pages, answers cited questions, and runs wiki lint/maintenance through plugin tools.",
      adapterType: "claude_local",
      adapterPreference: ["claude_local", "codex_local", "gemini_local", "opencode_local", "cursor", "pi_local"],
      adapterConfig: {},
      runtimeConfig: {
        modelProfiles: {
          cheap: {
            purpose: "classification, lint planning, index maintenance"
          }
        }
      },
      permissions: {
        pluginTools: [PLUGIN_ID]
      },
      status: "paused",
      budgetMonthlyCents: 0,
      instructions: {
        entryFile: "AGENTS.md",
        content: DEFAULT_AGENT_INSTRUCTIONS
      }
    }
  ],
  projects: [
    {
      projectKey: WIKI_PROJECT_KEY,
      displayName: "LLM Wiki",
      description: "Plugin-managed inspection area for LLM Wiki ingest, query, lint, and maintenance operation issues.",
      status: "in_progress",
      color: "#2563eb"
    }
  ],
  routines: [
    {
      routineKey: CURSOR_WINDOW_ROUTINE_KEY,
      title: "Process LLM Wiki updates",
      description: "Scheduled Paperclip issue-history distillation that processes bounded cursor windows, retries, and selected backfill work into project wiki patches.",
      status: "paused",
      priority: "low",
      assigneeRef: { resourceKind: "agent", resourceKey: WIKI_MAINTAINER_AGENT_KEY },
      projectRef: { resourceKind: "project", resourceKey: WIKI_PROJECT_KEY },
      concurrencyPolicy: "skip_if_active",
      catchUpPolicy: "skip_missed",
      triggers: [
        {
          kind: "schedule",
          label: "Every 6 hours",
          enabled: false,
          cronExpression: "0 */6 * * *",
          timezone: "UTC",
          signingMode: null,
          replayWindowSec: null
        }
      ],
      issueTemplate: {
        surfaceVisibility: "plugin_operation",
        originId: "routine:cursor-window-processing",
        billingCode: "plugin-llm-wiki:distillation"
      }
    },
    {
      routineKey: NIGHTLY_LINT_ROUTINE_KEY,
      title: "Run LLM Wiki lint",
      description: "Scheduled wiki maintenance that checks index/log drift, orphan pages, missing backlinks, and stale source provenance.",
      status: "paused",
      priority: "low",
      assigneeRef: { resourceKind: "agent", resourceKey: WIKI_MAINTAINER_AGENT_KEY },
      projectRef: { resourceKind: "project", resourceKey: WIKI_PROJECT_KEY },
      concurrencyPolicy: "skip_if_active",
      catchUpPolicy: "skip_missed",
      triggers: [
        {
          kind: "schedule",
          label: "Nightly",
          enabled: false,
          cronExpression: "0 3 * * *",
          timezone: "UTC",
          signingMode: null,
          replayWindowSec: null
        }
      ],
      issueTemplate: {
        surfaceVisibility: "plugin_operation",
        originId: "routine:nightly-wiki-lint",
        billingCode: "plugin-llm-wiki:maintenance"
      }
    },
    {
      routineKey: INDEX_REFRESH_ROUTINE_KEY,
      title: "Refresh LLM Wiki index",
      description: "Scheduled wiki maintenance that refreshes wiki/index.md, updates wiki/log.md, and checks that recently changed pages are linked from the index.",
      status: "paused",
      priority: "low",
      assigneeRef: { resourceKind: "agent", resourceKey: WIKI_MAINTAINER_AGENT_KEY },
      projectRef: { resourceKind: "project", resourceKey: WIKI_PROJECT_KEY },
      concurrencyPolicy: "skip_if_active",
      catchUpPolicy: "skip_missed",
      triggers: [
        {
          kind: "schedule",
          label: "Hourly",
          enabled: false,
          cronExpression: "0 * * * *",
          timezone: "UTC",
          signingMode: null,
          replayWindowSec: null
        }
      ],
      issueTemplate: {
        surfaceVisibility: "plugin_operation",
        originId: "routine:index-refresh",
        billingCode: "plugin-llm-wiki:maintenance"
      }
    }
  ],
  jobs: [
    {
      jobKey: "folder-health-check",
      displayName: "Wiki folder health check",
      description: "Records lightweight health metadata for configured wiki roots.",
      schedule: "0 * * * *"
    }
  ],
  tools: [
    {
      name: "wiki_search",
      displayName: "Search Wiki",
      description: "Search indexed wiki page and source metadata.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" }
        },
        required: ["companyId", "wikiId", "query"]
      }
    },
    {
      name: "wiki_read_page",
      displayName: "Read Wiki Page",
      description: "Read a markdown wiki page from the configured local wiki root.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          path: { type: "string" }
        },
        required: ["companyId", "wikiId", "path"]
      }
    },
    {
      name: "wiki_write_page",
      displayName: "Write Wiki Page",
      description: "Atomically write a markdown wiki page after plugin path validation and optional hash conflict checks. Protected control files such as AGENTS.md and IDEA.md are excluded from agent-tool writes.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          path: { type: "string" },
          contents: { type: "string" },
          expectedHash: { type: "string" },
          summary: { type: "string" }
        },
        required: ["companyId", "wikiId", "path", "contents"]
      }
    },
    {
      name: "wiki_propose_patch",
      displayName: "Propose Wiki Patch",
      description: "Return a structured proposed page write without changing files.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          path: { type: "string" },
          contents: { type: "string" },
          summary: { type: "string" }
        },
        required: ["companyId", "wikiId", "path", "contents"]
      }
    },
    {
      name: "wiki_list_sources",
      displayName: "List Wiki Sources",
      description: "Return captured raw source metadata from the plugin index.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          limit: { type: "number" }
        },
        required: ["companyId", "wikiId"]
      }
    },
    {
      name: "wiki_read_source",
      displayName: "Read Wiki Source",
      description: "Read a captured raw source from the configured local wiki root.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          rawPath: { type: "string" }
        },
        required: ["companyId", "wikiId", "rawPath"]
      }
    },
    {
      name: "wiki_append_log",
      displayName: "Append Wiki Log",
      description: "Append a maintenance note to wiki/log.md.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          entry: { type: "string" }
        },
        required: ["companyId", "wikiId", "entry"]
      }
    },
    {
      name: "wiki_update_index",
      displayName: "Update Wiki Index",
      description: "Atomically replace wiki/index.md with optional hash conflict checks.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          contents: { type: "string" },
          expectedHash: { type: "string" }
        },
        required: ["companyId", "wikiId", "contents"]
      }
    },
    {
      name: "wiki_list_backlinks",
      displayName: "List Wiki Backlinks",
      description: "Return indexed backlinks for a wiki page.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" },
          path: { type: "string" }
        },
        required: ["companyId", "wikiId", "path"]
      }
    },
    {
      name: "wiki_list_pages",
      displayName: "List Wiki Pages",
      description: "Return the known page index from plugin metadata.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          wikiId: { type: "string" }
        },
        required: ["companyId", "wikiId"]
      }
    }
  ],
  apiRoutes: [
    {
      routeKey: "overview",
      method: "GET",
      path: "/overview",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" }
    },
    {
      routeKey: "bootstrap",
      method: "POST",
      path: "/bootstrap",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" }
    },
    {
      routeKey: "capture-source",
      method: "POST",
      path: "/sources",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" }
    },
    {
      routeKey: "operations",
      method: "GET",
      path: "/operations",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" }
    },
    {
      routeKey: "start-query",
      method: "POST",
      path: "/query-sessions",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" }
    },
    {
      routeKey: "file-as-page",
      method: "POST",
      path: "/file-as-page",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" }
    }
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "wiki-sidebar",
        displayName: "Wiki",
        exportName: "SidebarLink",
        order: 35
      },
      {
        type: "page",
        id: "wiki-page",
        displayName: "Wiki",
        exportName: "WikiPage",
        routePath: "wiki"
      },
      {
        type: "routeSidebar",
        id: "wiki-route-sidebar",
        displayName: "Wiki",
        exportName: "WikiRouteSidebar",
        routePath: "wiki"
      },
      {
        type: "settingsPage",
        id: "settings",
        displayName: "LLM Wiki",
        exportName: "SettingsPage"
      }
    ]
  }
};

export default manifest;
