const ROOT_COMPOSE_DRAFT_SLOT_ID_FIELD = "draftSlotId";

function isLocationStateRecord(
  state: unknown,
): state is Record<string, unknown> {
  return typeof state === "object" && state !== null && !Array.isArray(state);
}

export function readRootComposeDraftSlotId(state: unknown): string | null {
  if (!isLocationStateRecord(state)) return null;
  const draftSlotId = state[ROOT_COMPOSE_DRAFT_SLOT_ID_FIELD];
  return typeof draftSlotId === "string" && draftSlotId.trim().length > 0
    ? draftSlotId
    : null;
}

export function withRootComposeDraftSlotId(
  state: unknown,
  draftSlotId: string,
): Record<string, unknown> {
  return {
    ...(isLocationStateRecord(state) ? state : {}),
    [ROOT_COMPOSE_DRAFT_SLOT_ID_FIELD]: draftSlotId,
  };
}
