// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  LazyProjectDeleteDialog,
  LazyProjectPathDialog,
  LazyProjectRenameDialog,
} from "./lazyProjectDialogs";

const moduleLoads = vi.hoisted(() => ({
  deleteDialog: 0,
  pathDialog: 0,
  renameDialog: 0,
}));

vi.mock("./ProjectPathDialog", async () => {
  const React = await import("react");
  moduleLoads.pathDialog += 1;
  return {
    ProjectPathDialogContent: ({ target }: { target: { kind: string } }) =>
      React.createElement("div", {
        "data-kind": target.kind,
        "data-testid": "project-path-dialog",
      }),
  };
});

vi.mock("./ProjectRenameDialog", async () => {
  const React = await import("react");
  moduleLoads.renameDialog += 1;
  return {
    ProjectRenameDialogContent: ({
      focusOnMount,
      target,
    }: {
      focusOnMount?: boolean;
      target: { id: string; currentName: string };
    }) =>
      React.createElement("div", {
        "data-focus-on-mount": focusOnMount ? "true" : "false",
        "data-project-id": target.id,
        "data-testid": "project-rename-dialog",
      }),
  };
});

vi.mock("./ProjectDeleteDialog", async () => {
  const React = await import("react");
  moduleLoads.deleteDialog += 1;
  return {
    ProjectDeleteDialogContent: ({
      target,
    }: {
      target: { id: string; name: string };
    }) =>
      React.createElement("div", {
        "data-project-id": target.id,
        "data-testid": "project-delete-dialog",
      }),
  };
});

afterEach(() => cleanup());

const noop = () => {};

describe("lazy project dialogs", () => {
  it("loads each body on first open and reuses the chunk after close", async () => {
    const renderDialogs = ({
      deleteOpen,
      pathOpen,
      renameOpen,
    }: {
      deleteOpen: boolean;
      pathOpen: boolean;
      renameOpen: boolean;
    }) => (
      <>
        <LazyProjectPathDialog
          target={pathOpen ? { kind: "create" } : null}
          pending={false}
          platform={null}
          hostId={null}
          hostName={null}
          onOpenChange={noop}
          onSubmit={noop}
        />
        <LazyProjectRenameDialog
          target={
            renameOpen ? { id: "proj-test", currentName: "Test project" } : null
          }
          pending={false}
          onOpenChange={noop}
          onRename={noop}
        />
        <LazyProjectDeleteDialog
          target={deleteOpen ? { id: "proj-test", name: "Test project" } : null}
          pending={false}
          onOpenChange={noop}
          onDelete={noop}
        />
      </>
    );

    const closed = { deleteOpen: false, pathOpen: false, renameOpen: false };
    const { rerender } = render(renderDialogs(closed));

    expect(moduleLoads).toEqual({
      deleteDialog: 0,
      pathDialog: 0,
      renameDialog: 0,
    });

    rerender(
      renderDialogs({ deleteOpen: true, pathOpen: true, renameOpen: true }),
    );
    expect(await screen.findByTestId("project-path-dialog")).not.toBeNull();
    expect(
      (await screen.findByTestId("project-rename-dialog")).dataset.focusOnMount,
    ).toBe("true");
    expect(await screen.findByTestId("project-delete-dialog")).not.toBeNull();
    expect(moduleLoads).toEqual({
      deleteDialog: 1,
      pathDialog: 1,
      renameDialog: 1,
    });

    rerender(renderDialogs(closed));
    expect(screen.queryByTestId("project-path-dialog")).toBeNull();
    expect(screen.queryByTestId("project-rename-dialog")).toBeNull();
    expect(screen.queryByTestId("project-delete-dialog")).toBeNull();

    rerender(
      renderDialogs({ deleteOpen: true, pathOpen: true, renameOpen: true }),
    );
    expect(await screen.findByTestId("project-path-dialog")).not.toBeNull();
    expect(await screen.findByTestId("project-rename-dialog")).not.toBeNull();
    expect(await screen.findByTestId("project-delete-dialog")).not.toBeNull();
    expect(moduleLoads).toEqual({
      deleteDialog: 1,
      pathDialog: 1,
      renameDialog: 1,
    });
  });

  it("opens through the persistent compact drawer without inerting the app", async () => {
    const appTree = document.createElement("main");
    document.body.appendChild(appTree);
    const renderPathDialog = (open: boolean) => (
      <CompactViewportOverrideProvider isCompactViewport>
        <LazyProjectPathDialog
          target={open ? { kind: "create" } : null}
          pending={false}
          platform={null}
          hostId={null}
          hostName={null}
          onOpenChange={noop}
          onSubmit={noop}
        />
      </CompactViewportOverrideProvider>
    );

    try {
      const { rerender } = render(renderPathDialog(true));
      const drawer = document.querySelector<HTMLElement>(
        "[data-persistent-drawer-content]",
      );
      expect(drawer?.dataset.state).toBe("open");
      expect(appTree.hasAttribute("inert")).toBe(false);
      expect(appTree.getAttribute("aria-hidden")).toBeNull();

      await waitFor(() =>
        expect(
          document.querySelector("[data-responsive-drawer-placeholder]"),
        ).toBeNull(),
      );

      rerender(renderPathDialog(false));
      expect(drawer?.dataset.state).toBe("closed");
    } finally {
      appTree.remove();
    }
  });
});
