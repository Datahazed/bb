// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  LazyProjectDeleteDialog,
  LazyProjectPathDialog,
  LazyProjectRenameDialog,
} from "./lazyProjectDialogs";

// Keep every body import pending so each assertion observes the eager shell
// during a real Suspense cold load rather than after the mocked chunk resolves.
vi.mock("./ProjectPathDialog", () => new Promise(() => {}));
vi.mock("./ProjectRenameDialog", () => new Promise(() => {}));
vi.mock("./ProjectDeleteDialog", () => new Promise(() => {}));

afterEach(() => cleanup());

const noop = () => {};

function getAccessibleDescription(element: HTMLElement): string | null {
  const describedBy = element.getAttribute("aria-describedby");
  if (describedBy) {
    return describedBy
      .split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return element.getAttribute("aria-description");
}

const dialogCases = [
  {
    name: "path",
    label: "Add project",
    description: "Choose the folder to add as a project.",
    render: () => (
      <LazyProjectPathDialog
        target={{ kind: "create" }}
        pending={false}
        platform={null}
        hostId={null}
        hostName={null}
        onOpenChange={noop}
        onSubmit={noop}
      />
    ),
  },
  {
    name: "rename",
    label: "Rename project",
    description: "Choose a new name for this project.",
    render: () => (
      <LazyProjectRenameDialog
        target={{ id: "proj-test", currentName: "Test project" }}
        pending={false}
        onOpenChange={noop}
        onRename={noop}
      />
    ),
  },
  {
    name: "delete",
    label: "Remove project?",
    description:
      'Remove "Test project" and all of its threads? This cannot be undone.',
    render: () => (
      <LazyProjectDeleteDialog
        target={{ id: "proj-test", name: "Test project" }}
        pending={false}
        onOpenChange={noop}
        onDelete={noop}
      />
    ),
  },
] as const;

describe("lazy project dialog accessibility", () => {
  for (const compact of [false, true]) {
    for (const dialogCase of dialogCases) {
      it(`names and describes the ${dialogCase.name} dialog while its ${
        compact ? "compact" : "desktop"
      } body chunk is pending`, () => {
        render(
          <CompactViewportOverrideProvider isCompactViewport={compact}>
            {dialogCase.render()}
          </CompactViewportOverrideProvider>,
        );

        const dialog = screen.getByRole("dialog", {
          name: dialogCase.label,
        });
        expect(getAccessibleDescription(dialog)).toBe(dialogCase.description);
      });
    }
  }
});
