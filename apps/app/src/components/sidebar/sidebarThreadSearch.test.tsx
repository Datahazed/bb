// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSidebarDraftSearchMatch,
  getSidebarThreadSearchMatchWindow,
  useSidebarThreadSearchLifecycleFilter,
  type SidebarThreadSearchLifecycleFilterController,
} from "./sidebarThreadSearch";

afterEach(cleanup);

describe("sidebar draft search matching", () => {
  it("matches local draft text and falls back to an attachment-only title", () => {
    expect(
      getSidebarDraftSearchMatch({
        query: "permission",
        text: "Review the Permission boundary",
        title: "Review the Permission boundary",
      }),
    ).toEqual({
      highlightRanges: [{ start: 11, end: 21 }],
      text: "Review the Permission boundary",
    });
    expect(
      getSidebarDraftSearchMatch({
        query: "thread",
        text: "",
        title: "New thread",
      }),
    ).toEqual({
      highlightRanges: [{ start: 4, end: 10 }],
      text: "New thread",
    });
  });

  it("matches every query token across draft text like server thread search", () => {
    expect(
      getSidebarDraftSearchMatch({
        query: "alpha beta",
        text: "Alpha begins here; beta finishes later.",
        title: "Alpha begins here; beta finishes later.",
      }),
    ).toEqual({
      highlightRanges: [
        { start: 0, end: 5 },
        { start: 19, end: 23 },
      ],
      text: "Alpha begins here; beta finishes later.",
    });
    expect(
      getSidebarDraftSearchMatch({
        query: "alpha missing",
        text: "Alpha begins here; beta finishes later.",
        title: "Alpha begins here; beta finishes later.",
      }),
    ).toBeNull();
  });

  it("folds accents and keeps highlight offsets in the original draft", () => {
    expect(
      getSidebarDraftSearchMatch({
        query: "cafe",
        text: "Café planning",
        title: "Café planning",
      }),
    ).toEqual({
      highlightRanges: [{ start: 0, end: 4 }],
      text: "Café planning",
    });
  });
});

describe("sidebar search match window", () => {
  it("keeps the plain text when the two-line clamp already reveals the match", () => {
    const text = "A short sentence with the needle visible.";
    expect(
      getSidebarThreadSearchMatchWindow({
        highlightRanges: [{ start: 26, end: 32 }],
        matchIsHidden: false,
        text,
      }),
    ).toEqual({
      highlightRanges: [{ start: 26, end: 32 }],
      text,
      wasWindowed: false,
    });
  });

  it("reveals a late 240px-row match with bounded context and rebased ranges", () => {
    const text =
      "This deliberately long preface fills more than two lines in a 240px sidebar result before the visible needle and then continues with enough following words to require a trailing cut.";
    const matchStart = text.indexOf("needle");
    const result = getSidebarThreadSearchMatchWindow({
      highlightRanges: [{ start: matchStart, end: matchStart + 6 }],
      matchIsHidden: true,
      text,
    });

    expect(result.wasWindowed).toBe(true);
    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
    expect(result.text.indexOf("needle")).toBeLessThanOrEqual(17);
    expect(
      result.text.length - result.text.indexOf("needle") - 6,
    ).toBeLessThanOrEqual(41);
    expect(
      result.text.slice(
        result.highlightRanges[0]?.start,
        result.highlightRanges[0]?.end,
      ),
    ).toBe("needle");
  });

  it("never clips or rebases through a surrogate pair", () => {
    const text = `${"word ".repeat(8)}😀😀😀😀 target ${"after ".repeat(12)}`;
    const matchStart = text.indexOf("target");
    const result = getSidebarThreadSearchMatchWindow({
      // Deliberately malformed input boundaries inside emoji pairs exercise
      // the defensive normalization used for server-provided UTF-16 offsets.
      highlightRanges: [
        { start: text.indexOf("😀") + 1, end: text.indexOf("😀") + 3 },
        { start: matchStart, end: matchStart + 6 },
      ],
      matchIsHidden: true,
      text,
    });

    expect(result.text).not.toContain("�");
    for (const range of result.highlightRanges) {
      const highlighted = result.text.slice(range.start, range.end);
      expect(highlighted).not.toBe("\ud83d");
      expect(highlighted).not.toBe("\ude00");
    }
  });
});

describe("sidebar search lifecycle filter", () => {
  it("keeps at least one state selected and resets to all-on", () => {
    let controller: SidebarThreadSearchLifecycleFilterController | null = null;

    function Harness() {
      const next = useSidebarThreadSearchLifecycleFilter();
      useEffect(() => {
        controller = next;
      });
      return null;
    }

    render(<Harness />);
    const current = () => {
      if (controller === null) throw new Error("controller not ready");
      return controller;
    };

    act(() => current().onStateCheckedChange("active", false));
    act(() => current().onStateCheckedChange("drafts", false));
    expect(current().selectedStates).toEqual(["archived"]);

    act(() => current().onStateCheckedChange("archived", false));
    expect(current().selectedStates).toEqual(["archived"]);

    act(() => current().reset());
    expect(current().selectedStates).toEqual(["active", "drafts", "archived"]);
    expect(current().isFiltered).toBe(false);
  });
});
