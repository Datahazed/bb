// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyThreadSecondaryPanelWithStorage } from "./lazySecondaryPanelComponents";

const ownerState = vi.hoisted(() => ({
  moduleLoads: 0,
  mounts: 0,
  nextInstanceId: 0,
  unmounts: 0,
}));

vi.mock("./ThreadSecondaryPanelWithStorage", async () => {
  const React = await import("react");
  ownerState.moduleLoads += 1;

  function ThreadSecondaryPanelWithStorage({ isOpen }: { isOpen: boolean }) {
    const [instanceId] = React.useState(() => {
      ownerState.nextInstanceId += 1;
      return ownerState.nextInstanceId;
    });
    React.useEffect(() => {
      ownerState.mounts += 1;
      return () => {
        ownerState.unmounts += 1;
      };
    }, []);
    return React.createElement("div", {
      "data-instance-id": instanceId,
      "data-open": isOpen ? "true" : "false",
      "data-testid": "storage-panel-owner",
    });
  }

  return { ThreadSecondaryPanelWithStorage };
});

afterEach(() => cleanup());

const noop = () => {};

function StoragePanel({
  isOpen,
  threadId,
}: {
  isOpen: boolean;
  threadId: string;
}) {
  return (
    <LazyThreadSecondaryPanelWithStorage
      key={threadId}
      activeTab={null}
      canUseGitUi={false}
      drawerFallback={<div data-testid="panel-fallback" />}
      fixedTabs={[]}
      isConversationCollapsed={false}
      isOpen={isOpen}
      onCollapse={noop}
      onClose={noop}
      onOpenNewTab={noop}
      onPanelFocus={noop}
      onTabReorder={noop}
      onToggleConversationCollapse={noop}
      renderAsDrawer
      renderMetadataContent={() => null}
      storageBrowser={{
        files: undefined,
        filesError: null,
        isFilesLoading: false,
        onSelectPath: noop,
        selectedPath: null,
      }}
      tabs={[]}
    />
  );
}

describe("LazyThreadSecondaryPanelWithStorage", () => {
  it("loads on first open, retains the owner across closes, and cleans up with the thread", async () => {
    const { rerender } = render(
      <StoragePanel isOpen={false} threadId="thread-1" />,
    );

    expect(screen.getByTestId("panel-fallback")).not.toBeNull();
    expect(ownerState.moduleLoads).toBe(0);
    expect(ownerState.mounts).toBe(0);

    rerender(<StoragePanel isOpen threadId="thread-1" />);
    const owner = await screen.findByTestId("storage-panel-owner");
    const firstInstanceId = owner.dataset.instanceId;
    expect(owner.dataset.open).toBe("true");
    expect(ownerState.moduleLoads).toBe(1);
    expect(ownerState.mounts).toBe(1);

    rerender(<StoragePanel isOpen={false} threadId="thread-1" />);
    expect(screen.getByTestId("storage-panel-owner").dataset.instanceId).toBe(
      firstInstanceId,
    );
    expect(screen.getByTestId("storage-panel-owner").dataset.open).toBe(
      "false",
    );
    expect(ownerState.unmounts).toBe(0);

    rerender(<StoragePanel isOpen threadId="thread-1" />);
    expect(screen.getByTestId("storage-panel-owner").dataset.instanceId).toBe(
      firstInstanceId,
    );
    expect(ownerState.mounts).toBe(1);

    rerender(<StoragePanel isOpen={false} threadId="thread-2" />);
    expect(screen.queryByTestId("storage-panel-owner")).toBeNull();
    expect(ownerState.unmounts).toBe(1);
  });
});
