// @vitest-environment jsdom

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WikiRouteSidebar } from "../src/ui/index.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const EXPANDED_STORAGE_KEY = `paperclipai.plugin-llm-wiki:route-sidebar-expanded:v2:${COMPANY_ID}`;

type BridgeGlobal = typeof globalThis & {
  __paperclipPluginBridge__?: {
    sdkUi?: Record<string, unknown>;
  };
};

type FileTreeNodeLike = {
  name: string;
  path: string;
  kind: string;
  children?: FileTreeNodeLike[];
};

type FileTreePropsLike = {
  nodes: FileTreeNodeLike[];
  selectedFile?: string | null;
  expandedPaths?: ReadonlySet<string> | readonly string[];
  onToggleDir?: (path: string) => void;
  onSelectFile?: (path: string) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function toArray(paths: FileTreePropsLike["expandedPaths"]): string[] {
  if (!paths) return [];
  return Array.isArray(paths) ? [...paths] : Array.from(paths);
}

function renderTreeButtons(
  nodes: FileTreeNodeLike[],
  options: Pick<FileTreePropsLike, "onSelectFile" | "onToggleDir">,
): ReturnType<typeof createElement>[] {
  const buttons: ReturnType<typeof createElement>[] = [];
  for (const node of nodes) {
    if (node.kind === "dir") {
      buttons.push(
        createElement("button", {
          key: node.path,
          type: "button",
          "data-toggle-dir": node.path,
          onClick: () => options.onToggleDir?.(node.path),
        }, node.name),
      );
    } else {
      buttons.push(
        createElement("button", {
          key: node.path,
          type: "button",
          "data-select-file": node.path,
          onClick: () => options.onSelectFile?.(node.path),
        }, node.name),
      );
    }
    buttons.push(...renderTreeButtons(node.children ?? [], options));
  }
  return buttons;
}

describe("WikiRouteSidebar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hostLocation: { pathname: string; search: string; hash: string; state?: unknown };
  let navigatedTo: { to: string; options?: unknown } | null;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    hostLocation = {
      pathname: "/PAP/wiki/page/wiki/concepts/sidebar-navigation.md",
      search: "",
      hash: "",
    };
    navigatedTo = null;
    (globalThis as BridgeGlobal).__paperclipPluginBridge__ = {
      sdkUi: {
        usePluginData: (key: string) => {
          if (key !== "pages") return { data: null, loading: false, error: null, refresh: () => undefined };
          return {
            data: {
              pages: [
                {
                  path: "wiki/concepts/sidebar-navigation.md",
                  title: "Sidebar navigation",
                  pageType: "concepts",
                  backlinkCount: 0,
                  sourceCount: 0,
                  contentHash: "abc123",
                  updatedAt: new Date().toISOString(),
                },
              ],
              sources: [],
            },
            loading: false,
            error: null,
            refresh: () => undefined,
          };
        },
        useHostLocation: () => hostLocation,
        useHostNavigation: () => ({
          resolveHref: (to: string) => `/PAP${to.startsWith("/") ? to : `/${to}`}`,
          navigate: (to: string, options?: unknown) => {
            navigatedTo = { to, options };
          },
          linkProps: (to: string) => ({
            href: `/PAP${to.startsWith("/") ? to : `/${to}`}`,
            onClick: () => undefined,
          }),
        }),
        FileTree: (props: FileTreePropsLike) => createElement(
          "div",
          {
            role: "tree",
            "data-selected-file": props.selectedFile ?? "",
            "data-expanded-paths": toArray(props.expandedPaths).sort().join("|"),
          },
          renderTreeButtons(props.nodes, props),
        ),
      },
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    delete (globalThis as BridgeGlobal).__paperclipPluginBridge__;
  });

  it("defaults wiki categories open so local files are visible", () => {
    act(() => {
      root.render(createElement(WikiRouteSidebar, {
        context: { companyId: COMPANY_ID, companyPrefix: "PAP" },
      } as never));
    });

    const tree = container.querySelector("[role='tree']") as HTMLElement;
    expect(tree.dataset.expandedPaths?.split("|")).toEqual([
      "wiki",
      "wiki/concepts",
      "wiki/entities",
      "wiki/projects",
      "wiki/sources",
      "wiki/synthesis",
    ]);
  });

  it("persists folder expansion client-side", () => {
    act(() => {
      root.render(createElement(WikiRouteSidebar, {
        context: { companyId: COMPANY_ID, companyPrefix: "PAP" },
      } as never));
    });

    act(() => {
      (container.querySelector("[data-toggle-dir='raw']") as HTMLButtonElement).click();
    });

    expect(JSON.parse(window.localStorage.getItem(EXPANDED_STORAGE_KEY) ?? "[]")).toEqual([
      "raw",
      "wiki",
      "wiki/concepts",
      "wiki/entities",
      "wiki/projects",
      "wiki/sources",
      "wiki/synthesis",
    ]);

    act(() => {
      root.unmount();
    });
    root = createRoot(container);

    act(() => {
      root.render(createElement(WikiRouteSidebar, {
        context: { companyId: COMPANY_ID, companyPrefix: "PAP" },
      } as never));
    });

    const tree = container.querySelector("[role='tree']") as HTMLElement;
    expect(tree.dataset.expandedPaths).toBe("raw|wiki|wiki/concepts|wiki/entities|wiki/projects|wiki/sources|wiki/synthesis");
  });

  it("does not select a wiki-link destination from the route", () => {
    act(() => {
      root.render(createElement(WikiRouteSidebar, {
        context: { companyId: COMPANY_ID, companyPrefix: "PAP" },
      } as never));
    });

    const tree = () => container.querySelector("[role='tree']") as HTMLElement;
    expect(tree().dataset.selectedFile).toBe("");
  });

  it("keeps sidebar tree selection scoped to sidebar navigation", () => {
    act(() => {
      root.render(createElement(WikiRouteSidebar, {
        context: { companyId: COMPANY_ID, companyPrefix: "PAP" },
      } as never));
    });

    const tree = () => container.querySelector("[role='tree']") as HTMLElement;

    act(() => {
      (container.querySelector("[data-select-file='wiki/concepts/sidebar-navigation.md']") as HTMLButtonElement).click();
    });

    expect(navigatedTo).toEqual({
      to: "/wiki/page/wiki/concepts/sidebar-navigation.md",
      options: { state: { paperclipWikiSidebarTreePath: "wiki/concepts/sidebar-navigation.md" } },
    });
    expect(tree().dataset.selectedFile).toBe("wiki/concepts/sidebar-navigation.md");

    hostLocation = {
      pathname: "/PAP/wiki/page/wiki/entities/paperclip.md",
      search: "",
      hash: "",
    };
    act(() => {
      root.render(createElement(WikiRouteSidebar, {
        context: { companyId: COMPANY_ID, companyPrefix: "PAP" },
      } as never));
    });

    expect(tree().dataset.selectedFile).toBe("wiki/concepts/sidebar-navigation.md");

    act(() => {
      (container.querySelector("[data-toggle-dir='wiki/concepts']") as HTMLButtonElement).click();
    });

    expect(tree().dataset.selectedFile).toBe("wiki/concepts/sidebar-navigation.md");
    expect(tree().dataset.expandedPaths?.split("|")).not.toContain("wiki/concepts");
  });
});
