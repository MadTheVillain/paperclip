import { useMemo } from "react";
import { Bot, Hexagon } from "lucide-react";
import type { Agent, CompanySearchResult, Project } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { StatusIcon } from "../StatusIcon";
import { StatusBadge } from "../StatusBadge";
import { Identity } from "../Identity";
import { HighlightedText } from "./HighlightedText";
import { MatchSourceChip, type MatchSourceChipKind } from "./MatchSourceChip";

const SNIPPET_FIELD_LABEL: Record<string, string> = {
  comment: "COMMENT",
  document: "DOC",
  identifier: "IDENTIFIER",
  description: "DESCRIPTION",
  title: "TITLE",
};

function deriveChips(matchedFields: string[]): Array<{ kind: MatchSourceChipKind; count?: number }> {
  const counts = new Map<MatchSourceChipKind, number>();
  for (const field of matchedFields) {
    let kind: MatchSourceChipKind | null = null;
    if (field === "title" || field === "description") kind = "title";
    else if (field === "identifier") kind = "identifier";
    else if (field === "comment") kind = "comment";
    else if (field === "document") kind = "document";
    if (!kind) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const order: MatchSourceChipKind[] = ["title", "identifier", "comment", "document"];
  return order
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ kind, count: counts.get(kind) ?? 1 }));
}

function formatRelativeTime(input: string | null): string {
  if (!input) return "";
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return "";
  const diffMs = Date.now() - value.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.round(days / 365);
  return `${years}y`;
}

export interface SearchResultRowProps {
  result: CompanySearchResult;
  agentsById?: ReadonlyMap<string, Pick<Agent, "id" | "name">>;
  projectsById?: ReadonlyMap<string, Pick<Project, "id" | "name">>;
  isActive?: boolean;
  className?: string;
}

export function SearchResultRow({
  result,
  agentsById,
  projectsById,
  isActive,
  className,
}: SearchResultRowProps) {
  const chips = useMemo(() => deriveChips(result.matchedFields), [result.matchedFields]);

  if (result.type === "agent") {
    return (
      <Link
        to={result.href}
        className={cn(
          "group flex items-start gap-3 px-3 py-2 hover:bg-accent/40",
          isActive && "bg-accent/40",
          className,
        )}
        data-result-type="agent"
      >
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bot className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{result.title}</span>
          </div>
          {result.snippet ? (
            <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {result.sourceLabel ?? "Agent"}
              </span>
              <HighlightedText
                text={result.snippets[0]?.text ?? result.snippet}
                highlights={result.snippets[0]?.highlights}
                className="truncate text-xs text-muted-foreground"
              />
            </div>
          ) : null}
        </div>
      </Link>
    );
  }

  if (result.type === "project") {
    return (
      <Link
        to={result.href}
        className={cn(
          "group flex items-start gap-3 px-3 py-2 hover:bg-accent/40",
          isActive && "bg-accent/40",
          className,
        )}
        data-result-type="project"
      >
        <Hexagon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{result.title}</span>
          {result.snippet ? (
            <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {result.sourceLabel ?? "Project"}
              </span>
              <HighlightedText
                text={result.snippets[0]?.text ?? result.snippet}
                highlights={result.snippets[0]?.highlights}
                className="truncate text-xs text-muted-foreground"
              />
            </div>
          ) : null}
        </div>
      </Link>
    );
  }

  const issue = result.issue;
  if (!issue) return null;
  const assigneeName = issue.assigneeAgentId
    ? agentsById?.get(issue.assigneeAgentId)?.name ?? null
    : null;
  const projectName = issue.projectId ? projectsById?.get(issue.projectId)?.name ?? null : null;
  const updated = formatRelativeTime(result.updatedAt ?? issue.updatedAt);
  const titleHighlights = result.snippets.find((snippet) => snippet.field === "title")?.highlights;

  return (
    <Link
      to={result.href}
      className={cn(
        "group flex items-start gap-3 px-3 py-2 hover:bg-accent/40",
        isActive && "bg-accent/40",
        className,
      )}
      data-result-type="issue"
    >
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={issue.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          {issue.identifier ? (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {issue.identifier}
            </span>
          ) : null}
          <HighlightedText
            text={issue.title}
            highlights={titleHighlights}
            className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug"
          />
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <StatusBadge status={issue.status} />
            {assigneeName ? <Identity name={assigneeName} size="sm" /> : null}
            {projectName ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Hexagon className="h-3 w-3" />
                <span className="max-w-[10ch] truncate">{projectName}</span>
              </span>
            ) : null}
            {updated ? (
              <span className="text-xs text-muted-foreground tabular-nums">{updated}</span>
            ) : null}
          </div>
        </div>
        {chips.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {chips.map((chip) => (
              <MatchSourceChip key={chip.kind} kind={chip.kind} count={chip.count} />
            ))}
          </div>
        ) : null}
        {result.snippets
          .filter((snippet) => snippet.field !== "title")
          .slice(0, 2)
          .map((snippet, index) => (
            <div
              key={`${snippet.field}-${index}`}
              className="mt-1 flex min-w-0 items-baseline gap-2"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {SNIPPET_FIELD_LABEL[snippet.field] ?? snippet.label.toUpperCase()}
              </span>
              <HighlightedText
                text={snippet.text}
                highlights={snippet.highlights}
                className="line-clamp-1 truncate text-xs text-muted-foreground"
              />
            </div>
          ))}
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
          <StatusBadge status={issue.status} />
          {assigneeName ? <span className="truncate">{assigneeName}</span> : null}
          {projectName ? <span className="truncate">· {projectName}</span> : null}
          {updated ? <span className="ml-auto tabular-nums">{updated}</span> : null}
        </div>
      </div>
    </Link>
  );
}
