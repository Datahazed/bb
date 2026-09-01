import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  createAutomation,
  createManualRun,
  listAutomationRuns,
  migrations,
  setAutomationRunThread,
} from "./data.js";
import { reconcileRunningAutomationRuns } from "./run.js";

describe("startup reconciliation markers", () => {
  it("marks a successful run that startup reconciliation inferred from an idle thread", async () => {
    const db = new Database(":memory:");
    for (const migration of migrations) db.exec(migration);
    const automation = createAutomation(db, {
      id: "auto_reconciled_idle",
      projectId: "proj_test",
      name: "Reconciled idle run",
      enabled: true,
      trigger: {
        triggerType: "schedule",
        cron: "* * * * *",
        timezone: "UTC",
      },
      runMode: "agent",
      execution: {
        mode: "agent",
        prompt: "test",
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "accept-edits",
        environment: { type: "project-default" },
      },
      origin: "human",
      createdByThreadId: null,
      nextRunAt: 1,
    });
    const run = createManualRun(db, {
      automationId: automation.id,
      runMode: "agent",
      now: 1,
    }).run;
    setAutomationRunThread(db, {
      runId: run.id,
      threadId: "thr_idle",
    });
    const bb = {
      sdk: {
        threads: {
          get: async () => ({
            id: "thr_idle",
            status: "idle",
            deletedAt: null,
            archivedAt: null,
          }),
          send: async () => undefined,
          spawn: async () => undefined,
        },
      },
      realtime: { publish: () => undefined },
      log: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
    };

    await reconcileRunningAutomationRuns(bb, db);

    expect(
      listAutomationRuns(db, { automationId: automation.id, limit: 1 })[0],
    ).toMatchObject({
      status: "succeeded",
      skipReason:
        "interrupted: the server restarted before the agent run was observed to finish",
    });
  });
});
