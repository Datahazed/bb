import {
  arePromptDraftStatesEqual,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  type PromptDraftState,
} from "@bb/client-core";
import { nanoid } from "nanoid";
import { z } from "zod";

const PROMPT_DRAFT_STORAGE_VERSION = "3";
const LEGACY_NEW_THREAD_DRAFT_STORAGE_KEY = `bb.promptbox.contents-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;
const NEW_THREAD_DRAFT_SLOT_STORAGE_PREFIX =
  "bb.promptbox.contents-draft-slot-";
const NEW_THREAD_DRAFT_SLOT_STORAGE_SUFFIX = `-${PROMPT_DRAFT_STORAGE_VERSION}`;
const NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY =
  "bb.promptbox.new-thread-draft-slot-order-1";

const newThreadDraftDestinationSchema = z
  .object({
    projectId: z.string().min(1),
    sectionId: z.string().min(1).nullable(),
  })
  .strict();
const storedSlotSchema = z.object({
  lastEditedAt: z.number().int().nonnegative(),
  projectId: z.string().min(1),
  sectionId: z.string().min(1).optional(),
});
const storedSlotOrderSchema = z
  .object({
    version: z.literal(1),
    ids: z.array(z.string()),
  })
  .strict();

export interface NewThreadDraftSlot {
  id: string;
  lastEditedAt: number;
  draft: PromptDraftState;
  destination: NewThreadDraftDestination;
}

export interface NewThreadDraftDestination {
  projectId: string;
  sectionId: string | null;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidSlotId(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

function normalizeSlotIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of ids) {
    if (!isValidSlotId(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function parseStoredSlotOrder(rawValue: string | null): string[] {
  if (rawValue === null) return [];
  try {
    const parsed: unknown = JSON.parse(rawValue);
    const result = storedSlotOrderSchema.safeParse(parsed);
    return result.success ? normalizeSlotIds(result.data.ids) : [];
  } catch {
    return [];
  }
}

function serializeStoredSlotOrder(ids: readonly string[]): string {
  return JSON.stringify({ version: 1, ids: normalizeSlotIds(ids) });
}

function readStoredSlotOrder(storage: Storage): string[] {
  return parseStoredSlotOrder(
    storage.getItem(NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY),
  );
}

function writeStoredSlotOrder(storage: Storage, ids: readonly string[]): void {
  const normalized = normalizeSlotIds(ids);
  if (normalized.length === 0) {
    storage.removeItem(NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY);
    return;
  }
  storage.setItem(
    NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY,
    serializeStoredSlotOrder(normalized),
  );
}

export function createNewThreadDraftSlotId(): string {
  return nanoid();
}

export function getNewThreadDraftSlotStorageKey(slotId: string): string {
  if (!isValidSlotId(slotId)) {
    throw new Error("A new-thread draft slot id must be non-empty.");
  }
  return `${NEW_THREAD_DRAFT_SLOT_STORAGE_PREFIX}${encodeURIComponent(slotId)}${NEW_THREAD_DRAFT_SLOT_STORAGE_SUFFIX}`;
}

export function getNewThreadDraftSlotIdFromStorageKey(
  storageKey: string,
): string | null {
  if (
    !storageKey.startsWith(NEW_THREAD_DRAFT_SLOT_STORAGE_PREFIX) ||
    !storageKey.endsWith(NEW_THREAD_DRAFT_SLOT_STORAGE_SUFFIX)
  ) {
    return null;
  }
  const encoded = storageKey.slice(
    NEW_THREAD_DRAFT_SLOT_STORAGE_PREFIX.length,
    -NEW_THREAD_DRAFT_SLOT_STORAGE_SUFFIX.length,
  );
  try {
    const slotId = decodeURIComponent(encoded);
    return isValidSlotId(slotId) ? slotId : null;
  } catch {
    return null;
  }
}

export function parseNewThreadDraftSlot(
  slotId: string,
  rawValue: string | null,
): NewThreadDraftSlot | null {
  const draft = parsePromptDraftStorage(rawValue);
  if (rawValue === null || isPromptDraftEmpty(draft)) return null;

  try {
    const parsed: unknown = JSON.parse(rawValue);
    const result = storedSlotSchema.safeParse(parsed);
    if (!result.success) return null;
    return {
      id: slotId,
      lastEditedAt: result.data.lastEditedAt,
      draft,
      destination: {
        projectId: result.data.projectId,
        sectionId: result.data.sectionId ?? null,
      },
    };
  } catch {
    return null;
  }
}

export function serializeNewThreadDraftSlot(
  draft: PromptDraftState,
  lastEditedAt: number,
  destination: NewThreadDraftDestination,
): string | null {
  if (isPromptDraftEmpty(draft)) return null;
  const parsedDestination = newThreadDraftDestinationSchema.parse(destination);
  return JSON.stringify({
    text: draft.text,
    ...(draft.mentions.length > 0 ? { mentions: draft.mentions } : {}),
    attachments: draft.attachments,
    lastEditedAt,
    projectId: parsedDestination.projectId,
    ...(parsedDestination.sectionId === null
      ? {}
      : { sectionId: parsedDestination.sectionId }),
  });
}

function listStoredSlotIds(storage: Storage): string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    const slotId = getNewThreadDraftSlotIdFromStorageKey(key);
    if (slotId !== null) ids.push(slotId);
  }
  return normalizeSlotIds(ids);
}

/**
 * Reads the local phantom drafts in their persisted recency order. Slot keys
 * are the source of truth: repairing the order on read makes a concurrent
 * window's last-writer-wins order update unable to hide another window's slot.
 */
export function readNewThreadDraftSlots(): readonly NewThreadDraftSlot[] {
  const storage = getLocalStorage();
  if (storage === null) return [];

  const slotsById = new Map<string, NewThreadDraftSlot>();
  for (const id of listStoredSlotIds(storage)) {
    const storageKey = getNewThreadDraftSlotStorageKey(id);
    const slot = parseNewThreadDraftSlot(id, storage.getItem(storageKey));
    if (slot === null) {
      storage.removeItem(storageKey);
      continue;
    }
    slotsById.set(id, slot);
  }

  const storedOrder = readStoredSlotOrder(storage);
  const storedOrderIndexes = new Map(
    storedOrder.map((id, index) => [id, index]),
  );
  const normalizedOrder = [...slotsById.values()]
    .sort(
      (left, right) =>
        right.lastEditedAt - left.lastEditedAt ||
        (storedOrderIndexes.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (storedOrderIndexes.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    )
    .map((slot) => slot.id);
  const serializedOrder = serializeStoredSlotOrder(normalizedOrder);
  const storedRaw = storage.getItem(NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY);
  if (normalizedOrder.length === 0) {
    if (storedRaw !== null) {
      storage.removeItem(NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY);
    }
  } else if (storedRaw !== serializedOrder) {
    storage.setItem(NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY, serializedOrder);
  }
  return normalizedOrder.flatMap((id) => {
    const slot = slotsById.get(id);
    return slot === undefined ? [] : [slot];
  });
}

export function persistNewThreadDraftSlot(
  slotId: string,
  draft: PromptDraftState,
  lastEditedAt: number,
  destination: NewThreadDraftDestination,
): string | null {
  const storage = getLocalStorage();
  const serialized = serializeNewThreadDraftSlot(
    draft,
    lastEditedAt,
    destination,
  );
  if (storage === null) return serialized;

  const storageKey = getNewThreadDraftSlotStorageKey(slotId);
  if (serialized === null) {
    storage.removeItem(storageKey);
    writeStoredSlotOrder(
      storage,
      readStoredSlotOrder(storage).filter((id) => id !== slotId),
    );
    return null;
  }

  // The content key lands before its order entry. Readers repair the order
  // from content keys, so a process interruption or cross-window race cannot
  // make a successfully persisted draft unreachable.
  storage.setItem(storageKey, serialized);
  // readNewThreadDraftSlots derives recency from lastEditedAt and repairs the
  // order record. A destination-only rewrite keeps its timestamp, so changing
  // submit metadata cannot move the row.
  readNewThreadDraftSlots();
  return serialized;
}

function hashLegacyDraft(rawValue: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < rawValue.length; index += 1) {
    hash ^= rawValue.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function findLegacyMigrationSlotId(
  storage: Storage,
  rawValue: string,
  draft: PromptDraftState,
): { id: string; alreadyMigrated: boolean } {
  const baseId = `legacy-${hashLegacyDraft(rawValue)}`;
  for (let suffix = 0; ; suffix += 1) {
    const id = suffix === 0 ? baseId : `${baseId}-${suffix}`;
    const existing = parseNewThreadDraftSlot(
      id,
      storage.getItem(getNewThreadDraftSlotStorageKey(id)),
    );
    if (existing === null) return { id, alreadyMigrated: false };
    if (arePromptDraftStatesEqual(existing.draft, draft)) {
      return { id, alreadyMigrated: true };
    }
  }
}

/**
 * Launch-time migration and cleanup for the former shared root-composer key.
 * The content-derived migration id makes concurrent launches converge on one
 * slot. The old key is removed only after the slot write succeeds, so quota
 * failures and interrupted launches leave the legacy draft recoverable.
 */
export function initializeNewThreadDraftSlots(
  currentProjectId: string,
  now = Date.now(),
): void {
  const storage = getLocalStorage();
  if (storage === null) return;

  const destinationResult = newThreadDraftDestinationSchema.safeParse({
    projectId: currentProjectId,
    sectionId: null,
  });
  if (!destinationResult.success) return;

  // Reading is also the cleanup pass: corrupt/empty content keys are swept and
  // duplicate/stale order ids are normalized on every app launch.
  readNewThreadDraftSlots();

  const legacyRaw = storage.getItem(LEGACY_NEW_THREAD_DRAFT_STORAGE_KEY);
  if (legacyRaw === null) return;
  const legacyDraft = parsePromptDraftStorage(legacyRaw);
  if (isPromptDraftEmpty(legacyDraft)) {
    storage.removeItem(LEGACY_NEW_THREAD_DRAFT_STORAGE_KEY);
    return;
  }

  const migration = findLegacyMigrationSlotId(storage, legacyRaw, legacyDraft);
  try {
    if (!migration.alreadyMigrated) {
      persistNewThreadDraftSlot(
        migration.id,
        legacyDraft,
        now,
        destinationResult.data,
      );
    }
    // An older window can write a newer shared draft between our read and
    // clear. Remove only the exact value we migrated; a changed value stays
    // available for the next launch rather than being silently discarded.
    if (storage.getItem(LEGACY_NEW_THREAD_DRAFT_STORAGE_KEY) === legacyRaw) {
      storage.removeItem(LEGACY_NEW_THREAD_DRAFT_STORAGE_KEY);
    }
  } catch (error) {
    console.warn(
      "[prompt-draft] could not migrate the legacy new-thread draft; leaving the original intact",
      error,
    );
  }
}

export const promptDraftSlotStorageKeysForTests = {
  legacy: LEGACY_NEW_THREAD_DRAFT_STORAGE_KEY,
  order: NEW_THREAD_DRAFT_SLOT_ORDER_STORAGE_KEY,
} as const;
