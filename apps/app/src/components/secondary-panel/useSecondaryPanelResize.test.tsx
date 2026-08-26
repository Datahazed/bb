// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSecondaryPanelResize } from "./useSecondaryPanelResize";

afterEach(cleanup);

describe("useSecondaryPanelResize", () => {
  it("imperatively expands and collapses one mounted panel across visibility changes", () => {
    const expand = vi.fn();
    const collapse = vi.fn();
    const panel = {
      collapse,
      expand,
      getId: () => "secondary-panel",
      getSize: () => 0,
      isCollapsed: () => true,
      isExpanded: () => false,
      resize: () => {},
    } satisfies ImperativePanelHandle;
    const onPanelWidthChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) =>
        useSecondaryPanelResize({
          isSecondaryPanelOpen: open,
          onPanelWidthChange,
        }),
      { initialProps: { open: false } },
    );
    result.current.secondaryResizablePanelRef.current = panel;

    act(() => rerender({ open: true }));
    expect(expand).toHaveBeenCalledOnce();

    act(() => rerender({ open: false }));
    expect(collapse).toHaveBeenCalledOnce();
  });
});
