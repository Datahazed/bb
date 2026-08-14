import {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { useAtomValue } from "jotai";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SplitButton } from "@/components/ui/split-button.js";
import {
  AppPageHeader,
  HEADER_ACTION_GAP_CLASS,
  THREAD_HEADER_EDGE_TO_ICON_SPACING_CLASS,
  THREAD_HEADER_ICON_BUTTON_CLASS,
  THREAD_HEADER_ICON_SPACING_CLASS,
  THREAD_HEADER_TITLE_ACTION_SPACING_CLASS,
} from "@/components/layout/AppPageHeader";
import type { ThreadGitActionDialogTarget } from "@/components/dialogs/ThreadGitActionDialog";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@bb/shared-ui/lib/utils";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { useInlineThreadTitle } from "@/components/thread/InlineThreadTitle";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { ThreadTitleMentions } from "@/components/thread/ThreadTitleMentions";
import { SecondaryPanelHostLayoutContext } from "@/components/secondary-panel/SecondaryPanelHostLayoutContext";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";
import {
  CONTEXT_INACTIVE_TEXT_CLASS,
  CONTEXT_SELECTION_SURFACE_CLASS,
} from "@/components/ui/context-selection";
import { usePaneContext } from "./PaneContext";
import { PaneMaximizeButton } from "./PaneMaximizeButton";
import { SplitDimmingButton } from "./SplitDimmingButton";

const THREAD_HEADER_ACTION_BUTTON_CLASS = cn(
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS,
  "border-border/70 bg-transparent font-normal hover:bg-state-hover",
);
const NARROW_SPLIT_HEADER_MAX_WIDTH = 560;

interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

interface ThreadDetailHeaderProps {
  /**
   * Renders the thread menu. Responsive header actions belong in the menu only
   * while a narrow split hides their inline controls.
   */
  actionsMenu: ((includeResponsiveActions: boolean) => ReactNode) | null;
  /** Pill shown beside the title for side chats and hierarchical child threads. */
  childPillLabel: "child" | "side chat" | null;
  isSecondaryPanelOpen: boolean;
  /** Closes this pane; only provided when the layout is split (>1 pane). */
  onClosePane?: () => void;
  onOpenThreadGitAction: (target: ThreadGitActionDialogTarget) => void;
  onToggleSecondaryPanel: () => void;
  /** Plugin-contributed thread action buttons (design §4.9); optional. */
  pluginActions?: ReactNode;
  threadHeaderGitActions: ThreadHeaderGitAction[];
  threadId: string;
  threadTitle: string;
  workspaceOpenButton?: ReactNode;
}

export function ThreadDetailHeader({
  actionsMenu,
  childPillLabel,
  isSecondaryPanelOpen,
  onClosePane,
  onOpenThreadGitAction,
  onToggleSecondaryPanel,
  pluginActions,
  threadHeaderGitActions,
  threadId,
  threadTitle,
  workspaceOpenButton,
}: ThreadDetailHeaderProps) {
  const [primaryAction, ...secondaryActions] = threadHeaderGitActions;
  const { renameThread } = useThreadActions();
  const handleRename = useCallback(
    (nextTitle: string) => {
      renameThread(threadId, nextTitle);
    },
    [renameThread, threadId],
  );
  const { editor, isEditing, startEditing } = useInlineThreadTitle({
    onCommit: handleRename,
    resetKey: threadId,
    title: threadTitle,
  });
  const renderAsDrawer = useIsCompactViewport();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const dimsInactiveSplits = useAtomValue(dimInactiveSplitsAtom);
  const panelShortcut = useAppCommandShortcut("panel.toggle");
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const headerRef = useRef<HTMLElement>(null!);
  // The title doubles as the pane-reorder drag handle when the layout is split;
  // beginPaneDrag is undefined on the single-pane and page surfaces.
  const {
    beginPaneDrag,
    isFocused,
    isSplitPane,
    isTopRow,
    ownsWindowTopLeft,
    reservesWindowPanelToggle,
    secondaryPanelHost,
  } = usePaneContext();
  const isWindowPanelOpen =
    useContext(SecondaryPanelHostLayoutContext)?.isOpen === true;
  const isSplitPaneHeader = beginPaneDrag !== undefined;
  const [measuredPaneWidth, setMeasuredPaneWidth] = useState(0);
  const usesResponsiveActionOverflow =
    isSplitPaneHeader &&
    measuredPaneWidth > 0 &&
    measuredPaneWidth < NARROW_SPLIT_HEADER_MAX_WIDTH;
  useLayoutEffect(() => {
    if (!isSplitPaneHeader) {
      return;
    }

    const header = headerRef.current;
    const pane = header.closest<HTMLElement>("[data-split-pane-id]");
    const measuredElement = pane ?? header;
    const measure = () => {
      const width = measuredElement.getBoundingClientRect().width;
      if (width > 0) {
        setMeasuredPaneWidth(width);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measuredElement);
    return () => {
      observer.disconnect();
    };
  }, [isSplitPaneHeader]);
  const handleTitlePointerDown = (event: ReactPointerEvent) => {
    if (isEditing || !beginPaneDrag || event.button !== 0) {
      return;
    }
    beginPaneDrag(event, threadTitle);
  };
  const handleTitleDoubleClick = () => {
    if (isEditing) {
      return;
    }
    startEditing();
  };
  const rightPanelLabel = isSecondaryPanelOpen
    ? "Hide right panel"
    : "Show right panel";
  const rightPanelIconName = renderAsDrawer ? "PanelBottom" : "PanelRight";
  // The thread header owns only the show control. Once the panel opens, its
  // toolbar owns collapse so pane actions (including Full Screen) keep their
  // stable positions in the thread header.
  const showRightPanelToggle =
    secondaryPanelHost === null && !isSecondaryPanelOpen;
  const showTitleSpotlight = isSplitPane && isFocused;

  const center = (
    <div
      className={cn(
        "flex min-w-0 max-w-full items-center",
        showTitleSpotlight &&
          actionsMenu != null &&
          THREAD_HEADER_ICON_SPACING_CLASS,
      )}
      data-thread-header-center-actions=""
    >
      <div
        data-pane-header-focus-tab={
          isSplitPaneHeader && isFocused ? "" : undefined
        }
        className={cn(
          "relative flex min-w-4 items-center",
          isSplitPaneHeader && "-ml-2 rounded-md pl-2",
          isSplitPaneHeader && isFocused && CONTEXT_SELECTION_SURFACE_CLASS,
          showTitleSpotlight && THREAD_HEADER_TITLE_ACTION_SPACING_CLASS,
        )}
        data-thread-header-title-cluster=""
      >
        <div
          className={cn("flex min-w-0 items-center", HEADER_ACTION_GAP_CLASS)}
        >
          <p
            className={cn(
              "relative min-w-0 text-sm font-normal transition-colors",
              isEditing ? "overflow-visible" : "truncate",
              isSplitPaneHeader &&
                !isFocused &&
                dimsInactiveSplits &&
                CONTEXT_INACTIVE_TEXT_CLASS,
              beginPaneDrag &&
                !isEditing &&
                cn(
                  "cursor-grab touch-none select-none",
                  // Opt the drag handle out of the macOS title-bar drag region so a
                  // pane-reorder gesture isn't swallowed as a window drag.
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                ),
            )}
            onDoubleClick={handleTitleDoubleClick}
            onPointerDown={beginPaneDrag ? handleTitlePointerDown : undefined}
          >
            {isEditing ? editor : <ThreadTitleMentions title={threadTitle} />}
          </p>
          {childPillLabel ? (
            <Pill variant="outline" size="sm">
              {childPillLabel}
            </Pill>
          ) : null}
        </div>
        {showTitleSpotlight ? (
          <span
            className={cn(
              "shrink-0",
              usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
            )}
          >
            <SplitDimmingButton />
          </span>
        ) : null}
      </div>
      {actionsMenu != null ? (
        <div
          className={cn(
            "flex shrink-0 items-center",
            !showTitleSpotlight && THREAD_HEADER_ICON_SPACING_CLASS,
            !showTitleSpotlight && THREAD_HEADER_EDGE_TO_ICON_SPACING_CLASS,
            usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
          )}
          data-thread-header-title-actions=""
        >
          {/*
            The header's center slot sits inside the macOS title-bar drag
            region (AppPageHeader only exempts the actions slot), so the
            interactive action group opts out or its clicks are swallowed as
            window drags. The no-drag class also carries `relative z-50`, so it
            remains gated on desktop chrome.
          */}
          <span
            data-testid="thread-detail-header-actions-menu"
            className="flex items-center"
          >
            {actionsMenu(usesResponsiveActionOverflow)}
          </span>
        </div>
      ) : null}
    </div>
  );

  const actions = (
    <>
      <div
        className={cn("flex items-center", HEADER_ACTION_GAP_CLASS)}
        data-thread-header-workflow-actions=""
      >
        {pluginActions}
        {!usesResponsiveActionOverflow && workspaceOpenButton ? (
          <span className="inline-flex" data-thread-header-responsive-action="">
            {workspaceOpenButton}
          </span>
        ) : null}
        {!usesResponsiveActionOverflow && primaryAction ? (
          <span className="inline-flex" data-thread-header-responsive-action="">
            {secondaryActions.length > 0 ? (
              <SplitButton
                className={THREAD_HEADER_ACTION_BUTTON_CLASS}
                primaryAction={{
                  label: primaryAction.label,
                  onSelect: () => onOpenThreadGitAction(primaryAction.target),
                }}
                secondaryActions={secondaryActions.map((action) => ({
                  label: action.label,
                  onSelect: () => onOpenThreadGitAction(action.target),
                }))}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={THREAD_HEADER_ACTION_BUTTON_CLASS}
                onClick={() => onOpenThreadGitAction(primaryAction.target)}
              >
                {primaryAction.label}
              </Button>
            )}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "ml-1 flex items-center",
          THREAD_HEADER_ICON_SPACING_CLASS,
        )}
        data-thread-header-pane-actions=""
      >
        {showRightPanelToggle ? (
          <span className="inline-flex items-center gap-1.5">
            <AppCommandShortcutHint shortcut={panelShortcut} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                THREAD_HEADER_ICON_BUTTON_CLASS,
                CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
              )}
              aria-label={
                panelShortcut
                  ? `${rightPanelLabel} (${panelShortcut.label})`
                  : rightPanelLabel
              }
              aria-keyshortcuts={panelShortcut?.ariaKeyshortcuts}
              aria-expanded={isSecondaryPanelOpen}
              onClick={onToggleSecondaryPanel}
            >
              <Icon name={rightPanelIconName} />
            </Button>
          </span>
        ) : null}
        <PaneMaximizeButton />
        {onClosePane ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              THREAD_HEADER_ICON_BUTTON_CLASS,
              CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            )}
            aria-label="Close pane"
            onClick={onClosePane}
          >
            <Icon name="CloseThreadPane" />
          </Button>
        ) : null}
        {reservesWindowPanelToggle && !isWindowPanelOpen ? (
          // Reserve only the fixed 28px corner button. Its modifier-held hint is
          // positioned below the chrome row by the workspace host, so it never
          // consumes or covers this pane-action row. With the window panel open,
          // the toggle overlays the panel's own chrome instead, so the pane
          // actions sit flush at the pane edge.
          <span aria-hidden className={THREAD_HEADER_ICON_BUTTON_CLASS} />
        ) : null}
      </div>
    </>
  );

  return (
    <AppPageHeader
      headerRef={headerRef}
      center={center}
      actions={actions}
      isWindowDragRegion={isTopRow}
      ownsWindowTopLeft={ownsWindowTopLeft}
      className={beginPaneDrag ? "z-[21]" : undefined}
    />
  );
}
