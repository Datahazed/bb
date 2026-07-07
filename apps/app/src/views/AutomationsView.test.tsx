import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { Automation } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  AutomationsOverview,
  buildAutomationRowActions,
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
  onOpen: NOOP,
  onEdit: NOOP,
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
        onRetry={props.onRetry}
      />
    </MemoryRouter>,
  );
}

describe("AutomationsOverview", () => {
  it("leaves the page title to the app chrome", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).not.toContain(">Automations<");
  });

  it("lists personal (projectless) automations flat, enabled before paused", () => {
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
    // Enabled automations sort above paused ones.
    expect(markup.indexOf("Active one")).toBeLessThan(
      markup.indexOf("Paused one"),
    );
    // Hover-revealed direct action buttons (run/edit/delete). Pause/resume now
    // lives in the detail drawer, not on the row.
    expect(markup).toContain("Run now: Active one");
    expect(markup).not.toContain("Pause: Active one");
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
    // cadence (human-readable cron) on line two, and the failed last-run glyph
    expect(markup).toContain("Mon-Fri");
    expect(markup).toContain("Last run failed");
  });

  it("headers real projects but leaves personal automations flat", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(
          makeAutomation({
            id: "auto_personal",
            projectId: PERSONAL_PROJECT_ID,
          }),
          { id: PERSONAL_PROJECT_ID, name: "Personal" },
        ),
        makeEntry(makeAutomation({ id: "auto_app", projectId: "proj_app" }), {
          id: "proj_app",
          name: "App",
        }),
      ],
    });

    // Real projects get a folder header; personal stays headerless.
    expect(markup).toContain(">App<");
    expect(markup).not.toContain(">Personal<");
  });

  it("teaches create-via-prompt when there are no automations", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).toContain("Start from an example");
    expect(markup).toContain("CI failure triage");
  });

  it("shows a loading skeleton", () => {
    const markup = renderOverview({ entries: [], isLoading: true });
    expect(markup).toContain('aria-label="Loading automations"');
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toContain("Start from an example");
  });

  it("shows a recoverable error state with a retry", () => {
    const markup = renderOverview({
      entries: [],
      hasInitialLoadError: true,
      onRetry: () => {},
    });
    // Apostrophe is HTML-escaped in static markup, so match the stable fragment.
    expect(markup).toContain("load automations.");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
  });

  it("links each row name to its automation detail route", () => {
    const markup = renderOverview({
      entries: [
        makeEntry(makeAutomation({ id: "auto_link", projectId: "proj_app" })),
      ],
    });
    expect(markup).toContain('href="/tools/automations/proj_app/auto_link"');
  });

  it("renders direct per-row action buttons, no overflow menu", () => {
    const markup = renderOverview({
      entries: [makeEntry(makeAutomation({ name: "Watcher" }))],
    });
    expect(markup).toContain("Run now: Watcher");
    expect(markup).toContain("Edit: Watcher");
    expect(markup).toContain("Delete: Watcher");
    expect(markup).not.toContain("Watcher actions");
  });

  it("renders a single create button without a script option", () => {
    const markup = renderOverview({ entries: [] });
    expect(markup).toContain("New automation");
    expect(markup).not.toContain("Script automation");
    expect(markup).not.toContain("Agent automation");
  });
});

describe("buildAutomationRowActions", () => {
  const ACTIONS: AutomationRowActions = NOOP_ACTIONS;

  it("offers run, edit, and a destructive delete (pause/resume is in the drawer)", () => {
    const built = buildAutomationRowActions(
      makeEntry(makeAutomation({ enabled: true })),
      ACTIONS,
    );
    expect(built.map((action) => action.label)).toEqual([
      "Run now",
      "Edit",
      "Delete",
    ]);
    const deleteAction = built.find((action) => action.key === "delete");
    expect(deleteAction?.destructive).toBe(true);
  });

  it("routes each action to its handler", () => {
    const calls: string[] = [];
    const actions: AutomationRowActions = {
      onOpen: () => calls.push("open"),
      onEdit: () => calls.push("edit"),
      onRun: () => calls.push("run"),
      onDelete: () => calls.push("delete"),
    };
    const actionsList = buildAutomationRowActions(
      makeEntry(makeAutomation({ enabled: true })),
      actions,
    );
    for (const action of actionsList) {
      action.run();
    }
    expect(calls).toEqual(["run", "edit", "delete"]);
  });
});
