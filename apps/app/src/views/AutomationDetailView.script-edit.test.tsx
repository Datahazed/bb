// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation, UpdateAutomationRequest } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationDetailContent } from "./AutomationDetailView";

afterEach(cleanup);

function scriptAutomation(
  execOverrides: Partial<
    Extract<Automation["execution"], { mode: "script" }>
  > = {},
): Automation {
  return {
    id: "auto_watchdog",
    projectId: PERSONAL_PROJECT_ID,
    name: "Disk space watchdog",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "*/15 * * * *",
      timezone: "America/New_York",
    },
    execution: {
      mode: "script",
      scriptFile: "script.sh",
      script: "echo old\n",
      interpreter: "bash",
      timeoutMs: 30_000,
      env: { FOO: "bar" },
      ...execOverrides,
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

function renderDetail(
  automation: Automation,
  onSave: (patch: UpdateAutomationRequest) => Promise<void>,
) {
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
  );
}

describe("AutomationDetailContent script editing", () => {
  it("pre-fills the script and saves the edited script, interpreter, and timeout", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDetail(scriptAutomation(), onSave);

    fireEvent.pointerDown(screen.getByRole("button", { name: /actions/ }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

    const textarea = screen.getByLabelText("Script") as HTMLTextAreaElement;
    expect(textarea.value).toBe("echo old\n");
    // The old "delete and recreate" message is gone.
    expect(screen.queryByText(/delete and recreate/i)).toBeNull();

    fireEvent.change(textarea, { target: { value: "echo new\nexit 0\n" } });
    fireEvent.change(screen.getByLabelText("Interpreter"), {
      target: { value: "python3" },
    });
    fireEvent.change(screen.getByLabelText("Timeout (seconds)"), {
      target: { value: "60" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0]![0] as UpdateAutomationRequest;
    expect(patch.execution).toEqual({
      mode: "script",
      script: "echo new\nexit 0\n",
      interpreter: "python3",
      timeoutMs: 60_000,
      // env isn't editable here, so it carries through untouched.
      env: { FOO: "bar" },
    });
    expect(patch.name).toBe("Disk space watchdog");
    expect(patch.trigger).toEqual({
      triggerType: "schedule",
      cron: "*/15 * * * *",
      timezone: "America/New_York",
    });
  });

  it("disables Save when the script is cleared", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDetail(scriptAutomation(), onSave);

    fireEvent.pointerDown(screen.getByRole("button", { name: /actions/ }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Script"), {
      target: { value: "   " },
    });

    const save = screen.getByRole("button", {
      name: "Save changes",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });
});
