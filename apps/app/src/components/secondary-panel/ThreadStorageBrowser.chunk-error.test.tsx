// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceFile } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadStorageBrowser } from "./ThreadStorageBrowser";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";

vi.mock("./ThreadStorageFileTree", () => {
  throw new Error("tree chunk fetch failed");
});

const FILES: readonly WorkspaceFile[] = [
  { name: "notes.md", path: "docs/notes.md" },
];

function BrowserWithFailedTreeChunk() {
  const controller = useThreadStorageBrowser({
    files: FILES,
    onSelectPath: vi.fn(),
    selectedPath: null,
  });
  return (
    <ThreadStorageBrowser
      controller={controller}
      isFilesLoading={false}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadStorageBrowser chunk failure", () => {
  it("replaces the loading state with a page-reload recovery action", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<BrowserWithFailedTreeChunk />);

    await waitFor(() => {
      expect(screen.getByText("Files could not be displayed.")).toBeTruthy();
    });
    expect(screen.queryByText("Loading files...")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload bb" })).toBeTruthy();
  });
});
