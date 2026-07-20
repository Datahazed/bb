import { useCallback, useMemo, useRef } from "react";
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
  /** Reveals the thread's terminal (open tab, else running session), creating
   * the first one when none exists. */
  openTerminal(): void;
  /** Always starts another terminal session for the thread and opens its tab —
   * threads can hold any number of terminals. */
  newTerminal(): void;
  /** Reveals or opens the tab for one specific running session. */
  openTerminalSession(terminalId: string): void;
  /** Running sessions for this thread, for pickers over `openTerminalSession`. */
  runningTerminals: readonly TerminalSessionSummary[];
  isBusy?: boolean;
}

export interface TerminalSessionSummary {
  id: string;
  title: string;
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

  const openTerminalSession = useCallback(
    (terminalId: string) => {
      applyContent({
        kind: "terminal",
        terminalId,
        target: { kind: "thread", threadId },
      });
    },
    [applyContent, threadId],
  );

  const newTerminal = useCallback(() => {
    if (createTerminal.isPending || isCreatingTerminalRef.current) {
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
          openTerminalSession(session.id);
        },
        onSettled: () => {
          isCreatingTerminalRef.current = false;
        },
      },
    );
  }, [createTerminal, openTerminalSession, threadId]);

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
      openTerminalSession(runningSession.id);
      return;
    }

    if (isLoadingTerminals) {
      return;
    }
    newTerminal();
  }, [
    isLoadingTerminals,
    navigate,
    newTerminal,
    openTerminalSession,
    projectId,
    store,
    terminalsQuery.data?.sessions,
    threadId,
  ]);

  const runningTerminals = useMemo<readonly TerminalSessionSummary[]>(
    () =>
      (terminalsQuery.data?.sessions ?? [])
        .filter((session) => session.status === "running")
        .map((session) => ({ id: session.id, title: session.title })),
    [terminalsQuery.data?.sessions],
  );

  return {
    openDiff,
    openTerminal,
    newTerminal,
    openTerminalSession,
    runningTerminals,
    isBusy: isLoadingTerminals || createTerminal.isPending,
  };
}
