import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation, AutomationRun } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { AutomationDetailContent } from "./AutomationDetailView";

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
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
      scriptFile: "disk.sh",
      interpreter: "bash",
      timeoutMs: 30_000,
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "agent",
    createdByThreadId: "thr_8x",
    nextRunAt: 1_700_003_600_000,
    lastRunAt: 1_700_000_000_000,
    runCount: 3,
    lastRunStatus: "succeeded",
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run_1",
    automationId: "auto_watchdog",
    runMode: "script",
    threadId: null,
    status: "succeeded",
    trigger: "schedule",
    skipReason: null,
    error: null,
    output: "Disk at 92%",
    exitCode: 0,
    scheduledFor: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_300,
    ...overrides,
  };
}

const NOOP = () => {};

function renderContent(
  overrides: Partial<Parameters<typeof AutomationDetailContent>[0]>,
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AutomationDetailContent
        automation={overrides.automation ?? makeAutomation()}
        runs={overrides.runs ?? []}
        runsLoading={overrides.runsLoading ?? false}
        runsError={overrides.runsError ?? false}
        onPause={overrides.onPause ?? NOOP}
        onResume={overrides.onResume ?? NOOP}
        onDelete={overrides.onDelete ?? NOOP}
        onSave={overrides.onSave ?? (() => Promise.resolve())}
        savePending={overrides.savePending ?? false}
        actionsPending={overrides.actionsPending ?? false}
      />
    </MemoryRouter>,
  );
}

describe("AutomationDetailContent", () => {
  it("renders the loop name with the next-run line (no mode/status pills)", () => {
    const markup = renderContent({ automation: makeAutomation() });
    expect(markup).toContain("Disk space watchdog");
    expect(markup).toContain("Next run");
    expect(markup).not.toContain(">Script<");
    expect(markup).not.toContain(">API<");
  });

  it("renders the config summary with schedule, execution, and environment", () => {
    const markup = renderContent({ automation: makeAutomation() });
    expect(markup).toContain("America/New_York");
    // Script execution: interpreter · file · timeout.
    expect(markup).toContain("disk.sh");
    expect(markup).toContain("30s timeout");
    expect(markup).toContain("Personal workspace");
  });

  it("shows a readable permission label, not the raw mode", () => {
    const markup = renderContent({
      automation: makeAutomation({
        execution: {
          mode: "agent",
          prompt: "Summarize.",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "readonly",
        },
      }),
    });
    expect(markup).toContain("Read-only");
    expect(markup).not.toContain(">readonly<");
  });

  it("shows next run with inline Edit / Pause / Delete (no Run now, no overflow)", () => {
    const markup = renderContent({
      automation: makeAutomation({ enabled: true }),
    });
    expect(markup).toContain("Next run");
    expect(markup).toContain(">Edit<");
    expect(markup).toContain(">Pause<");
    expect(markup).toContain(">Delete<");
    // Run now is gone; there's no overflow menu and no "Active" label.
    expect(markup).not.toContain("Run now");
    expect(markup).not.toContain('aria-label="More loop actions"');
    expect(markup).not.toContain(">Active<");
  });

  it("swaps Pause for Resume when paused", () => {
    const paused = renderContent({
      automation: makeAutomation({ enabled: false }),
    });
    expect(paused).toContain(">Resume<");
    expect(paused).not.toContain(">Pause<");
    // The next-run line reads "Paused".
    expect(paused).toContain("Paused");
  });

  it("has no top-level View thread action (it lives per-run in the history)", () => {
    const markup = renderContent({
      automation: makeAutomation({ lastRunThreadId: "thr_latest" }),
    });
    // The header no longer carries a View thread button, even with a last run.
    expect(markup).not.toContain('aria-label="View thread"');
  });

  it("renders a succeeded script run with its captured output and exit code", () => {
    const markup = renderContent({
      runs: [makeRun()],
    });
    expect(markup).toContain("Succeeded");
    expect(markup).toContain("Disk at 92%");
    expect(markup).toContain("exit 0");
  });

  it("renders a failed run with its error output", () => {
    const markup = renderContent({
      runs: [
        makeRun({
          id: "run_fail",
          status: "failed",
          output: null,
          error: "df: /xyz: No such file or directory",
          exitCode: 1,
        }),
      ],
    });
    expect(markup).toContain("Failed");
    expect(markup).toContain("df: /xyz: No such file or directory");
    expect(markup).toContain("exit 1");
    expect(markup).toContain("text-destructive");
  });

  it("marks a silent succeeded script run", () => {
    const markup = renderContent({
      runs: [makeRun({ id: "run_silent", output: null })],
    });
    expect(markup).toContain("Succeeded · silent");
    expect(markup).toContain("silent gate");
  });

  it("links agent runs to their thread", () => {
    const markup = renderContent({
      automation: makeAutomation({
        execution: {
          mode: "agent",
          prompt: "Summarize merged PRs.",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "readonly",
        },
      }),
      runs: [
        makeRun({
          id: "run_agent",
          runMode: "agent",
          threadId: "thr_run",
          output: null,
          exitCode: null,
        }),
      ],
    });
    expect(markup).toContain('href="/threads/thr_run"');
    expect(markup).toContain("View thread");
  });

  it("shows a skip reason for skipped runs", () => {
    const markup = renderContent({
      runs: [
        makeRun({
          id: "run_skip",
          status: "skipped",
          output: null,
          exitCode: null,
          skipReason: "wakeAgent gate returned false",
        }),
      ],
    });
    expect(markup).toContain("Skipped");
    expect(markup).toContain("wakeAgent gate returned false");
  });

  it("shows the empty run-history state", () => {
    const markup = renderContent({ runs: [] });
    expect(markup).toContain("No runs yet.");
  });

  it("shows a loading run-history state", () => {
    const markup = renderContent({ runs: [], runsLoading: true });
    expect(markup).toContain("Loading...");
    expect(markup).not.toContain("No runs yet.");
  });

  it("shows a destructive run-history error state", () => {
    const markup = renderContent({ runs: [], runsError: true });
    expect(markup).toContain("Failed to load runs.");
    expect(markup).toContain("text-destructive");
  });
});
