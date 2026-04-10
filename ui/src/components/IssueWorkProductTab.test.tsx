// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { IssueDeliverablesResponse } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueWorkProductTab } from "./IssueWorkProductTab";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createDeliverables(): IssueDeliverablesResponse {
  return {
    workspace: {
      id: "workspace-1",
      projectId: "project-1",
      projectWorkspaceId: "project-workspace-1",
      name: "Remote sandbox",
      mode: "adapter_managed",
      status: "active",
      providerType: "adapter_managed",
      branchName: "pap-1280-work-product",
      baseRef: "main",
      lastUsedAt: new Date("2026-04-01T14:00:00.000Z"),
      runtimeServiceCount: 1,
      runtimeServiceHealth: "healthy",
      runtimeServices: [
        {
          id: "service-1",
          serviceName: "Preview",
          status: "running",
          healthStatus: "healthy",
          url: "https://preview.example.com",
        },
      ],
    },
    summary: {
      hasAny: true,
      previewCount: 1,
      pullRequestCount: 1,
      branchCount: 0,
      commitCount: 0,
      documentCount: 1,
      fileCount: 1,
      workspaceMode: "adapter_managed",
      workspaceStatus: "active",
      previewHealth: "healthy",
      pullRequestStatus: "ready_for_review",
      pullRequestReviewState: "needs_board_review",
    },
    primaryItem: {
      id: "pr-1",
      sourceType: "work_product",
      kind: "pull_request",
      title: "PR 42",
      url: "https://example.com/pr/42",
      summary: "Ready for board review.",
      status: "ready_for_review",
      reviewState: "needs_board_review",
      healthStatus: null,
      provider: "github",
      updatedAt: new Date("2026-04-01T15:00:00.000Z"),
      createdAt: new Date("2026-04-01T14:00:00.000Z"),
      isPrimary: true,
      metadata: null,
      documentKey: null,
      revisionNumber: null,
      contentType: null,
      byteSize: null,
    },
    previews: [
      {
        id: "preview-1",
        sourceType: "work_product",
        kind: "preview_url",
        title: "Preview deploy",
        url: "https://preview.example.com",
        summary: null,
        status: "active",
        reviewState: "none",
        healthStatus: "healthy",
        provider: "vercel",
        updatedAt: new Date("2026-04-01T15:00:00.000Z"),
        createdAt: new Date("2026-04-01T14:00:00.000Z"),
        isPrimary: false,
        metadata: null,
        documentKey: null,
        revisionNumber: null,
        contentType: null,
        byteSize: null,
      },
    ],
    pullRequests: [
      {
        id: "pr-1",
        sourceType: "work_product",
        kind: "pull_request",
        title: "PR 42",
        url: "https://example.com/pr/42",
        summary: "Ready for board review.",
        status: "ready_for_review",
        reviewState: "needs_board_review",
        healthStatus: null,
        provider: "github",
        updatedAt: new Date("2026-04-01T15:00:00.000Z"),
        createdAt: new Date("2026-04-01T14:00:00.000Z"),
        isPrimary: true,
        metadata: null,
        documentKey: null,
        revisionNumber: null,
        contentType: null,
        byteSize: null,
      },
    ],
    branches: [],
    commits: [],
    documents: [
      {
        id: "document-1",
        sourceType: "document",
        kind: "document",
        title: "Plan",
        url: "#document-plan",
        summary: "Ship the thing.",
        status: null,
        reviewState: null,
        healthStatus: null,
        provider: "paperclip",
        updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        isPrimary: false,
        metadata: null,
        documentKey: "plan",
        revisionNumber: 2,
        contentType: "text/markdown",
        byteSize: null,
      },
    ],
    files: [
      {
        id: "attachment-1",
        sourceType: "attachment",
        kind: "attachment",
        title: "build-log.txt",
        url: "/api/attachments/attachment-1/content",
        summary: null,
        status: null,
        reviewState: null,
        healthStatus: null,
        provider: "paperclip",
        updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        isPrimary: false,
        metadata: null,
        documentKey: null,
        revisionNumber: null,
        contentType: "text/plain",
        byteSize: 512,
      },
    ],
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("IssueWorkProductTab", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders grouped deliverables and document deep links", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <IssueWorkProductTab
          deliverables={createDeliverables()}
          projectId="project-1"
          projectWorkspaceId="project-workspace-1"
        />,
      );
    });
    await flush();

    expect(container.textContent).toContain("Primary output");
    expect(container.textContent).toContain("Current workspace");
    expect(container.textContent).toContain("Pull requests");
    expect(container.textContent).toContain("Documents");
    expect(container.querySelector('a[href="#document-plan"]')).not.toBeNull();
  });

  it("renders the empty state when nothing has been produced", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <IssueWorkProductTab
          deliverables={{
            ...createDeliverables(),
            workspace: null,
            summary: {
              hasAny: false,
              previewCount: 0,
              pullRequestCount: 0,
              branchCount: 0,
              commitCount: 0,
              documentCount: 0,
              fileCount: 0,
              workspaceMode: null,
              workspaceStatus: null,
              previewHealth: null,
              pullRequestStatus: null,
              pullRequestReviewState: null,
            },
            primaryItem: null,
            previews: [],
            pullRequests: [],
            documents: [],
            files: [],
          }}
          projectId="project-1"
          projectWorkspaceId="project-workspace-1"
        />,
      );
    });
    await flush();

    expect(container.textContent).toContain("No deliverables are registered for this issue yet.");
  });
});
