// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import { useRouteStateHistoryNavigation } from "./app-route-history";

const TOOL_ROUTE_SEQUENCE = [
  "/tools/skills",
  "/tools/skills/installed/bb-user/bb/review-loop",
  "/tools/skills/registry/moss-skills%2Fmoss-notes",
  "/tools/plugins",
  "/tools/plugins/github",
  "/tools/automations",
  "/tools/automations/proj_standard/auto_standard",
] as const;

function HistoryHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const { canGoBack, canGoForward, goBack, goForward } =
    useRouteStateHistoryNavigation();

  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="can-go-back">{String(canGoBack)}</div>
      <div data-testid="can-go-forward">{String(canGoForward)}</div>
      <button type="button" onClick={goBack}>
        Back
      </button>
      <button type="button" onClick={goForward}>
        Forward
      </button>
      {TOOL_ROUTE_SEQUENCE.map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {path}
        </button>
      ))}
    </div>
  );
}

function SidebarControlsHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <SidebarHistoryNavigationControls />
      {TOOL_ROUTE_SEQUENCE.map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {path}
        </button>
      ))}
    </div>
  );
}

async function clickAndExpectPath(label: string, path: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => {
    expect(screen.getByTestId("path").textContent).toBe(path);
  });
}

async function expectSidebarButtonState(
  label: "Go back" | "Go forward",
  disabled: boolean,
) {
  await waitFor(() => {
    expect(
      (screen.getByRole("button", { name: label }) as HTMLButtonElement)
        .disabled,
    ).toBe(disabled);
  });
}

describe("useRouteStateHistoryNavigation", () => {
  afterEach(cleanup);

  it("tracks every Tools route for sidebar back and forward controls", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <HistoryHarness />
      </MemoryRouter>,
    );

    for (const path of TOOL_ROUTE_SEQUENCE) {
      await clickAndExpectPath(path, path);
    }

    expect(screen.getByTestId("can-go-back").textContent).toBe("true");
    expect(screen.getByTestId("can-go-forward").textContent).toBe("false");

    await clickAndExpectPath("Back", "/tools/automations");
    await clickAndExpectPath("Back", "/tools/plugins/github");
    await clickAndExpectPath("Back", "/tools/plugins");
    await clickAndExpectPath(
      "Back",
      "/tools/skills/registry/moss-skills%2Fmoss-notes",
    );
    await clickAndExpectPath(
      "Back",
      "/tools/skills/installed/bb-user/bb/review-loop",
    );
    await clickAndExpectPath("Back", "/tools/skills");
    await clickAndExpectPath("Back", "/");

    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
    expect(screen.getByTestId("can-go-forward").textContent).toBe("true");

    await clickAndExpectPath("Forward", "/tools/skills");
    await clickAndExpectPath(
      "Forward",
      "/tools/skills/installed/bb-user/bb/review-loop",
    );
    await clickAndExpectPath(
      "Forward",
      "/tools/skills/registry/moss-skills%2Fmoss-notes",
    );
    await clickAndExpectPath("Forward", "/tools/plugins");
    await clickAndExpectPath("Forward", "/tools/plugins/github");
    await clickAndExpectPath("Forward", "/tools/automations");
    await clickAndExpectPath(
      "Forward",
      "/tools/automations/proj_standard/auto_standard",
    );
  });

  it("updates the actual sidebar arrow buttons after Tools route clicks", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarControlsHarness />
      </MemoryRouter>,
    );

    await expectSidebarButtonState("Go back", true);
    await expectSidebarButtonState("Go forward", true);

    await clickAndExpectPath("/tools/skills", "/tools/skills");

    await expectSidebarButtonState("Go back", false);
    await expectSidebarButtonState("Go forward", true);

    await clickAndExpectPath(
      "/tools/skills/installed/bb-user/bb/review-loop",
      "/tools/skills/installed/bb-user/bb/review-loop",
    );
    await clickAndExpectPath("Go back", "/tools/skills");

    await expectSidebarButtonState("Go forward", false);
  });
});
