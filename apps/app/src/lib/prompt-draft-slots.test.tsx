// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@bb/client-core";
import {
  getPromptDraftAccessor,
  usePromptDraftStorage,
} from "@/hooks/usePromptDraftStorage";
import {
  getNewThreadDraftSlotIdFromStorageKey,
  getNewThreadDraftSlotStorageKey,
  initializeNewThreadDraftSlots,
  parseNewThreadDraftSlot,
  persistNewThreadDraftSlot,
  promptDraftSlotStorageKeysForTests,
  readNewThreadDraftSlots,
  serializeNewThreadDraftSlot,
  type NewThreadDraftComposerSelection,
  type NewThreadDraftDestination,
} from "./prompt-draft-slots";

const WITHOUT_SECTION: NewThreadDraftDestination = {
  projectId: "project-personal",
  sectionId: null,
};
const WITH_SECTION: NewThreadDraftDestination = {
  projectId: "project-work",
  sectionId: "section-inbox",
};
const COMPOSER_SELECTION: NewThreadDraftComposerSelection = {
  providerId: "codex",
  model: "gpt-5.6-sol",
  reasoningLevel: "high",
  serviceTier: "fast",
  permissionMode: "full",
  environmentSelectionValue: "host:host-local:worktree",
};

function draft(text: string): PromptDraftState {
  return { text, mentions: [], attachments: [] };
}

function legacyDraft(text: string): string {
  return JSON.stringify({ text, attachments: [] });
}

function readSlot(slotId: string) {
  return parseNewThreadDraftSlot(
    slotId,
    window.localStorage.getItem(getNewThreadDraftSlotStorageKey(slotId)),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("new-thread draft slot records", () => {
  it("keeps two composer slots independent across remount", () => {
    vi.useFakeTimers();
    const leftScope = {
      kind: "new-thread" as const,
      slotId: "pane-left",
      destination: WITHOUT_SECTION,
    };
    const rightScope = {
      kind: "new-thread" as const,
      slotId: "pane-right",
      destination: WITH_SECTION,
    };
    const left = renderHook(() => usePromptDraftStorage(leftScope));
    const right = renderHook(() => usePromptDraftStorage(rightScope));

    vi.setSystemTime(100);
    act(() => left.result.current.setDraft(draft("Left pane text")));
    vi.setSystemTime(200);
    act(() => right.result.current.setDraft(draft("Right pane text")));

    expect(left.result.current.text).toBe("Left pane text");
    expect(right.result.current.text).toBe("Right pane text");
    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        id: "pane-right",
        draft: draft("Right pane text"),
        destination: WITH_SECTION,
      }),
      expect.objectContaining({
        id: "pane-left",
        draft: draft("Left pane text"),
        destination: WITHOUT_SECTION,
      }),
    ]);

    cleanup();
    const restoredLeft = renderHook(() => usePromptDraftStorage(leftScope));
    const restoredRight = renderHook(() => usePromptDraftStorage(rightScope));
    expect(restoredLeft.result.current.text).toBe("Left pane text");
    expect(restoredRight.result.current.text).toBe("Right pane text");

    act(() => restoredLeft.result.current.clear());
    expect(restoredLeft.result.current.text).toBe("");
    expect(restoredRight.result.current.text).toBe("Right pane text");
    expect(readNewThreadDraftSlots().map((slot) => slot.id)).toEqual([
      "pane-right",
    ]);
  });

  it("round-trips project destinations with and without a section", () => {
    const withSection = serializeNewThreadDraftSlot(
      draft("Section-scoped work"),
      100,
      WITH_SECTION,
    );
    const withoutSection = serializeNewThreadDraftSlot(
      draft("Project-scoped work"),
      200,
      WITHOUT_SECTION,
    );

    expect(parseNewThreadDraftSlot("with-section", withSection)).toEqual({
      id: "with-section",
      lastEditedAt: 100,
      draft: draft("Section-scoped work"),
      destination: WITH_SECTION,
      composerSelection: null,
    });
    expect(parseNewThreadDraftSlot("without-section", withoutSection)).toEqual({
      id: "without-section",
      lastEditedAt: 200,
      draft: draft("Project-scoped work"),
      destination: WITHOUT_SECTION,
      composerSelection: null,
    });
    expect(JSON.parse(withSection ?? "null")).toMatchObject({
      projectId: "project-work",
      sectionId: "section-inbox",
    });
    expect(JSON.parse(withoutSection ?? "null")).not.toHaveProperty(
      "sectionId",
    );
  });

  it("round-trips composer selection and preserves legacy drafts without it", () => {
    const serialized = serializeNewThreadDraftSlot(
      draft("Restore my exact model"),
      300,
      WITH_SECTION,
      COMPOSER_SELECTION,
    );

    expect(parseNewThreadDraftSlot("with-selection", serialized)).toEqual({
      id: "with-selection",
      lastEditedAt: 300,
      draft: draft("Restore my exact model"),
      destination: WITH_SECTION,
      composerSelection: COMPOSER_SELECTION,
    });

    const malformedSelection = JSON.stringify({
      text: "Keep valid content",
      attachments: [],
      lastEditedAt: 400,
      projectId: "project-personal",
      composerSelection: { model: 42 },
    });
    expect(
      parseNewThreadDraftSlot("malformed-selection", malformedSelection),
    ).toEqual({
      id: "malformed-selection",
      lastEditedAt: 400,
      draft: draft("Keep valid content"),
      destination: WITHOUT_SECTION,
      composerSelection: null,
    });
  });

  it("keeps selection memory-only until content exists, then clears it with the draft", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "selection-before-content",
        destination: WITHOUT_SECTION,
      }),
    );

    act(() => result.current.setComposerSelection(COMPOSER_SELECTION));
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();
    expect(result.current.composerSelection).toEqual(COMPOSER_SELECTION);

    act(() => result.current.setDraft(draft("Now I am a draft")));
    expect(readSlot("selection-before-content")).toEqual(
      expect.objectContaining({
        draft: draft("Now I am a draft"),
        composerSelection: COMPOSER_SELECTION,
      }),
    );

    act(() => result.current.clear());
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();
    expect(result.current.composerSelection).toBeNull();
  });

  it("atomically applies selection changes over pending text and attachment-only drafts", () => {
    vi.useFakeTimers();
    const pending = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "pending-selection-change",
        destination: WITHOUT_SECTION,
      }),
    );
    const changedSelection = {
      ...COMPOSER_SELECTION,
      model: "gpt-5.6-terra",
      reasoningLevel: "medium" as const,
    };

    act(() => {
      pending.result.current.setComposerSelection(COMPOSER_SELECTION);
      pending.result.current.setTextAndMentions("Still typing", []);
      pending.result.current.setComposerSelection(changedSelection);
    });
    expect(readSlot("pending-selection-change")).toEqual(
      expect.objectContaining({
        draft: draft("Still typing"),
        composerSelection: changedSelection,
      }),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(readSlot("pending-selection-change")?.composerSelection).toEqual(
      changedSelection,
    );

    const attachmentOnly = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "attachment-only-selection",
        destination: WITH_SECTION,
      }),
    );
    act(() => {
      attachmentOnly.result.current.setComposerSelection(COMPOSER_SELECTION);
      attachmentOnly.result.current.addAttachment({
        type: "localFile",
        path: "uploads/plan.md",
        name: "plan.md",
        sizeBytes: 8,
      });
    });
    expect(readSlot("attachment-only-selection")).toEqual(
      expect.objectContaining({
        draft: expect.objectContaining({
          text: "",
          attachments: [expect.objectContaining({ path: "uploads/plan.md" })],
        }),
        composerSelection: COMPOSER_SELECTION,
      }),
    );
  });

  it("keeps destination changes in the same record without changing recency", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const initialDestination: NewThreadDraftDestination = {
      projectId: "project-a",
      sectionId: null,
    };
    const updatedDestination: NewThreadDraftDestination = {
      projectId: "project-b",
      sectionId: "section-b",
    };
    const { result, rerender } = renderHook(
      ({ destination }) =>
        usePromptDraftStorage({
          kind: "new-thread",
          slotId: "destination-update",
          destination,
        }),
      { initialProps: { destination: initialDestination } },
    );

    act(() => result.current.setDraft(draft("Keep my destination")));
    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        id: "destination-update",
        lastEditedAt: 1_000,
        destination: initialDestination,
      }),
    ]);

    vi.setSystemTime(2_000);
    rerender({ destination: updatedDestination });
    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        id: "destination-update",
        lastEditedAt: 1_000,
        draft: draft("Keep my destination"),
        destination: updatedDestination,
      }),
    ]);
  });

  it("persists a destination change together with pending debounced content", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result, rerender } = renderHook(
      ({ destination }) =>
        usePromptDraftStorage({
          kind: "new-thread",
          slotId: "pending-destination-update",
          destination,
        }),
      { initialProps: { destination: WITHOUT_SECTION } },
    );

    act(() => result.current.setTextAndMentions("Still typing", []));
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();

    rerender({ destination: WITH_SECTION });
    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        id: "pending-destination-update",
        lastEditedAt: 1_000,
        draft: draft("Still typing"),
        destination: WITH_SECTION,
      }),
    ]);

    act(() => vi.advanceTimersByTime(250));
    expect(readNewThreadDraftSlots()).toHaveLength(1);
  });

  it("repairs order races and removes empty or corrupt slot records", () => {
    persistNewThreadDraftSlot("older", draft("Older"), 100, WITHOUT_SECTION);
    persistNewThreadDraftSlot("newer", draft("Newer"), 200, WITH_SECTION);
    const emptyKey = getNewThreadDraftSlotStorageKey("empty");
    const corruptKey = getNewThreadDraftSlotStorageKey("corrupt");
    window.localStorage.setItem(
      emptyKey,
      JSON.stringify({
        text: "",
        attachments: [],
        lastEditedAt: 300,
        projectId: "project-personal",
      }),
    );
    window.localStorage.setItem(
      corruptKey,
      JSON.stringify({
        text: "Missing required project",
        attachments: [],
        lastEditedAt: 400,
      }),
    );
    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.order,
      JSON.stringify({
        version: 1,
        ids: ["older", "older", "missing", "newer"],
      }),
    );

    expect(readNewThreadDraftSlots().map((slot) => slot.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(window.localStorage.getItem(emptyKey)).toBeNull();
    expect(window.localStorage.getItem(corruptKey)).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(promptDraftSlotStorageKeysForTests.order) ??
          "null",
      ),
    ).toEqual({ version: 1, ids: ["newer", "older"] });
  });

  it("encodes slot ids without admitting plugin or legacy draft keys", () => {
    const slotId = "pane / one";
    const storageKey = getNewThreadDraftSlotStorageKey(slotId);
    expect(getNewThreadDraftSlotIdFromStorageKey(storageKey)).toBe(slotId);

    getPromptDraftAccessor({
      kind: "plugin-new-thread",
      key: "destination-compatibility",
    }).setDraft(draft("Plugin draft"));
    getPromptDraftAccessor({ kind: "new-thread" }).setDraft(
      draft("Legacy shared draft"),
    );

    expect(readNewThreadDraftSlots()).toEqual([]);
    expect(
      window.localStorage.getItem(
        "bb.promptbox.contents-plugin-draft-destination-compatibility-3",
      ),
    ).toBe(legacyDraft("Plugin draft"));
    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBe(legacyDraft("Legacy shared draft"));
  });
});

describe("legacy new-thread draft migration", () => {
  it("adopts the current project, dedupes reruns, and absorbs later old-build writes", () => {
    const first = legacyDraft("Legacy first");
    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      first,
    );

    initializeNewThreadDraftSlots(
      { projectId: "project-current", sectionId: null },
      100,
    );
    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        lastEditedAt: 100,
        draft: draft("Legacy first"),
        destination: { projectId: "project-current", sectionId: null },
      }),
    ]);
    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBeNull();

    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      first,
    );
    initializeNewThreadDraftSlots(
      { projectId: "project-other", sectionId: null },
      200,
    );
    expect(readNewThreadDraftSlots()).toHaveLength(1);

    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      legacyDraft("Legacy second"),
    );
    initializeNewThreadDraftSlots(
      { projectId: "project-other", sectionId: null },
      300,
    );
    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        lastEditedAt: 300,
        draft: draft("Legacy second"),
        destination: { projectId: "project-other", sectionId: null },
      }),
      expect.objectContaining({
        lastEditedAt: 100,
        draft: draft("Legacy first"),
        destination: { projectId: "project-current", sectionId: null },
      }),
    ]);
  });

  it("does not clear a newer legacy value written concurrently", () => {
    const originalSetItem = Storage.prototype.setItem;
    const first = legacyDraft("Window one");
    const second = legacyDraft("Older build wrote later");
    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      first,
    );
    let injectedConcurrentWrite = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      originalSetItem.call(this, key, value);
      if (
        !injectedConcurrentWrite &&
        getNewThreadDraftSlotIdFromStorageKey(key) !== null
      ) {
        injectedConcurrentWrite = true;
        originalSetItem.call(
          this,
          promptDraftSlotStorageKeysForTests.legacy,
          second,
        );
      }
    });

    initializeNewThreadDraftSlots(
      { projectId: "project-current", sectionId: null },
      100,
    );
    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBe(second);
    expect(readNewThreadDraftSlots().map((slot) => slot.draft.text)).toEqual([
      "Window one",
    ]);

    initializeNewThreadDraftSlots(
      { projectId: "project-current", sectionId: null },
      200,
    );
    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBeNull();
    expect(readNewThreadDraftSlots().map((slot) => slot.draft.text)).toEqual([
      "Older build wrote later",
      "Window one",
    ]);
  });

  it("leaves the legacy value intact when the destination slot cannot be written", () => {
    const legacy = legacyDraft("Keep me through quota failure");
    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      legacy,
    );
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (getNewThreadDraftSlotIdFromStorageKey(key) !== null) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    initializeNewThreadDraftSlots(
      { projectId: "project-current", sectionId: null },
      100,
    );

    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBe(legacy);
    expect(readNewThreadDraftSlots()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
