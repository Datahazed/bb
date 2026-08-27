// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarDisplayOptionsMenu } from "./ProjectList";

afterEach(cleanup);

function renderMenu() {
  render(
    <Provider>
      <TooltipProvider>
        <SidebarDisplayOptionsMenu />
      </TooltipProvider>
    </Provider>,
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Sidebar display options" }),
    { button: 0 },
  );
}

describe("SidebarDisplayOptionsMenu section ownership", () => {
  it("contains thread display controls but no whole-region controls", async () => {
    renderMenu();

    expect(
      await screen.findByRole("group", { name: "Organize" }),
    ).toBeDefined();
    expect(screen.getByRole("group", { name: "Sort by" })).toBeDefined();
    expect(
      screen.queryByRole("group", { name: "Sidebar sections" }),
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Show section" }),
    ).toBeNull();
  });
});
