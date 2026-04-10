import type { IssueDeliverablesSummary } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function workspaceModeLabel(mode: string) {
  switch (mode) {
    case "shared_workspace":
      return "Shared";
    case "isolated_workspace":
      return "Isolated";
    case "operator_branch":
      return "Operator branch";
    case "adapter_managed":
      return "Adapter managed";
    case "cloud_sandbox":
      return "Cloud sandbox";
    default:
      return labelize(mode);
  }
}

export function IssueDeliverablesSummaryChips({ summary }: { summary: IssueDeliverablesSummary | null | undefined }) {
  if (!summary) return null;

  const chips: string[] = [];
  if (summary.workspaceMode) {
    chips.push(`Workspace: ${workspaceModeLabel(summary.workspaceMode)}`);
  }
  if (summary.pullRequestCount > 0) {
    if (summary.pullRequestCount === 1) {
      const prState = summary.pullRequestReviewState && summary.pullRequestReviewState !== "none"
        ? summary.pullRequestReviewState
        : summary.pullRequestStatus;
      chips.push(`PR: ${prState ? labelize(prState) : "1"}`);
    } else {
      chips.push(`PRs: ${summary.pullRequestCount}`);
    }
  }
  if (summary.previewCount > 0) {
    if (summary.previewCount === 1 && summary.previewHealth) {
      chips.push(`Preview: ${labelize(summary.previewHealth)}`);
    } else {
      chips.push(`Previews: ${summary.previewCount}`);
    }
  }
  if (summary.documentCount > 0) {
    chips.push(`Docs: ${summary.documentCount}`);
  }
  if (summary.fileCount > 0) {
    chips.push(`Files: ${summary.fileCount}`);
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Badge key={chip} variant="secondary" className="text-[11px] font-medium">
          {chip}
        </Badge>
      ))}
    </div>
  );
}
