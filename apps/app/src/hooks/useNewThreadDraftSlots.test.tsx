// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment, PromptDraftState } from "@bb/client-core";
import {
  getPromptDraftAccessor,
  usePromptDraftStorage,
} from "@/hooks/usePromptDraftStorage";
import {
  getNewThreadDraftSlotStorageKey,
  serializeNewThreadDraftSlot,
  type NewThreadDraftDestination,
} from "@/lib/prompt-draft-slots";
import {
  getNewThreadDraftTitle,
  useNewThreadDraftSlots,
} from "./useNewThreadDraftSlots";

const DESTINATION: NewThreadDraftDestination = {
  projectId: "project-work",
  sectionId: "section-inbox",
};
const ATTACHMENT: PromptDraftAttachment = {
  type: "localFile",
  path: "uploads/requirements.pdf",
  name: "requirements.pdf",
  mimeType: "application/pdf",
  sizeBytes: 42,
};

function draft(text: string): PromptDraftState {
  return { text, mentions: [], attachments: [] };
}

function dispatchStorageChange(
  key: string | null,
  oldValue: string | null = null,
  newValue: string | null = null,
): void {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      oldValue,
      newValue,
      storageArea: window.localStorage,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  dispatchStorageChange(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNewThreadDraftSlots", () => {
  it("derives a live title before the debounced content write and sorts newest first", () => {
    vi.useFakeTimers();
    const firstComposer = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "first",
        destination: DESTINATION,
      }),
    );
    const secondComposer = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "second",
        destination: DESTINATION,
      }),
    );
    const rows = renderHook(() => useNewThreadDraftSlots());

    vi.setSystemTime(100);
    act(() =>
      firstComposer.result.current.setTextAndMentions(
        "  Refactor\n the   split layout  ",
        [],
      ),
    );
    expect(
      window.localStorage.getItem(firstComposer.result.current.storageKey),
    ).toBeNull();
    expect(rows.result.current).toEqual([
      expect.objectContaining({
        id: "first",
        title: "Refactor the split layout",
        destination: DESTINATION,
        lastEditedAt: 100,
      }),
    ]);

    vi.setSystemTime(200);
    act(() =>
      secondComposer.result.current.setTextAndMentions("Write tests", []),
    );
    expect(rows.result.current.map((row) => row.id)).toEqual([
      "second",
      "first",
    ]);

    act(() => {
      for (const row of rows.result.current) row.delete();
    });
  });

  it("titles an attachment-only slot New thread", () => {
    const composer = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "attachment-only",
        destination: DESTINATION,
      }),
    );
    const rows = renderHook(() => useNewThreadDraftSlots());

    act(() => composer.result.current.addAttachment(ATTACHMENT));

    expect(rows.result.current).toEqual([
      expect.objectContaining({
        id: "attachment-only",
        title: "New thread",
        draft: { text: "", mentions: [], attachments: [ATTACHMENT] },
      }),
    ]);
    act(() => rows.result.current[0]?.delete());
  });

  it("deleting a row synchronously empties a live composer bound to its slot", () => {
    const composer = renderHook(() =>
      usePromptDraftStorage({
        kind: "new-thread",
        slotId: "open-composer",
        destination: DESTINATION,
      }),
    );
    const rows = renderHook(() => useNewThreadDraftSlots());
    act(() => composer.result.current.setDraft(draft("Keep this visible")));
    expect(rows.result.current).toHaveLength(1);

    act(() => rows.result.current[0]?.delete());

    expect(composer.result.current.text).toBe("");
    expect(composer.result.current.attachments).toEqual([]);
    expect(rows.result.current).toEqual([]);
    expect(
      window.localStorage.getItem(composer.result.current.storageKey),
    ).toBeNull();
  });

  it("reacts to another window adding and deleting a slot", () => {
    const rows = renderHook(() => useNewThreadDraftSlots());
    const storageKey = getNewThreadDraftSlotStorageKey("other-window");
    const serialized = serializeNewThreadDraftSlot(
      draft("Arrived from storage"),
      300,
      DESTINATION,
    );
    expect(serialized).not.toBeNull();

    act(() => {
      window.localStorage.setItem(storageKey, serialized!);
      dispatchStorageChange(storageKey, null, serialized);
    });
    expect(rows.result.current).toEqual([
      expect.objectContaining({
        id: "other-window",
        title: "Arrived from storage",
        lastEditedAt: 300,
      }),
    ]);

    act(() => {
      window.localStorage.removeItem(storageKey);
      dispatchStorageChange(storageKey, serialized, null);
    });
    expect(rows.result.current).toEqual([]);
  });

  it("excludes active-thread and plugin-rendered composer drafts", () => {
    const rows = renderHook(() => useNewThreadDraftSlots());

    act(() => {
      getPromptDraftAccessor({
        kind: "thread",
        projectId: "project-work",
        threadId: "thread-active",
      }).setDraft(draft("Unsent active-thread text"));
      getPromptDraftAccessor({
        kind: "plugin-new-thread",
        key: "plugin-composer",
      }).setDraft(draft("Plugin-owned draft"));
    });

    expect(rows.result.current).toEqual([]);
  });
});

describe("getNewThreadDraftTitle", () => {
  it("uses New thread only when the draft has no text", () => {
    expect(getNewThreadDraftTitle(draft("  first\n words  "))).toBe(
      "first words",
    );
    expect(
      getNewThreadDraftTitle({
        text: " \n ",
        mentions: [],
        attachments: [ATTACHMENT],
      }),
    ).toBe("New thread");
  });
});
