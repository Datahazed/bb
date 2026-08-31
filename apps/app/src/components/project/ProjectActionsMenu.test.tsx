// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "./ProjectActionsMenu";

const mockPathPickerHost = vi.hoisted(() => ({
  value: { hostId: null as string | null, hostName: null as string | null },
}));

const mockProjectActions = vi.hoisted(() => ({
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
  requestAddLocalPath: vi.fn(),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => mockPathPickerHost.value,
}));

vi.mock("./ProjectActionsProvider", () => ({
  useProjectActions: () => mockProjectActions,
}));

function makeProject(): ProjectResponse {
  return {
    id: "proj_test",
    kind: "standard",
    name: "Test project",
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("ProjectActionsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPathPickerHost.value = { hostId: null, hostName: null };
  });

  it("closes after selecting an action", async () => {
    const project = makeProject();

    render(
      <MemoryRouter>
        <ProjectActionsMenu project={project} />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });

  it("keeps the row's New thread quick action reachable from the overflow", async () => {
    const onCreateThread = vi.fn();

    render(
      <MemoryRouter>
        <ProjectActionsMenu
          project={makeProject()}
          onCreateThread={onCreateThread}
        />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New thread" }),
    );

    expect(onCreateThread).toHaveBeenCalledTimes(1);
  });

  it("keeps New thread reachable from the desktop context menu", async () => {
    const onCreateThread = vi.fn();

    render(
      <MemoryRouter>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <ProjectActionsContextMenu
            project={makeProject()}
            onCreateThread={onCreateThread}
          >
            <div data-testid="project-row">Test project</div>
          </ProjectActionsContextMenu>
        </CompactViewportOverrideProvider>
      </MemoryRouter>,
    );

    fireEvent.contextMenu(screen.getByTestId("project-row"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New thread" }),
    );

    expect(onCreateThread).toHaveBeenCalledTimes(1);
  });

  it("keeps New thread reachable from the compact long-press menu", async () => {
    const onCreateThread = vi.fn();

    render(
      <MemoryRouter>
        <CompactViewportOverrideProvider isCompactViewport>
          <ProjectActionsContextMenu
            project={makeProject()}
            onCreateThread={onCreateThread}
          >
            <div data-testid="project-row">Test project</div>
          </ProjectActionsContextMenu>
        </CompactViewportOverrideProvider>
      </MemoryRouter>,
    );

    fireEvent.contextMenu(screen.getByTestId("project-row"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New thread" }),
    );

    expect(onCreateThread).toHaveBeenCalledTimes(1);
  });
});
