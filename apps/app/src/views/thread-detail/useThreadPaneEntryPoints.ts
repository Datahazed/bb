import { useCallback, useRef } from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import {
  useCreateThreadTerminal,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  activateTab,
  findContentTab,
  listTabs,
  openTab,
  setFocus,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";
import { paneContentRoute } from "./splitThreadNavigation";

const TERMINAL_COLS = 100;
const TERMINAL_ROWS = 30;

interface UseThreadPaneEntryPointsArgs {
  projectId: string;
  threadId: string;
}

interface ThreadPaneEntryPoints {
  openDiff(): void;
  openTerminal(): void;
  isBusy?: boolean;
}

function revealTab(
  layout: SplitLayout,
  location: NonNullable<ReturnType<typeof findContentTab>>,
): SplitLayout {
  return setFocus(
    activateTab(layout, location.pane.paneId, location.tab.tabId),
    location.pane.paneId,
  );
}

export function useThreadPaneEntryPoints({
  projectId,
  threadId,
}: UseThreadPaneEntryPointsArgs): ThreadPaneEntryPoints {
  const store = useStore();
  const navigate = useNavigate();
  const terminalsQuery = useThreadTerminals(threadId);
  const createTerminal = useCreateThreadTerminal();
  const isCreatingTerminalRef = useRef(false);
  const isLoadingTerminals =
    terminalsQuery.data === undefined &&
    (terminalsQuery.isLoading || terminalsQuery.isFetching);

  const applyContent = useCallback(
    (content: PaneContent) => {
      const layout = store.get(splitLayoutAtom);
      if (layout === null) {
        return;
      }
      const threadLocation = findContentTab(layout.root, {
        kind: "thread",
        projectId,
        threadId,
      });
      if (threadLocation === null) {
        return;
      }

      const existing = findContentTab(layout.root, content);
      const nextLayout =
        existing === null
          ? openTab(layout, threadLocation.pane.paneId, content)
          : revealTab(layout, existing);
      if (nextLayout === layout) {
        return;
      }
      store.set(splitLayoutAtom, nextLayout);
      void navigate(paneContentRoute(content), { replace: true });
    },
    [navigate, projectId, store, threadId],
  );

  const openDiff = useCallback(() => {
    applyContent({ kind: "diff", projectId, threadId });
  }, [applyContent, projectId, threadId]);

  const openTerminal = useCallback(() => {
    const layout = store.get(splitLayoutAtom);
    if (layout === null) {
      return;
    }
    const threadLocation = findContentTab(layout.root, {
      kind: "thread",
      projectId,
      threadId,
    });
    if (threadLocation === null) {
      return;
    }

    const existingTerminal = listTabs(layout.root).find(
      ({ tab }) =>
        tab.content.kind === "terminal" &&
        tab.content.target?.kind === "thread" &&
        tab.content.target.threadId === threadId,
    );
    if (existingTerminal !== undefined) {
      const content = existingTerminal.tab.content;
      const nextLayout = setFocus(
        activateTab(
          layout,
          existingTerminal.pane.paneId,
          existingTerminal.tab.tabId,
        ),
        existingTerminal.pane.paneId,
      );
      store.set(splitLayoutAtom, nextLayout);
      void navigate(paneContentRoute(content), { replace: true });
      return;
    }

    const runningSession = terminalsQuery.data?.sessions.find(
      (session) => session.status === "running",
    );
    if (runningSession !== undefined) {
      applyContent({
        kind: "terminal",
        terminalId: runningSession.id,
        target: { kind: "thread", threadId },
      });
      return;
    }

    if (
      isLoadingTerminals ||
      createTerminal.isPending ||
      isCreatingTerminalRef.current
    ) {
      return;
    }
    isCreatingTerminalRef.current = true;
    createTerminal.mutate(
      {
        threadId,
        cols: TERMINAL_COLS,
        rows: TERMINAL_ROWS,
      },
      {
        onSuccess: (session) => {
          applyContent({
            kind: "terminal",
            terminalId: session.id,
            target: { kind: "thread", threadId },
          });
        },
        onSettled: () => {
          isCreatingTerminalRef.current = false;
        },
      },
    );
  }, [
    applyContent,
    createTerminal,
    isLoadingTerminals,
    navigate,
    projectId,
    store,
    terminalsQuery.data?.sessions,
    threadId,
  ]);

  return {
    openDiff,
    openTerminal,
    isBusy: isLoadingTerminals || createTerminal.isPending,
  };
}
