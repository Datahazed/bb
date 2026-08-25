// @vitest-environment jsdom

import { useEffect, type ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneContent } from "@/lib/split-layout";
import { readRootComposeDraftSlotId } from "@/lib/root-compose-location-state";
import SplitWorkspaceRoute from "./SplitWorkspaceRoute";

const workspaceLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
const draftSlotSequence = vi.hoisted(() => ({ next: 1 }));

vi.mock("@/lib/prompt-draft-slots", () => ({
  createNewThreadDraftSlotId: () =>
    `generated-slot-${draftSlotSequence.next++}`,
}));

vi.mock("./thread-detail/SplitThreadArea", () => ({
  SplitThreadArea: ({ routeContent }: { routeContent: PaneContent }) => {
    useEffect(() => {
      workspaceLifecycle.mounts += 1;
      return () => {
        workspaceLifecycle.unmounts += 1;
      };
    }, []);
    return (
      <output data-testid="route-content">
        {routeContent.kind === "new-thread"
          ? `${routeContent.kind}:${routeContent.draftSlotId}`
          : routeContent.kind}
      </output>
    );
  },
}));

vi.mock("./RootComposeView", () => ({
  LegacyProjectComposeRedirect: () => <div>legacy redirect</div>,
}));

function NavigationControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/")}>compose</button>
      <button onClick={() => navigate("/plugins/docs/docs/work/today.md")}>
        plugin
      </button>
      <button onClick={() => navigate("/threads/thread-1")}>thread</button>
    </>
  );
}

function LocationStateProbe() {
  const location = useLocation();
  const state =
    typeof location.state === "object" && location.state !== null
      ? location.state
      : {};
  return (
    <output
      data-testid="location-state"
      data-focus-prompt={
        "focusPrompt" in state && state.focusPrompt === true ? "true" : "false"
      }
    >
      {readRootComposeDraftSlotId(location.state) ?? "none"}
    </output>
  );
}

function WorkspaceRouteHarness({
  initialEntries,
}: {
  initialEntries: ComponentProps<typeof MemoryRouter>["initialEntries"];
}) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <NavigationControls />
      <LocationStateProbe />
      <Routes>
        <Route path="*" element={<SplitWorkspaceRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SplitWorkspaceRoute", () => {
  beforeEach(() => {
    workspaceLifecycle.mounts = 0;
    workspaceLifecycle.unmounts = 0;
    draftSlotSequence.next = 1;
  });

  afterEach(cleanup);

  it("preserves the workspace mount across focus-driven page URL changes", async () => {
    render(<WorkspaceRouteHarness initialEntries={["/"]} />);

    expect(screen.getByTestId("route-content").textContent).toBe(
      "new-thread:generated-slot-1",
    );
    await waitFor(() =>
      expect(screen.getByTestId("location-state").textContent).toBe(
        "generated-slot-1",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "plugin" }));
    expect(screen.getByTestId("route-content").textContent).toBe(
      "plugin-panel",
    );

    fireEvent.click(screen.getByRole("button", { name: "thread" }));
    expect(screen.getByTestId("route-content").textContent).toBe("thread");
    expect(workspaceLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("allocates once per public root arrival and not on a plain rerender", async () => {
    const view = render(
      <WorkspaceRouteHarness initialEntries={["/plugins/docs/docs"]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "compose" }));
    await waitFor(() =>
      expect(screen.getByTestId("route-content").textContent).toBe(
        "new-thread:generated-slot-1",
      ),
    );
    view.rerender(
      <WorkspaceRouteHarness initialEntries={["/plugins/docs/docs"]} />,
    );
    expect(screen.getByTestId("route-content").textContent).toBe(
      "new-thread:generated-slot-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "plugin" }));
    fireEvent.click(screen.getByRole("button", { name: "compose" }));
    await waitFor(() =>
      expect(screen.getByTestId("route-content").textContent).toBe(
        "new-thread:generated-slot-2",
      ),
    );
    expect(draftSlotSequence.next).toBe(3);
  });

  it("uses an explicit reentry slot without allocating and preserves seed state", () => {
    render(
      <WorkspaceRouteHarness
        initialEntries={[
          {
            pathname: "/",
            state: { draftSlotId: "existing-slot", focusPrompt: true },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("route-content").textContent).toBe(
      "new-thread:existing-slot",
    );
    expect(screen.getByTestId("location-state").textContent).toBe(
      "existing-slot",
    );
    expect(screen.getByTestId("location-state").dataset.focusPrompt).toBe(
      "true",
    );
    expect(draftSlotSequence.next).toBe(1);
  });
});
