// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { listPanes } from "@/lib/split-layout";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";

const mockUseThread = vi.hoisted(() => vi.fn());
const mockUseThreadDetailBootstrap = vi.hoisted(() => vi.fn());
const commandHandlers = vi.hoisted(() => new Map<string, () => boolean>());

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (
    command: string,
    handler: () => boolean,
    _priority = 0,
    enabled = true,
  ) => {
    if (enabled) commandHandlers.set(command, handler);
    else commandHandlers.delete(command);
  },
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => new Map(),
  useAppCommandRunner: () => ({
    dispatch: () => false,
    isCommandAvailable: () => false,
  }),
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/components/sidebar/AppSidebar", () => ({
  AppSidebar: ({ onSplit }: { onSplit?: () => void }) => (
    <aside data-testid="app-sidebar">
      {onSplit ? (
        <button type="button" onClick={onSplit}>
          Split
        </button>
      ) : null}
    </aside>
  ),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      experiments: {
        changelogPreview: false,
        editMessages: false,
        mobileApp: false,
        providerSessionReaping: false,
        timelineWindowing: false,
      },
    },
  }),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("./AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  AppPageHeader: ({
    center,
    actions,
  }: {
    center?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header>
      {center}
      {actions}
    </header>
  ),
}));

vi.mock("@/lib/iframe-drag-guard", () => ({
  IframeDragGuardOverlay: () => null,
}));

vi.mock("@/lib/bb-desktop", () => ({
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS: "",
  CHROME_ROW_CLASS: "",
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  MACOS_CHROME_CONTROL_AXIS_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: {
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [
        {
          id: "proj_opened",
          kind: "standard",
          name: "Opened Project",
          sources: [],
          threads: [],
          defaultExecutionOptions: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: (...args: unknown[]) => mockUseThread(...args),
  useThreadDetailBootstrap: (...args: unknown[]) =>
    mockUseThreadDetailBootstrap(...args),
  useThreadPendingInteractions: () => ({ data: undefined }),
  getLatestPendingInteraction: () => null,
}));

describe("AppLayout root compose project preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    commandHandlers.clear();
    mockUseThread.mockReturnValue({
      data: {
        id: "thr_opened",
        projectId: "proj_opened",
        title: "Opened Thread",
        titleFallback: "Opened Thread",
        lastReadAt: 100,
        latestAttentionAt: 100,
      },
    });
    mockUseThreadDetailBootstrap.mockReturnValue({
      isError: false,
      isSuccess: true,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    commandHandlers.clear();
    vi.clearAllMocks();
  });

  it("uses the opened thread project for the new-thread command", async () => {
    window.localStorage.setItem(
      ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
      "proj_last_run",
    );

    render(
      <MemoryRouter
        initialEntries={["/projects/proj_opened/threads/thr_opened"]}
      >
        <AppLayout>
          <div>Thread route</div>
        </AppLayout>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.title).toBe("Opened Thread");
    });

    act(() => {
      expect(commandHandlers.get("thread.new")?.()).toBe(true);
    });

    await waitFor(() => {
      expect(
        window.localStorage.getItem(ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY),
      ).toBe("proj_opened");
    });
  });

  it("keeps the stored project when the route has no project", () => {
    window.localStorage.setItem(
      ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
      "proj_last_run",
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppLayout>
          <div>New thread route</div>
        </AppLayout>
      </MemoryRouter>,
    );

    act(() => {
      expect(commandHandlers.get("thread.new")?.()).toBe(true);
    });

    expect(
      window.localStorage.getItem(ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY),
    ).toBe("proj_last_run");
  });

  it("enters Split with two independently writable draft slots and left focus", async () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={["/projects/proj_opened/threads/thr_opened"]}
        >
          <AppLayout>
            <div>Thread route</div>
          </AppLayout>
        </MemoryRouter>
      </Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Split" }));
    expect(commandHandlers.has("thread.split")).toBe(false);

    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    const panes = listPanes(layout!.root);
    expect(panes).toHaveLength(2);
    expect(layout?.focusedPaneId).toBe(panes[0]?.paneId);
    const leftContent = panes[0]?.content;
    const rightContent = panes[1]?.content;
    expect(leftContent?.kind).toBe("new-thread");
    expect(rightContent?.kind).toBe("new-thread");
    if (
      leftContent?.kind !== "new-thread" ||
      rightContent?.kind !== "new-thread"
    ) {
      throw new Error("Split did not create two New thread panes.");
    }
    expect(leftContent.draftSlotId).not.toBe(rightContent.draftSlotId);

    const destination = { projectId: "proj_opened", sectionId: null };
    const leftDraft = getPromptDraftAccessor({
      kind: "new-thread",
      slotId: leftContent.draftSlotId,
      destination,
    });
    const rightDraft = getPromptDraftAccessor({
      kind: "new-thread",
      slotId: rightContent.draftSlotId,
      destination,
    });
    act(() => {
      leftDraft.setDraft({
        text: "Left pane draft",
        mentions: [],
        attachments: [],
      });
      rightDraft.setDraft({
        text: "Right pane draft",
        mentions: [],
        attachments: [],
      });
    });

    expect(leftDraft.getCurrent().text).toBe("Left pane draft");
    expect(rightDraft.getCurrent().text).toBe("Right pane draft");
  });
});
