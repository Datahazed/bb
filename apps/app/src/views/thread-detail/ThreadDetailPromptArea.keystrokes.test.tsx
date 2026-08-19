// @vitest-environment jsdom

import type { PendingInteraction, ThreadWithRuntime } from "@bb/domain";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PluginComposerHostScopeProvider,
  usePluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

/**
 * Keystroke isolation for the thread prompt area (mobile-perf D1).
 *
 * The prompt area body runs ~70 hooks. It must not re-render per keystroke:
 * only the composer wrapper (which owns the draft subscription) and the plugin
 * host publication may track the live draft. These tests use the real draft
 * store so keystrokes flow the way they do in the app.
 */

const mocks = vi.hoisted(() => ({
  contextBannerRenders: vi.fn(),
  queuedMessagesListRenders: vi.fn(),
  sendMessageMutateAsync: vi.fn(),
  todoCardRenders: vi.fn(),
  useThreadCreationOptions: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/components/promptbox/FollowUpPromptBox", () => ({
  FollowUpPromptBox: ({
    composer,
    pendingInteraction = null,
    stack,
  }: {
    composer: {
      message: string;
      onChangeMessage: (message: string, mentions: []) => void;
      onSubmit: () => void;
    } | null;
    pendingInteraction?: ReactNode;
    stack: ReactNode;
  }) => (
    <div data-testid="follow-up-prompt-box">
      <div data-testid="prompt-stack">
        {stack}
        {pendingInteraction}
      </div>
      {composer ? (
        // Like the real FollowUpPromptBox: hidden, not unmounted, while a
        // pending interaction takes the composer's place.
        <div hidden={pendingInteraction !== null}>
          <input
            aria-label="Composer message"
            value={composer.message}
            onChange={(event) =>
              composer.onChangeMessage(event.currentTarget.value, [])
            }
          />
          <button type="button" onClick={composer.onSubmit}>
            Submit composer
          </button>
        </div>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/promptbox/ThreadEnvironmentSummary", () => ({
  ThreadEnvironmentSummary: () => <div />,
}));

vi.mock("@/components/promptbox/banner/QueuedMessagesList", () => ({
  QueuedMessagesList: () => {
    mocks.queuedMessagesListRenders();
    return <div data-testid="queued-message-list" />;
  },
}));

vi.mock("@/components/promptbox/banner/ThreadBackgroundCommandsCard", () => ({
  ThreadBackgroundCommandsCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadGoalCard", () => ({
  ThreadGoalCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadPromptContextBanner", () => ({
  ThreadPromptContextBanner: () => {
    mocks.contextBannerRenders();
    return <div data-testid="context-banner" />;
  },
}));

vi.mock("@/components/promptbox/banner/ThreadPromptModeCard", () => ({
  ThreadPromptModeCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadTodoCard", () => ({
  ThreadTodoCard: () => {
    mocks.todoCardRenders();
    return null;
  },
}));

vi.mock("@/components/promptbox/banner/ThreadWorkflowCard", () => ({
  ThreadWorkflowCard: () => null,
}));

vi.mock(
  "@/components/thread/pending-interactions/ThreadPendingInteractionBanner",
  () => ({
    ThreadPendingInteractionBanner: () => (
      <div data-testid="pending-interaction" />
    ),
  }),
);

vi.mock("@/components/plugin/PluginPendingInteractionComposer", () => ({
  PluginPendingInteractionComposer: () => null,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    hasMore: false,
    isError: false,
    isLoading: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    suggestions: [],
    trigger: null,
  }),
}));

vi.mock("@/hooks/useEscapeToHide", () => ({
  useEscapeToHide: () => undefined,
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    isError: false,
    isLoading: false,
    setQuery: vi.fn(),
    suggestions: [],
  }),
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: (options: unknown) => {
    // One call per ThreadDetailPromptArea render: the render counter.
    mocks.useThreadCreationOptions(options);
    return {
      activeModel: null,
      executionInputSources: {},
      hasMultipleProviders: false,
      isLoadingModels: false,
      modelLoadError: null,
      modelLoadFailed: false,
      modelOptions: [],
      moreModelOptions: [],
      permissionMode: "auto",
      permissionModeOptions: [],
      providerOptions: [],
      reasoningLevel: "medium",
      reasoningOptions: [],
      selectedModel: "gpt-5",
      selectedProviderComposerActions: [],
      selectedProviderDisplayName: "Codex",
      selectedProviderId: "codex",
      serviceTier: undefined,
      serviceTierSupportByProvider: {},
      setPermissionMode: vi.fn(),
      setReasoningLevel: vi.fn(),
      setSelectedModel: vi.fn(),
      setServiceTier: vi.fn(),
      supportsPermissionModeSelection: true,
      supportsServiceTier: false,
    };
  },
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => {
  const idleMutation = () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    variables: null,
  });
  return {
    useCancelThreadPlan: idleMutation,
    useClearThreadGoal: idleMutation,
    useCreateThreadQueuedMessage: idleMutation,
    useDeleteThreadQueuedMessage: idleMutation,
    useReorderThreadQueuedMessage: idleMutation,
    useSetThreadQueuedMessageGroupBoundary: idleMutation,
    useSendThreadQueuedMessage: idleMutation,
    useStopThread: idleMutation,
    useUpdateThreadQueuedMessage: idleMutation,
  };
});

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useUnarchiveThread: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: null,
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectDisplayName: () => null,
}));

vi.mock("@/hooks/queries/thread-default-execution-options-query", () => ({
  useThreadDefaultExecutionOptions: () => ({
    data: {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    isError: false,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  getLatestPendingInteraction: (interactions: readonly PendingInteraction[]) =>
    interactions.at(-1) ?? null,
  useThreadPromptHistory: () => ({ data: [] }),
  useThreadQueuedMessages: () => ({ data: [] }),
}));

const PROJECT_ID = "proj_keystrokes";

function makeThread(id: string): ThreadWithRuntime {
  return {
    archivedAt: null,
    environmentId: null,
    id,
    projectId: PROJECT_ID,
    providerId: "codex",
    runtime: { displayStatus: "idle" },
    status: "idle",
  } as ThreadWithRuntime;
}

function makePendingInteraction(threadId: string): PendingInteraction {
  return {
    id: `interaction-${threadId}`,
    threadId,
    turnId: "turn-1",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "provider-request-1",
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "provider-request-1",
    },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Continue?",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
    resolution: null,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

function PublishedHostDraft() {
  const host = usePluginComposerHost();
  return <div data-testid="published-host-draft">{host?.draft.text ?? ""}</div>;
}

function renderPromptArea({
  thread,
  pendingInteractions = [],
}: {
  thread: ThreadWithRuntime;
  pendingInteractions?: readonly PendingInteraction[];
}) {
  return render(
    <PluginComposerHostScopeProvider>
      <PublishedHostDraft />
      <ThreadDetailPromptArea
        activeBackgroundAgentCount={0}
        activeBackgroundCommands={[]}
        activePromptMode={null}
        activeWorkflows={[]}
        canUseGitUi={false}
        childPendingInteractions={[]}
        childThreadsSection={null}
        composerFocusRequestNonce={0}
        contextBannerMergeBase={null}
        environmentGoneStatus={null}
        goal={null}
        modelFallback={null}
        isEnvironmentActionPending={false}
        onChangedFileClick={vi.fn()}
        openThreadDiffPanel={vi.fn()}
        parentThreadSection={null}
        pendingInteractions={pendingInteractions}
        pendingInteractionsInitialLoading={false}
        pendingTodos={null}
        projectId={PROJECT_ID}
        pullRequest={null}
        pullRequestMergeMethod="squash"
        resolveMentionLink={() => null}
        sendMessage={{
          isPending: false,
          mutateAsync: mocks.sendMessageMutateAsync,
        }}
        steerActiveThreadOnEnter={false}
        thread={thread}
        workspaceChangedFilesSection={null}
        workspaceStatusPending={false}
      />
    </PluginComposerHostScopeProvider>,
  );
}

function typeIntoComposer(text: string) {
  const input = screen.getByRole("textbox", {
    name: "Composer message",
  }) as HTMLInputElement;
  for (let index = 1; index <= text.length; index += 1) {
    fireEvent.change(input, { target: { value: text.slice(0, index) } });
  }
  return input;
}

let threadCounter = 0;
let threadId = "";

beforeEach(() => {
  threadCounter += 1;
  threadId = `thr_keystrokes_${threadCounter}`;
  mocks.sendMessageMutateAsync.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  getPromptDraftAccessor({
    kind: "thread",
    projectId: PROJECT_ID,
    threadId,
  }).clear();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea keystrokes", () => {
  it("re-renders the composer, not the prompt area or its stack, per keystroke", () => {
    renderPromptArea({ thread: makeThread(threadId) });
    const input = screen.getByRole("textbox", {
      name: "Composer message",
    }) as HTMLInputElement;

    // The empty -> non-empty flip is the one legitimate prompt-area render
    // (it enables the modifier-submit shortcut and escape-to-hide).
    fireEvent.change(input, { target: { value: "a" } });
    const areaRendersAfterFlip =
      mocks.useThreadCreationOptions.mock.calls.length;
    const bannerRendersAfterFlip = mocks.contextBannerRenders.mock.calls.length;
    const todoRendersAfterFlip = mocks.todoCardRenders.mock.calls.length;
    const queueRendersAfterFlip =
      mocks.queuedMessagesListRenders.mock.calls.length;

    const typed = "abcdefghijklmnopqrstu";
    for (let index = 2; index <= typed.length; index += 1) {
      fireEvent.change(input, { target: { value: typed.slice(0, index) } });
    }

    expect(input.value).toBe(typed);
    expect(screen.getByTestId("published-host-draft").textContent).toBe(typed);
    expect(mocks.useThreadCreationOptions.mock.calls.length).toBe(
      areaRendersAfterFlip,
    );
    expect(mocks.contextBannerRenders.mock.calls.length).toBe(
      bannerRendersAfterFlip,
    );
    expect(mocks.todoCardRenders.mock.calls.length).toBe(todoRendersAfterFlip);
    expect(mocks.queuedMessagesListRenders.mock.calls.length).toBe(
      queueRendersAfterFlip,
    );
  });

  it("submits the draft as typed, read at event time", async () => {
    renderPromptArea({ thread: makeThread(threadId) });
    typeIntoComposer("Ship it");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));
    });

    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessageMutateAsync.mock.calls[0]?.[0]).toMatchObject({
      input: [{ type: "text", text: "Ship it", mentions: [] }],
    });
    expect(
      getPromptDraftAccessor({
        kind: "thread",
        projectId: PROJECT_ID,
        threadId,
      }).getCurrent().text,
    ).toBe("");
  });

  it("keeps publishing the live bottom draft to plugin hooks while a pending interaction hides the composer", () => {
    const thread = makeThread(threadId);
    const accessor = getPromptDraftAccessor({
      kind: "thread",
      projectId: PROJECT_ID,
      threadId,
    });
    renderPromptArea({
      thread,
      pendingInteractions: [makePendingInteraction(threadId)],
    });
    expect(screen.getByTestId("pending-interaction")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Composer message" })).toBe(
      null,
    );
    expect(screen.getByTestId("published-host-draft").textContent).toBe("");
    const areaRendersBefore = mocks.useThreadCreationOptions.mock.calls.length;

    act(() => {
      accessor.setDraft({
        text: "typed elsewhere",
        mentions: [],
        attachments: [],
      });
    });

    expect(screen.getByTestId("published-host-draft").textContent).toBe(
      "typed elsewhere",
    );
    // Only the empty -> non-empty flip reaches the prompt area.
    expect(mocks.useThreadCreationOptions.mock.calls.length).toBe(
      areaRendersBefore + 1,
    );

    act(() => {
      accessor.setDraft({
        text: "typed elsewhere again",
        mentions: [],
        attachments: [],
      });
    });
    expect(screen.getByTestId("published-host-draft").textContent).toBe(
      "typed elsewhere again",
    );
    expect(mocks.useThreadCreationOptions.mock.calls.length).toBe(
      areaRendersBefore + 1,
    );
  });
});
