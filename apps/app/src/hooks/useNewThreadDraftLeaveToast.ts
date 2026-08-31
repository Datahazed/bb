import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { isPromptDraftEmpty, type PromptDraftState } from "@bb/client-core";
import { appToast } from "@/components/ui/app-toast";
import { builtInSidebarDraftRowsVisibleAtom } from "@/components/sidebar/sidebarThreadLifecycle";

export function shouldAnnounceNewThreadDraftLeave({
  draft,
  draftRowsVisible,
}: {
  draft: PromptDraftState;
  draftRowsVisible: boolean;
}): boolean {
  return !draftRowsVisible && !isPromptDraftEmpty(draft);
}

let savedDraftToastScheduled = false;

function scheduleSavedDraftToast(): void {
  if (savedDraftToastScheduled) return;
  savedDraftToastScheduled = true;
  queueMicrotask(() => {
    savedDraftToastScheduled = false;
    appToast.message("Saved to Drafts");
  });
}

export function useNewThreadDraftLeaveToast({
  getCurrentDraft,
}: {
  getCurrentDraft: () => PromptDraftState;
}): void {
  const draftRowsVisible = useAtomValue(builtInSidebarDraftRowsVisibleAtom);
  const draftRowsVisibleRef = useRef(draftRowsVisible);
  const getCurrentDraftRef = useRef(getCurrentDraft);
  const mountedRef = useRef(false);

  draftRowsVisibleRef.current = draftRowsVisible;
  getCurrentDraftRef.current = getCurrentDraft;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const shouldAnnounce = shouldAnnounceNewThreadDraftLeave({
        draft: getCurrentDraftRef.current(),
        draftRowsVisible: draftRowsVisibleRef.current,
      });
      if (!shouldAnnounce) return;

      queueMicrotask(() => {
        if (!mountedRef.current) {
          scheduleSavedDraftToast();
        }
      });
    };
  }, []);
}
