# LLM Wiki

Local-file LLM Wiki plugin for source ingestion, wiki browsing, query, lint, and maintenance workflows.

## Scope

This package is the standalone home for LLM Wiki behavior. Wiki-specific routes,
UI, prompts, tools, local-folder templates, migrations, fixtures, and tests live
here rather than in Paperclip core.

The alpha surface includes:

- manifest-declared Wiki page, sidebar entry, and settings page
- trusted local folder declaration for `raw/`, `wiki/`, `AGENTS.md`, `IDEA.md`, `wiki/index.md`, and `wiki/log.md`
- plugin database namespace migration for wiki instances, sources, pages, operations, query sessions, and resource bindings
- managed `Wiki Maintainer` agent, managed `LLM Wiki` project, and paused managed routines for wiki update processing, lint, and index refresh
- plugin-operation issue creation using `surfaceVisibility: "plugin_operation"`
- local source capture into `raw/` with metadata rows in the plugin DB namespace
- opt-in company-scoped Paperclip event ingestion controls for issues, comments, and documents; event ingestion is disabled by default
- manual Paperclip project/root issue distillation and bounded backfill actions with explicit work items, operation issues, source caps, and estimated cost-cap refusal
- wiki page writes with plugin path validation, atomic local-folder writes, metadata/revision rows, backlink extraction, and optional stale-hash protection
- wiki tools for search/read/write/propose patch/source/log/index/backlinks workflows

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

From the Paperclip repo root:

```bash
pnpm --filter @paperclipai/plugin-llm-wiki typecheck
pnpm --filter @paperclipai/plugin-llm-wiki test
pnpm --filter @paperclipai/plugin-llm-wiki build
```

## Alpha Verification

Run these commands from the Paperclip repo root before handing off alpha plugin
changes:

```bash
pnpm --filter @paperclipai/plugin-llm-wiki typecheck
pnpm --filter @paperclipai/plugin-llm-wiki test
pnpm --filter @paperclipai/plugin-llm-wiki build
```

The focused Vitest suite covers:

- standalone package boundaries and package-local harness dependencies
- required local folder bootstrap writes
- raw source capture plus ingest metadata persistence
- hidden plugin-operation issue creation for ingest/query/file-as-page workflows
- disabled and enabled Paperclip event ingestion paths
- managed routine declarations, manual distill/backfill work items, cost cap refusal, and backfill project/date scoping
- atomic page writes, metadata/revision rows, backlinks, and stale-hash refusal
- query session creation, run-id recording, stream event forwarding, and completion updates
- filing a streamed query answer back into the wiki through a hidden operation

Remaining alpha gaps:

- Browser screenshot capture is maintained separately under `tests/screenshots`
  and is not part of the cheap package verification path above.
- Host-level plugin install and live agent invocation still need Paperclip
  server/runtime smoke coverage when preparing a release candidate.



## Install Into Paperclip

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/Users/dotta/paperclip/.paperclip/worktrees/PAP-3179-design-a-llm-wiki-plugin/packages/plugins/plugin-llm-wiki","isLocalPath":true}'
```

## Build Options

- `pnpm build` uses esbuild presets from `@paperclipai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.

## Local File Layout

```text
<configured-wiki-root>/
  AGENTS.md
  IDEA.md
  .gitignore
  raw/
    .gitkeep
  wiki/
    index.md
    log.md
    sources/
      .gitkeep
    projects/
      .gitkeep
    entities/
      .gitkeep
    concepts/
      .gitkeep
    synthesis/
      .gitkeep
```

Use the settings page or `bootstrap-root` action to configure the folder and
write the starter files. The plugin uses Paperclip's local folder API for path
containment, symlink checks, read/write validation, and atomic writes.

Bootstrap preserves existing files rather than overwriting operator edits. The
default first-install skeleton is copied from the vanilla LLM Wiki layout, with
`CLAUDE.md` renamed to `AGENTS.md`.
