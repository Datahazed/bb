// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AppSummary, WorkspacePathEntry } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NewTabPage } from "./NewTabPage";
import type { FileSearchSelection } from "./useThreadFileTabs";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    searchProjectPaths: vi.fn(),
    listThreadApps: vi.fn(),
    listThreadStoragePaths: vi.fn(),
  };
});

interface PathEntryFixture {
  kind: WorkspacePathEntry["kind"];
  path: string;
  score: number;
  positions?: number[];
}

interface PathListFixtureResponse {
  paths: WorkspacePathEntry[];
  truncated: boolean;
}

interface RenderNewTabPageArgs {
  projectId?: string;
  currentThreadId?: string;
  currentThreadType?: "manager" | "standard";
  onSelect?: (selection: FileSearchSelection) => void;
}

function getPathName(pathValue: string): string {
  return pathValue.split("/").at(-1) ?? pathValue;
}

function makePathEntry(fixture: PathEntryFixture): WorkspacePathEntry {
  return {
    kind: fixture.kind,
    path: fixture.path,
    name: getPathName(fixture.path),
    score: fixture.score,
    positions: fixture.positions ?? [],
  };
}

function makePathResponse(
  fixtures: PathEntryFixture[],
): PathListFixtureResponse {
  return {
    paths: fixtures.map(makePathEntry),
    truncated: false,
  };
}

const STATUS_APP: AppSummary = {
  id: "status",
  name: "Status",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
};

function renderNewTabPage(args: RenderNewTabPageArgs = {}) {
  const { wrapper } = createQueryClientTestHarness();
  const onSelect: (selection: FileSearchSelection) => void =
    args.onSelect ?? vi.fn();
  return {
    onSelect,
    ...render(
      <NewTabPage
        projectId={args.projectId}
        environmentId="env-1"
        currentThreadId={args.currentThreadId ?? "thr-standard"}
        currentThreadType={args.currentThreadType ?? "standard"}
        focusRequest={0}
        onSelect={onSelect}
      />,
      { wrapper },
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewTabPage", () => {
  it("autofocuses search and selects a workspace result", async () => {
    vi.mocked(api.listThreadApps).mockResolvedValue([]);
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/app.ts",
          score: 80,
        },
      ]),
    );
    const { onSelect } = renderNewTabPage({ projectId: "proj-1" });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "app" } });
    expect(await screen.findByText("Files")).toBeTruthy();
    expect(await screen.findByText("app.ts")).toBeTruthy();
    expect(await screen.findByText(/src/u)).toBeTruthy();
    expect(screen.queryByText("Manager Storage")).toBeNull();
    fireEvent.click(
      await screen.findByRole("option", { name: /app\.ts/u }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      source: "workspace",
      path: "src/app.ts",
    });
  });

  it("lists apps and opens an app selection", async () => {
    vi.mocked(api.listThreadApps).mockResolvedValue([STATUS_APP]);
    const { onSelect } = renderNewTabPage({
      currentThreadId: "thr-manager",
      currentThreadType: "manager",
    });

    expect(await screen.findByText("Apps")).toBeTruthy();
    fireEvent.click(await screen.findByRole("option", { name: /Status/u }));

    expect(onSelect).toHaveBeenCalledWith({
      source: "app",
      appId: "status",
    });
  });

  it("selects a manager thread-storage result with the keyboard", async () => {
    vi.mocked(api.listThreadApps).mockResolvedValue([]);
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/workspace.ts",
          score: 90,
        },
      ]),
    );
    vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
      ...makePathResponse([
        {
          kind: "file",
          path: "notes/status.md",
          score: 80,
        },
      ]),
      storageRootPath: "/tmp/thread-storage",
    });
    const { onSelect } = renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: "thr-manager",
      currentThreadType: "manager",
    });

    const input = screen.getByRole("textbox", {
      name: "Search apps and files",
    });
    fireEvent.change(input, { target: { value: "status" } });
    await screen.findByText("Files");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      source: "thread-storage",
      path: "notes/status.md",
    });
  });

  it("renders an unavailable state without querying", () => {
    renderNewTabPage({ currentThreadId: "" });

    expect(
      screen.getByText("No searchable app or file source is available."),
    ).toBeTruthy();
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.listThreadApps).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();
  });
});
