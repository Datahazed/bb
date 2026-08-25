import { useMemo, useSyncExternalStore } from "react";
import { isPromptDraftEmpty, type PromptDraftState } from "@bb/client-core";
import {
  deleteNewThreadDraftSlot,
  getNewThreadDraftSlotsSnapshot,
  subscribeNewThreadDraftSlots,
} from "@/hooks/usePromptDraftStorage";
import type {
  NewThreadDraftDestination,
  NewThreadDraftSlot,
} from "@/lib/prompt-draft-slots";

const EMPTY_NEW_THREAD_DRAFT_ROWS: readonly NewThreadDraftRow[] = [];

export interface NewThreadDraftRow {
  id: string;
  draft: PromptDraftState;
  title: string;
  lastEditedAt: number;
  destination: NewThreadDraftDestination;
  delete: () => void;
}

export function getNewThreadDraftTitle(draft: PromptDraftState): string {
  const firstWords = draft.text.replace(/\s+/gu, " ").trim();
  return firstWords.length > 0 ? firstWords : "New thread";
}

function toNewThreadDraftRow(slot: NewThreadDraftSlot): NewThreadDraftRow {
  return {
    ...slot,
    title: getNewThreadDraftTitle(slot.draft),
    delete: () => deleteNewThreadDraftSlot(slot.id),
  };
}

/**
 * Reactive local phantom rows for bb's built-in thread list. This store only
 * observes generated New-thread slot keys, so active-thread composer drafts
 * and plugin-rendered New-thread composers cannot enter the Drafts lifecycle.
 */
export function useNewThreadDraftSlots(): readonly NewThreadDraftRow[] {
  const slots = useSyncExternalStore(
    subscribeNewThreadDraftSlots,
    getNewThreadDraftSlotsSnapshot,
    () => EMPTY_NEW_THREAD_DRAFT_ROWS,
  );

  return useMemo(
    () =>
      slots
        .filter((slot) => !isPromptDraftEmpty(slot.draft))
        .map(toNewThreadDraftRow),
    [slots],
  );
}
