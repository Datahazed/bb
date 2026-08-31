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

const EMPTY_NEW_THREAD_DRAFT_SLOTS: readonly NewThreadDraftSlot[] = [];

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

export function useNewThreadDraftSlots(): readonly NewThreadDraftRow[] {
  const slots = useSyncExternalStore(
    subscribeNewThreadDraftSlots,
    getNewThreadDraftSlotsSnapshot,
    () => EMPTY_NEW_THREAD_DRAFT_SLOTS,
  );

  return useMemo(
    () =>
      slots
        .filter((slot) => !isPromptDraftEmpty(slot.draft))
        .map(toNewThreadDraftRow),
    [slots],
  );
}
