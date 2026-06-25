// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { PERSONAL_PROJECT_ID, type PermissionMode } from "@bb/domain";
import type {
  Automation,
  SystemExecutionOptionsResponse,
  UpdateAutomationRequest,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AutomationDetailContent } from "./AutomationDetailView";

vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  PromptBoxInternal: ({
    attachments,
    footerStart,
    onChange,
    onSubmit,
    value,
  }: {
    attachments: {
      onAttachFiles?: (files: File[]) => void | Promise<void>;
    };
    footerStart: ReactNode;
    onChange: (value: string, mentions: []) => void;
    onSubmit: () => void;
    value: string;
  }) => (
    <div>
      <textarea
        aria-label="Prompt"
        value={value}
        onChange={(event) => onChange(event.target.value, [])}
      />
      <div>{footerStart}</div>
      <button
        type="button"
        onClick={() =>
          void attachments.onAttachFiles?.([
            new File(["notes"], "notes.md", { type: "text/markdown" }),
          ])
        }
      >
        Attach
      </button>
      <button type="button" onClick={onSubmit}>
        Prompt box save
      </button>
    </div>
  ),
}));

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: ({
    model,
    provider,
  }: {
    model: {
      moreOptions: readonly { label: string; value: string }[];
      onChange: (value: string) => void;
      options: readonly { label: string; value: string }[];
      selected: string;
    };
    provider: {
      onChange?: (value: string) => void;
      options?: readonly { label: string; value: string }[];
      selectedId?: string;
    };
  }) => (
    <div>
      <select
        aria-label="Provider"
        value={provider.selectedId ?? ""}
        onChange={(event) => provider.onChange?.(event.target.value)}
      >
        {(provider.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Model"
        value={model.selected}
        onChange={(event) => model.onChange(event.target.value)}
      >
        {[...model.options, ...model.moreOptions].map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock("@/components/pickers/PermissionModePicker", () => ({
  PermissionModePicker: ({
    onChange,
    options,
    value,
  }: {
    onChange: (value: PermissionMode) => void;
    options: readonly { label: string; value: PermissionMode }[];
    value?: PermissionMode;
  }) => (
    <select
      aria-label="Permission mode"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value as PermissionMode)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSystemExecutionOptions: vi.fn(),
    uploadPromptAttachment: vi.fn(),
  };
});

function agentAutomation(): Automation {
  return {
    id: "auto_watchdog",
    projectId: PERSONAL_PROJECT_ID,
    name: "Daily summary",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * *",
      timezone: "America/New_York",
    },
    execution: {
      mode: "agent",
      prompt: "Summarize yesterday.",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "agent",
    createdByThreadId: null,
    nextRunAt: 1_700_003_600_000,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
  };
}

function executionOptionsResponse(
  providerId?: string,
): SystemExecutionOptionsResponse {
  const isClaude = providerId === "claude-code";
  return {
    providers: [
      {
        id: "codex",
        displayName: "Codex",
        available: true,
        composerActions: [{ kind: "skills", trigger: "/" }],
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: false,
          supportsUserQuestion: true,
          supportsFork: true,
          supportedPermissionModes: ["readonly", "workspace-write", "full"],
        },
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        available: true,
        composerActions: [{ kind: "skills", trigger: "/" }],
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: false,
          supportsUserQuestion: true,
          supportsFork: true,
          supportedPermissionModes: ["readonly", "workspace-write", "full"],
        },
      },
    ],
    models: isClaude
      ? [
          {
            id: "claude-sonnet",
            model: "claude-sonnet",
            displayName: "Claude Sonnet",
            description: "",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
          {
            id: "claude-opus",
            model: "claude-opus",
            displayName: "Claude Opus",
            description: "",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ]
      : [
          {
            id: "gpt-5",
            model: "gpt-5",
            displayName: "GPT-5",
            description: "",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
    selectedOnlyModels: [],
    modelLoadError: null,
  };
}

function renderDetail(
  automation: Automation,
  onSave: (patch: UpdateAutomationRequest) => Promise<void>,
) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <AutomationDetailContent
        automation={automation}
        runs={[]}
        runsLoading={false}
        runsError={false}
        onPause={() => {}}
        onResume={() => {}}
        onDelete={() => {}}
        onSave={onSave}
        savePending={false}
        actionsPending={false}
      />
    </MemoryRouter>,
    { wrapper },
  );
}

beforeEach(() => {
  vi.mocked(api.getSystemExecutionOptions).mockImplementation(({ providerId }) =>
    Promise.resolve(executionOptionsResponse(providerId)),
  );
  vi.mocked(api.uploadPromptAttachment).mockResolvedValue({
    type: "localFile",
    path: "uploads/notes.md",
    name: "notes.md",
    mimeType: "text/markdown",
    sizeBytes: 5,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("AutomationDetailContent agent editing", () => {
  it("saves the edited prompt, provider, model, and permission", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDetail(agentAutomation(), onSave);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const prompt = (await screen.findByLabelText(
      "Prompt",
    )) as HTMLTextAreaElement;
    expect(prompt.value).toBe("Summarize yesterday.");

    fireEvent.change(prompt, {
      target: { value: "Summarize yesterday and flag blockers." },
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "claude-code" },
    });
    await waitFor(() => {
      expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe(
        "claude-sonnet",
      );
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "claude-opus" },
    });
    fireEvent.change(screen.getByLabelText("Permission mode"), {
      target: { value: "workspace-write" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]![0]).toEqual({
      name: "Daily summary",
      trigger: {
        triggerType: "schedule",
        cron: "0 9 * * *",
        timezone: "America/New_York",
      },
      autoArchive: false,
      execution: {
        mode: "agent",
        prompt: "Summarize yesterday and flag blockers.",
        providerId: "claude-code",
        model: "claude-opus",
        permissionMode: "workspace-write",
      },
    });
  });
});
