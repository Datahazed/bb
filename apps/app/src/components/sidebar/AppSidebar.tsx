import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { THREAD_JUMP_APP_COMMAND_IDS } from "@bb/domain";
import { Link, useNavigate } from "react-router-dom";
import { useAtomValue } from "jotai";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar.js";
import {
  ProjectList,
  ProjectListNewThreadAction,
  ProjectListSearchThreadsAction,
} from "./ProjectList";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import {
  AutomationsNavSidebarItem,
  ExtensionsNavSidebarItem,
  PluginNavSidebarItems,
} from "@/components/plugin/PluginNavSidebarItems";
import { PluginSidebarFooterActions } from "@/components/plugin/PluginSidebarFooterActions";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  AUTOMATIONS_PLUGIN_ID,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import { createNewThreadDraftSlotId } from "@/lib/prompt-draft-slots";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutKeysContext,
  type SidebarThreadShortcutPresentation,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";
import {
  useAppCommandHandler,
  useAppCommandRunner,
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { SidebarTopRegionCustomizeMenu } from "./SidebarTopRegionCustomizeMenu";
import {
  sidebarTopRegionItemPreferencesAtom,
  type SidebarTopRegionItemId,
} from "./sidebarTopRegionItemPreferences";
import {
  DEFAULT_SIDEBAR_REGION_ORDER,
  normalizeSidebarRegionOrder,
  sidebarRegionOrderAtom,
  type SidebarRegionId,
} from "./sidebarRegionOrderPreferences";

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";
const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface SidebarTopLevelSectionsProps {
  sections: Readonly<Record<SidebarTopLevelSectionId, ReactNode>>;
  order?: readonly SidebarRegionId[];
}

const SIDEBAR_REGION_SECTION_IDS: Readonly<
  Record<SidebarRegionId, SidebarTopLevelSectionId>
> = {
  "bb-controls": "new-thread-extensions",
  plugins: "plugin-pages",
  threads: "thread-list",
};

type SidebarTopLevelSectionId =
  (typeof SIDEBAR_REGION_SECTION_IDS)[SidebarRegionId];

/**
 * Renders the three persistent sidebar regions and derives dividers from the
 * regions that actually contribute content. The thread-list surface owns its
 * own separate preceding divider; every other divider stays structural and
 * outside keyboard order.
 */
export function SidebarTopLevelSections({
  sections,
  order = DEFAULT_SIDEBAR_REGION_ORDER,
}: SidebarTopLevelSectionsProps) {
  const visibleSections = normalizeSidebarRegionOrder(order).flatMap(
    (regionId) => {
      const id = SIDEBAR_REGION_SECTION_IDS[regionId];
      const content = sections[id];
      return content === null ? [] : [{ id, regionId, content }];
    },
  );

  return visibleSections.map(({ id, regionId, content }, index) => {
    const integratesDivider = id === "thread-list" && index > 0;
    return (
      <Fragment key={id}>
        {index > 0 && !integratesDivider ? (
          <div
            aria-hidden="true"
            data-sidebar-top-level-divider=""
            className="mx-2 h-px shrink-0 bg-sidebar-border"
          />
        ) : null}
        <div
          data-sidebar-region={regionId}
          data-sidebar-integrated-divider={
            integratesDivider ? "" : undefined
          }
          data-sidebar-top-level-section={id}
          className={cn(
            "min-w-0",
            id === "thread-list"
              ? "flex min-h-0 flex-1 flex-col"
              : "shrink-0",
          )}
        >
          {content}
        </div>
      </Fragment>
    );
  });
}

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  settingsRoutePath: string;
  toolsRoutePath?: string;
  onSplit?: () => void;
  /**
   * Compact drawer hosting. When set, the sidebar renders its body only,
   * inside a persistent `<Sidebar>` panel owned by AppLayoutSidebar, and stays
   * mounted (hidden) while a Settings/Tools body is showing, so returning to
   * the app never remounts the thread list in the closed drawer.
   */
  mobileHosted?: { hidden: boolean };
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  settingsRoutePath,
  toolsRoutePath,
  onSplit,
  mobileHosted,
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
  // The resolved replacement owns the sidebar's scrolling thread list. It never
  // replaces the chrome around it: the New-thread button, plugin nav rows, and
  // footer stay host-rendered in every sidebar.
  const threadListReplacement = useThreadListReplacement();
  const { threadId: activeThreadId, projectId: activeProjectId } =
    useRouteState();
  const navigate = useNavigate();
  const createNewThreadPaneContent = useCallback(
    () => ({
      kind: "new-thread" as const,
      draftSlotId: createNewThreadDraftSlotId(),
    }),
    [],
  );
  const newThreadSplit = usePaneContentSplitDrag({
    createContent: createNewThreadPaneContent,
    enabled: true,
    label: "New thread",
  });
  const closeOnMobile = useCloseMobileSidebar();
  const appCommandRunner = useAppCommandRunner();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  const topRegionItemPreferences = useAtomValue(
    sidebarTopRegionItemPreferencesAtom,
  );
  const sidebarRegionOrder = useAtomValue(sidebarRegionOrderAtom);
  const pluginNavPanels = usePluginNavPanelChrome();
  const automationsNavPanel = pluginNavPanels.find(
    ({ chrome }) => chrome.pluginId === AUTOMATIONS_PLUGIN_ID,
  );
  const hasTraditionalPluginPanels = pluginNavPanels.some(
    ({ chrome }) => chrome.pluginId !== AUTOMATIONS_PLUGIN_ID,
  );

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);
  const handleSearchThreads = useCallback(
    (target: EventTarget | null) => {
      closeOnMobile();
      appCommandRunner.dispatch("thread.search", target);
    },
    [appCommandRunner, closeOnMobile],
  );
  const showThreadShortcuts = useCallback(() => {
    const targets = getSidebarThreadShortcutTargets(sidebarRef.current);
    threadShortcutTargetsRef.current = targets;
    setThreadShortcutKeysById(
      new Map(
        targets.flatMap((target, index) => {
          const command = THREAD_JUMP_APP_COMMAND_IDS[index];
          const shortcut = command
            ? threadJumpShortcuts.get(command)
            : undefined;
          return shortcut ? [[target.threadId, shortcut] as const] : [];
        }),
      ),
    );
  }, [threadJumpShortcuts]);

  const hideThreadShortcuts = useCallback(() => {
    threadShortcutTargetsRef.current = [];
    setThreadShortcutKeysById(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  }, []);

  const activateThreadShortcut = useCallback((index: number): boolean => {
    const targets = threadShortcutTargetsRef.current;
    const target =
      targets[index] ??
      getSidebarThreadShortcutTargets(sidebarRef.current)[index];
    if (!target?.element) return false;
    target.element.click();
    return true;
  }, []);

  const activateAdjacentThread = useCallback(
    (offset: -1 | 1): boolean => {
      const targets = getSidebarThreadNavigationTargets(sidebarRef.current);
      if (targets.length === 0) return false;
      const activeIndex = targets.findIndex(
        (target) => target.threadId === activeThreadId,
      );
      const nextIndex =
        activeIndex === -1
          ? offset === 1
            ? 0
            : targets.length - 1
          : (activeIndex + offset + targets.length) % targets.length;
      const target = targets[nextIndex];
      if (!target) return false;
      if (target.element) {
        target.element.click();
        return true;
      }
      // The neighbor sits inside a windowed-out placeholder: there is no row
      // to click, so navigate by id, matching what the row's link would do.
      if (!target.projectId) return false;
      closeOnMobile();
      void navigate(
        getThreadRoutePath({
          projectId: target.projectId,
          threadId: target.threadId,
        }),
      );
      return true;
    },
    [activeThreadId, closeOnMobile, navigate],
  );

  // While hosted-and-hidden (a Settings/Tools body is showing in the drawer)
  // this sidebar is not the visible one: leave its shortcuts unhandled, as
  // they are on wide viewports where Settings/Tools replace the sidebar,
  // rather than clicking rows the user cannot see.
  const isHiddenHostedBody = mobileHosted?.hidden === true;
  const activateVisibleThreadShortcut = useCallback(
    (index: number) =>
      isHiddenHostedBody ? false : activateThreadShortcut(index),
    [activateThreadShortcut, isHiddenHostedBody],
  );
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateVisibleThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(-1),
  );
  useAppCommandHandler("thread.next", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(1),
  );

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  const originalThreadList = (
    <ProjectList
      onNewProject={
        quickCreateProject.isAvailable
          ? quickCreateProject.openCreateDialog
          : undefined
      }
      onProjectSelect={closeOnMobile}
      isCreatingProject={quickCreateProject.isCreating}
    />
  );
  const topRegionItemNodes: Record<
    SidebarTopRegionItemId,
    ReactNode | null
  > = {
    "new-thread": (
      <ProjectListNewThreadAction
        splitEnabled
        newThreadSplit={newThreadSplit}
        onNewChat={handleNewChat}
        onSplit={onSplit}
      />
    ),
    search: (
      <ProjectListSearchThreadsAction
        onSearchThreads={handleSearchThreads}
      />
    ),
    extensions: toolsRoutePath ? (
      <ExtensionsNavSidebarItem
        routePath={toolsRoutePath}
        onNavigate={closeOnMobile}
      />
    ) : null,
    automations: automationsNavPanel ? (
      <AutomationsNavSidebarItem
        chrome={automationsNavPanel.chrome}
        onNavigate={closeOnMobile}
      />
    ) : null,
  };
  const visibleTopRegionItems = topRegionItemPreferences.order.flatMap((id) => {
    if (topRegionItemPreferences.hiddenIds.includes(id)) return [];
    const node = topRegionItemNodes[id];
    return node === null
      ? []
      : [
          <div key={id} data-sidebar-top-region-item={id}>
            {node}
          </div>,
        ];
  });

  const body = (
    <>
      {showTopReserve ? (
        /* Top reserve that keeps the sidebar's content (New Thread / New
             Projects) anchored below the title-bar chrome, mirroring
             the page-header height on the content side. The sidebar toggle is
             pinned at the app's top-left for every chrome (see AppLayout's
             SidebarTriggerOverlay), so this row hosts no trigger of its own — it
             stays mounted in every sidebar state, including while the panel
             collapses off-canvas, so the content holds its vertical position
             instead of riding up under the pinned toggle during the animation.
             On desktop it doubles as the window-drag strip. The Back/Forward
             route-history controls live on the right of this chrome row, clear
             of the pinned toggle/traffic lights on the left and the resize
             handle on the right; they opt out of the desktop drag region so
             clicks register. Customize owns a compact toolbar row immediately
             below this chrome and above the top-region items. */
        <div
          data-testid="app-sidebar-top-reserve-row"
          className={cn(
            CHROME_ROW_CLASS,
            "shrink-0 justify-end px-2",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          <div
            className={cn(
              "group-data-[collapsible=icon]:hidden",
              usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
            )}
          >
            <SidebarHistoryNavigationControls onNavigate={closeOnMobile} />
          </div>
        </div>
      ) : null}
      <div
        data-testid="app-sidebar-customize-toolbar"
        className="flex h-8 shrink-0 items-center justify-end px-2 group-data-[collapsible=icon]:hidden"
      >
        <SidebarTopRegionCustomizeMenu />
      </div>
      <SidebarContent>
        <SidebarTopLevelSections
          order={sidebarRegionOrder}
          sections={{
            "new-thread-extensions":
              visibleTopRegionItems.length > 0 ? (
                <div
                  data-testid="app-sidebar-primary-actions"
                  className="space-y-1 px-2 pb-2 group-data-[collapsible=icon]:hidden"
                >
                  {visibleTopRegionItems}
                </div>
              ) : null,
            "plugin-pages": hasTraditionalPluginPanels ? (
              <PluginNavSidebarItems onNavigate={closeOnMobile} splitEnabled />
            ) : null,
            "thread-list": (
              <PluginThreadList
                replacement={threadListReplacement}
                original={originalThreadList}
                searchQuery=""
                onNavigate={closeOnMobile}
              />
            ),
          }}
        />
      </SidebarContent>
      <SidebarFooter className="relative">
        <OverflowFade placement="above" tone="sidebar" size="sm" />
        {/* The footer holds a variable number of plugin action buttons, so a
         * narrowed sidebar plus several plugins can no longer fit the action
         * row and the update chips on one line. `flex-wrap-reverse` plus the
         * flexible spacer below handles both layouts without measuring:
         * while everything fits, the spacer stretches and pushes the chips to
         * the right of a single row; once it doesn't, the chips wrap onto
         * their own line, which wrap-reverse renders above the actions, and
         * they sit flush left because the spacer stays behind on the action
         * line. */}
        <SidebarMenu className="flex-row flex-wrap-reverse items-center gap-1">
          <SidebarMenuItem className="min-w-0">
            <SidebarMenuButton
              asChild
              aria-label={
                settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings"
              }
              aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
              tooltip={{
                children: settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings",
                hidden: false,
                side: "top",
              }}
              className={SIDEBAR_FOOTER_ACTION_CLASS}
            >
              <Link to={settingsRoutePath} onClick={closeOnMobile}>
                <Icon name="Settings" />
                <span className="sr-only">Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <PluginSidebarFooterActions onNavigate={closeOnMobile} />
          <SidebarMenuItem className="min-w-0">
            <SidebarMenuButton
              className={SIDEBAR_FOOTER_ACTION_CLASS}
              tooltip={{
                children: "Report a bug",
                hidden: false,
                side: "top",
              }}
              aria-label="Report a bug"
              onClick={() => {
                closeOnMobile();
                openUrlInExternalBrowser(BUG_REPORT_NEW_ISSUE_URL);
              }}
            >
              <Icon name="Bug" />
              <span className="sr-only">Report a bug</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <li aria-hidden="true" className="min-w-0 flex-1" />
          <SidebarPluginAttentionGlyph
            className={SIDEBAR_FOOTER_ACTION_CLASS}
            onNavigate={closeOnMobile}
          />
          <SidebarUpdatesBadge onNavigate={closeOnMobile} />
        </SidebarMenu>
      </SidebarFooter>
      <div
        data-testid="app-sidebar-resize-handle"
        className={cn(
          "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
          "group-data-[collapsible=icon]:hidden",
          isResizing && "before:bg-sidebar-border",
        )}
        onMouseDown={onResizeMouseDown}
      />
    </>
  );

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      {mobileHosted ? (
        <div
          ref={sidebarRef}
          data-testid="app-sidebar-body"
          hidden={mobileHosted.hidden}
          className="flex min-h-0 flex-1 flex-col"
        >
          {body}
        </div>
      ) : (
        <Sidebar ref={sidebarRef}>{body}</Sidebar>
      )}
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
