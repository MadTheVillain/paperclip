import { readFileSync } from "node:fs";

export const REQUIRED_WIKI_DIRECTORIES = [
  "raw",
  "wiki",
  "wiki/sources",
  "wiki/projects",
  "wiki/entities",
  "wiki/concepts",
  "wiki/synthesis",
] as const;

export const REQUIRED_WIKI_FILES = ["AGENTS.md", "IDEA.md", "wiki/index.md", "wiki/log.md"] as const;
export const KARPATHY_LLM_WIKI_GIST_URL = "https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f";

function templateFile(path: string): string {
  return readFileSync(new URL(`../templates/${path}`, import.meta.url), "utf8");
}

function promptFile(path: string): string {
  return readFileSync(new URL(`../prompts/${path}`, import.meta.url), "utf8");
}

export const DEFAULT_WIKI_SCHEMA = templateFile("AGENTS.md");
export const DEFAULT_AGENT_INSTRUCTIONS = templateFile("WIKI_MAINTAINER_AGENT.md");
export const DEFAULT_IDEA = templateFile("IDEA.md");
export const DEFAULT_INDEX = templateFile("wiki/index.md");
export const DEFAULT_LOG = templateFile("wiki/log.md");
export const DEFAULT_GITIGNORE = templateFile(".gitignore");
export const PAPERCLIP_SOURCE_BUNDLE_PROMPT = promptFile("paperclip-source-bundle.md");
export const PROJECT_PAGE_DISTILL_PROMPT = promptFile("project-page-distill.md");
export const DECISION_DISTILL_PROMPT = promptFile("decision-distill.md");
export const STATUS_REFRESH_PROMPT = promptFile("status-refresh.md");
export const BACKFILL_PROMPT = promptFile("backfill.md");

export const INGEST_PROMPT = `You are ingesting source material into a local LLM Wiki.

Follow AGENTS.md. Read IDEA.md if you need the pattern background. Read wiki/index.md and recent wiki/log.md entries, read the raw source, summarize durable knowledge, update or propose focused wiki pages, keep provenance links back to raw/, refresh wiki/index.md, and append wiki/log.md.
`;

export const QUERY_PROMPT = `Answer from the LLM Wiki.

Read wiki/index.md first, inspect relevant pages and raw/source references, cite the wiki page paths and raw source paths used, and say when the wiki does not contain enough evidence. Useful durable synthesis should be filed back into wiki/.
`;

export const LINT_PROMPT = `Lint the LLM Wiki for contradictions, stale claims, orphan pages, missing backlinks, weak provenance, and wiki/index.md / wiki/log.md drift.

Also look for important concepts mentioned without pages and answers that should have been filed back into wiki/. Return findings with severity, concrete file paths, evidence, and suggested fixes.
`;

export const BOOTSTRAP_FILES: ReadonlyArray<{ path: string; contents: string }> = [
  { path: ".gitignore", contents: DEFAULT_GITIGNORE },
  { path: "AGENTS.md", contents: DEFAULT_WIKI_SCHEMA },
  { path: "IDEA.md", contents: DEFAULT_IDEA },
  { path: "wiki/index.md", contents: DEFAULT_INDEX },
  { path: "wiki/log.md", contents: DEFAULT_LOG },
  { path: "raw/.gitkeep", contents: "" },
  { path: "wiki/sources/.gitkeep", contents: "" },
  { path: "wiki/projects/.gitkeep", contents: "" },
  { path: "wiki/entities/.gitkeep", contents: "" },
  { path: "wiki/concepts/.gitkeep", contents: "" },
  { path: "wiki/synthesis/.gitkeep", contents: "" },
];
