import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { PromptDraftAttachment, PromptDraftState } from "@bb/client-core";
import {
  appendQuoteAndAttachmentsToDraft,
  arePromptDraftStatesEqual,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  serializePromptDraftStorage,
} from "@bb/client-core";
import {
  getNewThreadDraftSlotIdFromStorageKey,
  getNewThreadDraftSlotStorageKey,
  parseNewThreadDraftSlot,
  persistNewThreadDraftSlot,
  type NewThreadDraftComposerSelection,
  type NewThreadDraftDestination,
} from "@/lib/prompt-draft-slots";

const PROMPT_DRAFT_STORAGE_PREFIX = "bb.promptbox.contents";
const PROMPT_DRAFT_STORAGE_VERSION = "3";
const PROMPT_DRAFT_PERSIST_DEBOUNCE_MS = 250;

export type PromptDraftScope =
  | { kind: "automation-edit"; automationId: string }
  | { kind: "new-thread"; slotId?: undefined }
  | {
      kind: "new-thread";
      slotId: string;
      destination: NewThreadDraftDestination;
    }
  | { kind: "plugin-new-thread"; key: string }
  | { kind: "thread"; projectId: string; threadId: string };

interface PromptDraftCacheEntry {
  rawValue: string | null;
  draft: PromptDraftState;
  lastEditedAt: number | null;
  destination: NewThreadDraftDestination | null;
  composerSelection: NewThreadDraftComposerSelection | null;
}

type PromptDraftListener = () => void;

interface PromptDraftWriteOptions {
  persist: "immediate" | "deferred";
  clearComposerSelection?: boolean;
}

const EMPTY_PROMPT_DRAFT = emptyPromptDraftState();
const promptDraftCache = new Map<string, PromptDraftCacheEntry>();
const promptDraftSubscribers = new Map<string, Set<PromptDraftListener>>();
const pendingPromptDraftStorageKeys = new Set<string>();
const promptDraftPersistTimers = new Map<string, number>();
let promptDraftStorageObserverInitialized = false;

function normalizeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function readPromptDraft(storageKey: string | null): PromptDraftState {
  if (!storageKey || typeof window === "undefined") {
    return EMPTY_PROMPT_DRAFT;
  }

  if (pendingPromptDraftStorageKeys.has(storageKey)) {
    return promptDraftCache.get(storageKey)?.draft ?? EMPTY_PROMPT_DRAFT;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  const cachedEntry = promptDraftCache.get(storageKey);
  if (cachedEntry && cachedEntry.rawValue === rawValue) {
    return cachedEntry.draft;
  }

  const slotId = getNewThreadDraftSlotIdFromStorageKey(storageKey);
  const slot =
    slotId === null ? null : parseNewThreadDraftSlot(slotId, rawValue);
  const draft = slot?.draft ?? parsePromptDraftStorage(rawValue);
  promptDraftCache.set(storageKey, {
    rawValue,
    draft,
    lastEditedAt: slot?.lastEditedAt ?? null,
    destination: slot?.destination ?? null,
    composerSelection: slot?.composerSelection ?? null,
  });
  return draft;
}

function readPromptDraftComposerSelection(
  storageKey: string,
): NewThreadDraftComposerSelection | null {
  readPromptDraft(storageKey);
  return promptDraftCache.get(storageKey)?.composerSelection ?? null;
}

function areDraftDestinationsEqual(
  left: NewThreadDraftDestination | null,
  right: NewThreadDraftDestination,
): boolean {
  return (
    left?.projectId === right.projectId && left.sectionId === right.sectionId
  );
}

function seedPromptDraftDestination(
  storageKey: string,
  destination: NewThreadDraftDestination,
): void {
  readPromptDraft(storageKey);
  const cachedEntry = promptDraftCache.get(storageKey);
  if (
    cachedEntry !== undefined &&
    cachedEntry.rawValue === null &&
    cachedEntry.destination === null
  ) {
    cachedEntry.destination = destination;
  }
}

function updatePromptDraftDestination(
  storageKey: string,
  destination: NewThreadDraftDestination,
): void {
  const draft = readPromptDraft(storageKey);
  const cachedEntry = promptDraftCache.get(storageKey);
  if (
    cachedEntry === undefined ||
    areDraftDestinationsEqual(cachedEntry.destination, destination)
  ) {
    return;
  }
  cachedEntry.destination = destination;
  if (!isPromptDraftEmpty(draft)) {
    persistPromptDraftCache(storageKey);
  }
}

function emitPromptDraftChange(storageKey: string): void {
  const listeners = promptDraftSubscribers.get(storageKey);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    listener();
  }
}

function clearPromptDraftPersistTimer(storageKey: string): void {
  const timerId = promptDraftPersistTimers.get(storageKey);
  if (timerId === undefined || typeof window === "undefined") return;

  window.clearTimeout(timerId);
  promptDraftPersistTimers.delete(storageKey);
}

function persistPromptDraftCache(storageKey: string): void {
  if (typeof window === "undefined") return;

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.delete(storageKey);

  const cachedEntry = promptDraftCache.get(storageKey);
  if (!cachedEntry) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  try {
    const slotId = getNewThreadDraftSlotIdFromStorageKey(storageKey);
    let serialized: string | null;
    if (slotId === null) {
      serialized = serializePromptDraftStorage(cachedEntry.draft);
    } else {
      const destination = cachedEntry.destination;
      if (destination === null) {
        throw new Error(`Draft slot ${slotId} has no submit destination.`);
      }
      serialized = persistNewThreadDraftSlot(
        slotId,
        cachedEntry.draft,
        cachedEntry.lastEditedAt ?? Date.now(),
        destination,
        cachedEntry.composerSelection,
      );
    }
    cachedEntry.rawValue = serialized;
    if (slotId === null) {
      if (serialized === null) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, serialized);
      }
    }
  } catch (error) {
    cachedEntry.rawValue = readStoredPromptDraftValue(storageKey);
    console.warn(
      `[prompt-draft] could not persist draft for ${storageKey}; keeping it in memory only`,
      error,
    );
  }
}

function readStoredPromptDraftValue(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function schedulePromptDraftPersist(storageKey: string): void {
  if (typeof window === "undefined") return;

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.add(storageKey);
  const timerId = window.setTimeout(() => {
    persistPromptDraftCache(storageKey);
  }, PROMPT_DRAFT_PERSIST_DEBOUNCE_MS);
  promptDraftPersistTimers.set(storageKey, timerId);
}

function flushPendingPromptDraftPersists(): void {
  for (const storageKey of Array.from(pendingPromptDraftStorageKeys)) {
    persistPromptDraftCache(storageKey);
  }
}

function ensurePromptDraftStorageObserver(): void {
  if (promptDraftStorageObserverInitialized || typeof window === "undefined") {
    return;
  }

  promptDraftStorageObserverInitialized = true;
  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    if (pendingPromptDraftStorageKeys.has(event.key)) return;
    promptDraftCache.delete(event.key);
    emitPromptDraftChange(event.key);
  });
  window.addEventListener("pagehide", flushPendingPromptDraftPersists);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPromptDraftPersists();
    }
  });
}

function subscribePromptDraft(
  storageKey: string | null,
  listener: PromptDraftListener,
): () => void {
  if (!storageKey) {
    return () => {};
  }

  ensurePromptDraftStorageObserver();

  let listeners = promptDraftSubscribers.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    promptDraftSubscribers.set(storageKey, listeners);
  }

  listeners.add(listener);
  return () => {
    const existingListeners = promptDraftSubscribers.get(storageKey);
    if (!existingListeners) return;

    existingListeners.delete(listener);
    if (existingListeners.size === 0) {
      promptDraftSubscribers.delete(storageKey);
    }
  };
}

function writePromptDraft(
  storageKey: string | null,
  value: PromptDraftState,
  options: PromptDraftWriteOptions = { persist: "immediate" },
): void {
  if (!storageKey || typeof window === "undefined") return;

  const slotId = getNewThreadDraftSlotIdFromStorageKey(storageKey);
  if (slotId !== null) {
    readPromptDraft(storageKey);
  }
  const existingSlotEntry = promptDraftCache.get(storageKey);

  promptDraftCache.set(storageKey, {
    rawValue: null,
    draft: isPromptDraftEmpty(value) ? EMPTY_PROMPT_DRAFT : value,
    lastEditedAt:
      slotId === null || isPromptDraftEmpty(value) ? null : Date.now(),
    destination:
      slotId === null ? null : (existingSlotEntry?.destination ?? null),
    composerSelection:
      slotId === null || options.clearComposerSelection === true
        ? null
        : (existingSlotEntry?.composerSelection ?? null),
  });
  if (options.persist === "deferred") {
    schedulePromptDraftPersist(storageKey);
  } else {
    persistPromptDraftCache(storageKey);
  }
  emitPromptDraftChange(storageKey);
}

function areDraftComposerSelectionsEqual(
  left: NewThreadDraftComposerSelection | null,
  right: NewThreadDraftComposerSelection,
): boolean {
  return (
    left?.providerId === right.providerId &&
    left.model === right.model &&
    left.reasoningLevel === right.reasoningLevel &&
    left.serviceTier === right.serviceTier &&
    left.permissionMode === right.permissionMode &&
    left.environmentSelectionValue === right.environmentSelectionValue
  );
}

function writePromptDraftComposerSelection(
  storageKey: string,
  selection: NewThreadDraftComposerSelection,
): void {
  if (
    typeof window === "undefined" ||
    getNewThreadDraftSlotIdFromStorageKey(storageKey) === null
  ) {
    return;
  }

  const draft = readPromptDraft(storageKey);
  const cachedEntry = promptDraftCache.get(storageKey);
  if (
    cachedEntry === undefined ||
    areDraftComposerSelectionsEqual(cachedEntry.composerSelection, selection)
  ) {
    return;
  }

  cachedEntry.composerSelection = selection;
  if (!isPromptDraftEmpty(draft)) {
    persistPromptDraftCache(storageKey);
  }
  emitPromptDraftChange(storageKey);
}

function restorePromptDraftIfEmpty(
  storageKey: string | null,
  value: PromptDraftState,
): boolean {
  if (
    !storageKey ||
    typeof window === "undefined" ||
    isPromptDraftEmpty(value)
  ) {
    return false;
  }

  if (!isPromptDraftEmpty(readPromptDraft(storageKey))) {
    return false;
  }

  writePromptDraft(storageKey, value);
  return true;
}

function addQuoteToPromptDraft(
  storageKey: string,
  text: string,
  attachments: readonly PromptDraftAttachment[] = [],
): void {
  const currentDraft = readPromptDraft(storageKey);
  const nextDraft = appendQuoteAndAttachmentsToDraft(
    currentDraft,
    text,
    attachments,
  );
  if (nextDraft === currentDraft) {
    return;
  }

  writePromptDraft(storageKey, nextDraft);
}

function getPromptDraftStorageKey(scope: PromptDraftScope): string {
  if (scope.kind === "automation-edit") {
    const normalizedAutomationId = normalizeStorageSegment(scope.automationId);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-automation-edit-${normalizedAutomationId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  if (scope.kind === "new-thread") {
    return scope.slotId === undefined
      ? `${PROMPT_DRAFT_STORAGE_PREFIX}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`
      : getNewThreadDraftSlotStorageKey(scope.slotId);
  }
  if (scope.kind === "plugin-new-thread") {
    const normalizedKey = normalizeStorageSegment(scope.key);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-plugin-draft-${normalizedKey}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  const normalizedProjectId = normalizeStorageSegment(scope.projectId);
  const normalizedThreadId = normalizeStorageSegment(scope.threadId);
  return `${PROMPT_DRAFT_STORAGE_PREFIX}-${normalizedProjectId}-${normalizedThreadId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

function preparePromptDraftStorage(scope: PromptDraftScope): string {
  const storageKey = getPromptDraftStorageKey(scope);
  if (scope.kind === "new-thread" && scope.slotId !== undefined) {
    seedPromptDraftDestination(storageKey, scope.destination);
  }
  return storageKey;
}

export function getPromptDraftAccessor(scope: PromptDraftScope): {
  storageKey: string;
  getCurrent: () => PromptDraftState;
  subscribe: (listener: () => void) => () => void;
  setDraft: (draft: PromptDraftState) => void;
  addQuote: (
    text: string,
    attachments?: readonly PromptDraftAttachment[],
  ) => void;
} {
  const storageKey = preparePromptDraftStorage(scope);
  return {
    storageKey,
    getCurrent: () => readPromptDraft(storageKey),
    subscribe: (listener) => subscribePromptDraft(storageKey, listener),
    setDraft: (draft) => writePromptDraft(storageKey, draft),
    addQuote: (text, attachments) =>
      addQuoteToPromptDraft(storageKey, text, attachments),
  };
}

export function usePromptDraftStorage(scope: PromptDraftScope) {
  const storageKey = preparePromptDraftStorage(scope);
  const destinationProjectId =
    scope.kind === "new-thread" && scope.slotId !== undefined
      ? scope.destination.projectId
      : null;
  const destinationSectionId =
    scope.kind === "new-thread" && scope.slotId !== undefined
      ? scope.destination.sectionId
      : null;
  useEffect(() => {
    if (destinationProjectId === null) return;
    updatePromptDraftDestination(storageKey, {
      projectId: destinationProjectId,
      sectionId: destinationSectionId,
    });
  }, [destinationProjectId, destinationSectionId, storageKey]);
  const draft = useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(() => readPromptDraft(storageKey), [storageKey]),
    () => EMPTY_PROMPT_DRAFT,
  );
  const composerSelection = useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(
      () => readPromptDraftComposerSelection(storageKey),
      [storageKey],
    ),
    () => null,
  );

  const setDraftAndPersist = useCallback(
    (nextDraft: PromptDraftState) => {
      writePromptDraft(storageKey, nextDraft);
    },
    [storageKey],
  );

  const setComposerSelection = useCallback(
    (selection: NewThreadDraftComposerSelection) => {
      writePromptDraftComposerSelection(storageKey, selection);
    },
    [storageKey],
  );

  const getCurrent = useCallback((): PromptDraftState => {
    return readPromptDraft(storageKey);
  }, [storageKey]);

  const subscribe = useCallback(
    (listener: () => void) => subscribePromptDraft(storageKey, listener),
    [storageKey],
  );

  const setTextAndMentions = useCallback(
    (nextText: string, nextMentions: PromptTextMention[]) => {
      writePromptDraft(
        storageKey,
        {
          ...readPromptDraft(storageKey),
          text: nextText,
          mentions: nextMentions,
        },
        { persist: "deferred" },
      );
    },
    [storageKey],
  );

  const addAttachment = useCallback(
    (attachment: PromptDraftAttachment) => {
      const currentDraft = readPromptDraft(storageKey);
      const alreadyExists = currentDraft.attachments.some(
        (existingAttachment) => existingAttachment.path === attachment.path,
      );
      if (alreadyExists) return;

      writePromptDraft(storageKey, {
        ...currentDraft,
        attachments: [...currentDraft.attachments, attachment],
      });
    },
    [storageKey],
  );

  const removeAttachment = useCallback(
    (path: string) => {
      const currentDraft = readPromptDraft(storageKey);
      const nextAttachments = currentDraft.attachments.filter(
        (attachment) => attachment.path !== path,
      );
      if (nextAttachments.length === currentDraft.attachments.length) {
        return;
      }

      writePromptDraft(storageKey, {
        ...currentDraft,
        attachments: nextAttachments,
      });
    },
    [storageKey],
  );

  const addQuote = useCallback(
    (text: string, attachments?: readonly PromptDraftAttachment[]) =>
      addQuoteToPromptDraft(storageKey, text, attachments),
    [storageKey],
  );

  const clear = useCallback(() => {
    writePromptDraft(storageKey, EMPTY_PROMPT_DRAFT, {
      persist: "immediate",
      clearComposerSelection: true,
    });
  }, [storageKey]);

  const clearIfCurrentMatches = useCallback(
    (expectedDraft: PromptDraftState): boolean => {
      if (
        !arePromptDraftStatesEqual(readPromptDraft(storageKey), expectedDraft)
      ) {
        return false;
      }

      writePromptDraft(storageKey, EMPTY_PROMPT_DRAFT, {
        persist: "immediate",
        clearComposerSelection: true,
      });
      return true;
    },
    [storageKey],
  );

  const setAttachments = useCallback(
    (attachments: PromptDraftAttachment[]) => {
      writePromptDraft(storageKey, {
        ...readPromptDraft(storageKey),
        attachments,
      });
    },
    [storageKey],
  );

  const restoreIfEmpty = useCallback(
    (nextDraft: PromptDraftState) => {
      restorePromptDraftIfEmpty(storageKey, nextDraft);
    },
    [storageKey],
  );

  return useMemo(
    () => ({
      storageKey,
      getCurrent,
      subscribe,
      composerSelection,
      setComposerSelection,
      value: draft.text,
      text: draft.text,
      mentions: draft.mentions,
      attachments: draft.attachments,
      setDraft: setDraftAndPersist,
      setTextAndMentions,
      setAttachments,
      addAttachment,
      removeAttachment,
      addQuote,
      clear,
      clearIfCurrentMatches,
      restoreIfEmpty,
    }),
    [
      addAttachment,
      addQuote,
      clear,
      clearIfCurrentMatches,
      composerSelection,
      draft.attachments,
      draft.mentions,
      draft.text,
      getCurrent,
      removeAttachment,
      restoreIfEmpty,
      setAttachments,
      setComposerSelection,
      setDraftAndPersist,
      setTextAndMentions,
      storageKey,
      subscribe,
    ],
  );
}

export function usePromptDraftHasInput(scope: PromptDraftScope): boolean {
  const storageKey = preparePromptDraftStorage(scope);

  return useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(
      () => !isPromptDraftEmpty(readPromptDraft(storageKey)),
      [storageKey],
    ),
    () => false,
  );
}

interface PromptDraftThreadRef {
  id: string;
  projectId: string;
}

interface PromptDraftThreadSubscription {
  storageKey: string;
  threadId: string;
}

function getEmptyPresenceSnapshot(): string {
  return "";
}

function readPromptDraftPresenceBit(storageKey: string): "0" | "1" {
  return isPromptDraftEmpty(readPromptDraft(storageKey)) ? "0" : "1";
}

function createPromptDraftPresenceStore(
  subscriptions: readonly PromptDraftThreadSubscription[],
): {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string;
} {
  let bits: ("0" | "1")[] | null = null;
  let snapshot: string | null = null;
  const refresh = (): string => {
    bits = subscriptions.map(({ storageKey }) =>
      readPromptDraftPresenceBit(storageKey),
    );
    snapshot = bits.join("");
    return snapshot;
  };
  return {
    getSnapshot: () => snapshot ?? refresh(),
    subscribe: (listener) => {
      snapshot = null;
      bits = null;
      const unsubscribe = subscriptions.map(({ storageKey }, index) =>
        subscribePromptDraft(storageKey, () => {
          const bit = readPromptDraftPresenceBit(storageKey);
          if (bits !== null && bits[index] === bit) return;
          if (bits === null) {
            refresh();
          } else {
            bits[index] = bit;
            snapshot = bits.join("");
          }
          listener();
        }),
      );
      return () => {
        for (const stopListening of unsubscribe) {
          stopListening();
        }
      };
    },
  };
}

export function usePromptDraftInputThreadIds(
  threads: readonly PromptDraftThreadRef[],
): ReadonlySet<string> {
  const subscriptions = useMemo<PromptDraftThreadSubscription[]>(() => {
    const seenStorageKeys = new Set<string>();
    const next: PromptDraftThreadSubscription[] = [];
    for (const thread of threads) {
      const storageKey = getPromptDraftStorageKey({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      });
      if (!storageKey || seenStorageKeys.has(storageKey)) continue;

      seenStorageKeys.add(storageKey);
      next.push({ storageKey, threadId: thread.id });
    }
    return next;
  }, [threads]);

  const presenceStore = useMemo(
    () => createPromptDraftPresenceStore(subscriptions),
    [subscriptions],
  );
  const presenceSnapshot = useSyncExternalStore(
    presenceStore.subscribe,
    presenceStore.getSnapshot,
    getEmptyPresenceSnapshot,
  );

  return useMemo(() => {
    const threadIds = new Set<string>();
    subscriptions.forEach(({ threadId }, index) => {
      if (presenceSnapshot[index] === "1") {
        threadIds.add(threadId);
      }
    });
    return threadIds;
  }, [presenceSnapshot, subscriptions]);
}
