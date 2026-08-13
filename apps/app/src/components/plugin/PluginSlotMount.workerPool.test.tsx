// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginSlotMount } from "./PluginSlotMount";
import { setPluginDiffWorkerPoolRenderer } from "@/lib/plugin-diff-worker-pool";

// The thread workspace no longer wraps its subtree in a worker pool provider,
// so a plugin that renders a diff depends on this wiring for syntax
// highlighting. Losing it degrades quietly — the diff still renders — which is
// exactly the kind of regression a test has to catch.
afterEach(cleanup);

function renderSlot(slotKind: string) {
  return render(
    <PluginSlotMount pluginId="demo" slotKind={slotKind} slotId="slot">
      <div>slot body</div>
    </PluginSlotMount>,
  );
}

describe("PluginSlotMount diff worker pool", () => {
  it("wraps thread workspace slots once the plugin runtime registers a pool", () => {
    setPluginDiffWorkerPoolRenderer((children) => (
      <div data-testid="pool">{children}</div>
    ));

    renderSlot("messageDirective");

    expect(screen.getByTestId("pool")).not.toBeNull();
    expect(screen.getByText("slot body")).not.toBeNull();
  });

  it("leaves slots outside the thread workspace unwrapped", () => {
    setPluginDiffWorkerPoolRenderer((children) => (
      <div data-testid="pool">{children}</div>
    ));

    // The provider spawns workers eagerly, so a sidebar chip must not get one.
    renderSlot("navPanelSidebarAccessory");

    expect(screen.queryByTestId("pool")).toBeNull();
    expect(screen.getByText("slot body")).not.toBeNull();
  });
});
