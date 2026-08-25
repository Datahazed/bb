import { useEffect, useRef } from "react";
import { initializeNewThreadDraftSlots } from "@/lib/prompt-draft-slots";
import { readRootComposeProjectId } from "@/lib/root-compose-selection";

/**
 * Launch-time client-local migrations that must run regardless of which
 * sidebar surface owns thread-list rendering.
 */
export function AppLocalStateInitialization() {
  const didInitializeDraftSlots = useRef(false);

  useEffect(() => {
    if (didInitializeDraftSlots.current) return;
    didInitializeDraftSlots.current = true;
    initializeNewThreadDraftSlots(readRootComposeProjectId());
  }, []);

  return null;
}
