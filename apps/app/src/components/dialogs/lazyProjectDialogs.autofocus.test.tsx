// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LazyProjectRenameDialog } from "./lazyProjectDialogs";

afterEach(() => cleanup());

const noop = () => {};

describe("LazyProjectRenameDialog", () => {
  it("focuses and selects the rename input when the lazy body arrives", async () => {
    const { rerender } = render(
      <LazyProjectRenameDialog
        target={null}
        pending={false}
        onOpenChange={noop}
        onRename={noop}
      />,
    );

    rerender(
      <LazyProjectRenameDialog
        target={{ id: "proj-test", currentName: "Test project" }}
        pending={false}
        onOpenChange={noop}
        onRename={noop}
      />,
    );

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Project name",
    );
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Test project".length);
  });
});
