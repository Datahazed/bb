// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";

// Lives in the app because @bb/shared-ui has no test harness of its own.
afterEach(cleanup);

describe("DropdownMenuItem", () => {
  // Radix emits its own `aria-disabled={disabled || undefined}` and then
  // spreads caller props over it, so forwarding a bare `undefined` deletes the
  // attribute for every ordinarily-disabled item in every menu. Nothing renders
  // differently when that regresses — `data-disabled` and the roving-focus skip
  // are unaffected, and only a screen reader can tell — so this assertion is
  // the only thing standing between the fallback and a well-meaning cleanup.
  it("keeps aria-disabled on an ordinarily disabled item", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled>Blocked</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const item = await screen.findByRole("menuitem", { name: "Blocked" });
    expect(item.getAttribute("aria-disabled")).toEqual("true");
  });

  // The other half: an item that refuses its action while staying focusable, so
  // it can explain why the way a natively disabled item cannot, supplies its own
  // aria-disabled and description. Both have to survive the forwarding.
  it("forwards an explicit aria-disabled and its description", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem aria-disabled title="Ships with bb">
            Uninstall
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const item = await screen.findByRole("menuitem", { name: "Uninstall" });
    expect(item.getAttribute("aria-disabled")).toEqual("true");
    expect(item.getAttribute("title")).toEqual("Ships with bb");
    // Not natively disabled: that pairs with pointer-events-none, which would
    // swallow the hover that reveals the reason.
    expect(item.hasAttribute("data-disabled")).toBe(false);
  });
});
