// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectPathDialogContent,
  type ProjectPathDialogProps,
} from "./ProjectPathDialog";

vi.mock("@/components/dialogs/RemotePathBrowser", () => ({
  RemotePathBrowser: ({
    hostId,
    allowCreateFolder,
    onDirectoryChange,
  }: {
    hostId: string;
    allowCreateFolder: boolean;
    onDirectoryChange: (directory: string) => void;
  }) => (
    <button
      type="button"
      data-allow-create-folder={String(allowCreateFolder)}
      onClick={() =>
        onDirectoryChange(
          hostId === "host_kunst"
            ? "/Users/amadad/projects/reachy_mini"
            : hostId === "host_long"
              ? `/home/deploy/repos/${"long-project-name-".repeat(20)}`
              : "/home/deploy/repos/givecare",
        )
      }
    >
      Choose folder on {hostId}
    </button>
  ),
}));

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const atum = host({ id: "host_atum", name: "atum" });
const kunst = host({ id: "host_kunst", name: "Kunst" });
const offline = host({
  id: "host_offline",
  name: "Offline Mac",
  status: "disconnected",
});
const offlineKunst = host({ ...kunst, status: "disconnected" });

function ProjectPathDialog({
  target,
  pending = false,
  platform,
  hostId,
  hostName,
  hosts,
  onOpenChange,
  onSubmit,
}: ProjectPathDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ProjectPathDialogContent
            key={target.kind === "create" ? "create" : target.projectId}
            target={target}
            pending={pending}
            platform={platform}
            hostId={hostId}
            hostName={hostName}
            hosts={hosts}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectPathDialog machine selection", () => {
  it("creates a project from a folder on the selected connected machine", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum, kunst, offline]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(trigger.textContent).toContain("atum");
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_atum" })
        .getAttribute("data-allow-create-folder"),
    ).toBe("true");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      screen
        .getByRole("menuitem", { name: /Offline Mac/u })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: /Kunst/u }));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_kunst" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/Users/amadad/projects/reachy_mini",
      "host_kunst",
    );
  });

  it("preserves the direct single-machine folder flow", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/home/deploy/repos/givecare",
      "host_atum",
    );
  });

  // With machines listed but none selectable there is no host to resolve a
  // path against, so the manual-path fallback must not invite a submit that
  // the picker hook would drop without feedback.
  it("blocks submission when every listed machine is offline", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={null}
        hostName={null}
        hosts={[offline, offlineKunst]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText("Project path")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Add project" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
