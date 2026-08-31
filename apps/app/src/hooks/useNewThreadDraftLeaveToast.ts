import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { isPromptDraftEmpty, type PromptDraftState } from "@bb/client-core";
import { appToast } from "@/components/ui/app-toast";
import { builtInSidebarDraftRowsVisibleAtom } from "@/components/sidebar/sidebarThreadLifecycle";

export function shouldAnnounceNewThreadDraftLeave({
  draft,
  draftRowsVisible,
  isSplitPane,
}: {
  draft: PromptDraftState;
  draftRowsVisible: boolean;
  isSplitPane: boolean;
}): boolean {
  return !isSplitPane && !draftRowsVisible && !isPromptDraftEmpty(draft);
}

export function useNewThreadDraftLeaveToast({
  getCurrentDraft,
  isSplitPane,
}: {
  getCurrentDraft: () => PromptDraftState;
  isSplitPane: boolean;
}): void {
  const draftRowsVisible = useAtomValue(builtInSidebarDraftRowsVisibleAtom);
  const draftRowsVisibleRef = useRef(draftRowsVisible);
  const getCurrentDraftRef = useRef(getCurrentDraft);
  const isSplitPaneRef = useRef(isSplitPane);
  const mountedRef = useRef(false);

  draftRowsVisibleRef.current = draftRowsVisible;
  getCurrentDraftRef.current = getCurrentDraft;
  isSplitPaneRef.current = isSplitPane;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const shouldAnnounce = shouldAnnounceNewThreadDraftLeave({
        draft: getCurrentDraftRef.current(),
        draftRowsVisible: draftRowsVisibleRef.current,
        isSplitPane: isSplitPaneRef.current,
      });
      if (!shouldAnnounce) return;

      queueMicrotask(() => {
        if (!mountedRef.current) {
          appToast.message("Saved to Drafts");
        }
      });
    };
  }, []);
}
