import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  AutomationsOverview,
  buildAutomationRowMenuItems,
  type AutomationRowActions,
  type AutomationsOverviewProps,
} from "./AutomationsView";

interface AutomationOverviewEntry {
  automation: Automation;
  project: { id: string; name: string };
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto_demo",
    projectId: PERSONAL_PROJECT_ID,
    name: "Daily standup digest",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
    },
    execution: {
      mode: "agent",
      prompt: "Summarize merged PRs.",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
    },
    environment: { type: "host", workspace: { type: "personal" } },
    autoArchive: false,
    origin: "human",
    createdByThreadId: null,
    nextRunAt: 1_700_003_600_000,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function makeEntry(
  automation: Automation,
  project: { id: string; name: string } = {
    id: PERSONAL_PROJECT_ID,
    name: "Personal",
  },
): AutomationOverviewEntry {
  return { automation, project };
}

const NOOP = () => {};

const NOOP_ACTIONS: AutomationRowActions = {
  onPause: NOOP,
  onResume: NOOP,
  onRun: NOOP,
  onDelete: NOOP,
};

function renderOverview(
  props: Partial<AutomationsOverviewProps> & {
    entries: readonly AutomationOverviewEntry[];
  },
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AutomationsOverview
        entries={props.entries}
        isLoading={props.isLoading ?? false}
        hasInitialLoadError={props.hasInitialLoadError ?? false}
        actions={props.actions ?? NOOP_ACTIONS}
        onCreateAutomation={props.onCreateAutomation ?? NOOP}
      />
    </MemoryRouter>,
  );
}


describe("AutomationsOverview", () => {
  it("leaves the page title to the app chrome", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).not.toContain(">Automations<");
  });

  it("lists personal (projectless) loops flat, enabled before paused", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(
          makeAutomation({
            id: "auto_paused",
            name: "Paused one",
            enabled: false,
            nextRunAt: null,
          }),
        ),
        makeEntry(makeAutomation({ id: "auto_active", name: "Active one" })),
      ],
    });

    // Personal == projectless: no folder header, just a flat list.
    expect(markup).not.toContain(">Personal<");
    expect(markup).toContain("Active one");
    expect(markup).toContain("Paused one");
    // Enabled loops sort above paused ones.
    expect(markup.indexOf("Active one")).toBeLessThan(
      markup.indexOf("Paused one"),
    );
    // Enabled loops render the next-run label; paused ones read "Paused".
    expect(markup).toContain("Next ");
    expect(markup).toContain("Paused");
  });

  it("renders cadence and last-run health on the row, not mode/origin badges", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(
          makeAutomation({
            origin: "agent",
            lastRunAt: 1_700_000_000_000,
            lastRunStatus: "failed",
            execution: {
              mode: "script",
              scriptFile: "watchdog.sh",
              interpreter: "bash",
              timeoutMs: 30_000,
            },
          }),
        ),
      ],
    });
    // mode/origin are no longer surfaced as row badges
    expect(markup).not.toContain(">API<");
    expect(markup).not.toContain(">Script<");
    // cadence (human-readable cron) and last-run health are shown instead
    expect(markup).toContain("Failed");
  });

  it("headers real projects but leaves personal loops flat", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(
          makeAutomation({ id: "auto_personal", projectId: PERSONAL_PROJECT_ID }),
          { id: PERSONAL_PROJECT_ID, name: "Personal" },
        ),
        makeEntry(
          makeAutomation({ id: "auto_app", projectId: "proj_app" }),
          { id: "proj_app", name: "App" },
        ),
      ],
    });

    // Real projects get a folder header; personal stays headerless.
    expect(markup).toContain(">App<");
    expect(markup).not.toContain(">Personal<");
  });

  it("shows the empty state when there are no automations", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).toContain("No loops yet.");
  });

  it("shows a muted loading state", () => {
    const markup = renderOverview({ entries: [], isLoading: true });
    expect(markup).toContain("Loading...");
    expect(markup).not.toContain("No loops yet.");
  });

  it("shows a destructive error state", () => {
    const markup = renderOverview({
      entries: [],
      hasInitialLoadError: true,
    });
    expect(markup).toContain("Failed to load loops.");
    expect(markup).toContain("text-destructive");
  });

  it("links each row name to its automation detail route", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(makeAutomation({ id: "auto_link", projectId: "proj_app" })),
      ],
    });
    expect(markup).toContain('href="/automations/proj_app/auto_link"');
  });

  it("renders a per-row actions trigger", () => {
    const markup = renderOverview({
      entries: [makeEntry(makeAutomation({ name: "Watcher" }))],
    });
    expect(markup).toContain("Watcher actions");
  });

  it("renders a single create button without a script option", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).toContain("New loop");
    expect(markup).not.toContain("Script automation");
    expect(markup).not.toContain("Agent automation");
  });
});

describe("buildAutomationRowMenuItems", () => {
  const ACTIONS: AutomationRowActions = NOOP_ACTIONS;

  it("offers Pause for an enabled automation", () => {
    const items = buildAutomationRowMenuItems(
      makeEntry(makeAutomation({ enabled: true })),
      ACTIONS,
    );
    const labels = items.map((item) => item.label);
    expect(labels).toContain("Pause");
    expect(labels).not.toContain("Resume");
  });

  it("offers Resume for a paused automation", () => {
    const items = buildAutomationRowMenuItems(
      makeEntry(makeAutomation({ enabled: false })),
      ACTIONS,
    );
    const labels = items.map((item) => item.label);
    expect(labels).toContain("Resume");
    expect(labels).not.toContain("Pause");
  });

  it("always offers Run now and a destructive Delete", () => {
    const items = buildAutomationRowMenuItems(makeEntry(makeAutomation()), ACTIONS);
    const labels = items.map((item) => item.label);
    expect(labels).toContain("Run now");
    const deleteItem = items.find((item) => item.key === "delete");
    expect(deleteItem?.label).toBe("Delete");
    expect(deleteItem?.destructive).toBe(true);
  });

  it("routes each item to its action handler", () => {
    const calls: string[] = [];
    const actions: AutomationRowActions = {
      onPause: () => calls.push("pause"),
      onResume: () => calls.push("resume"),
      onRun: () => calls.push("run"),
      onDelete: () => calls.push("delete"),
    };
    const items = buildAutomationRowMenuItems(
      makeEntry(makeAutomation({ enabled: true })),
      actions,
    );
    for (const item of items) {
      item.run();
    }
    expect(calls).toEqual(["pause", "run", "delete"]);
  });
});
