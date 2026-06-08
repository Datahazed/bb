import { createAutomation, createProject, getAutomation } from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  automationSchema,
  AUTOMATION_NAME_MAX_LENGTH,
  SCHEDULE_CRON_MAX_LENGTH,
  SCHEDULE_TIMEZONE_MAX_LENGTH,
} from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDailySchedule,
  createScheduleTrigger,
  createWeeklySchedule,
} from "../helpers/schedules.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

const weekdayMorningTrigger = createScheduleTrigger(
  createWeeklySchedule({
    times: ["08:00"],
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
  }),
);
const losAngelesWeekdayMorningTrigger = createScheduleTrigger(
  createWeeklySchedule({
    times: ["08:00"],
    timezone: "America/Los_Angeles",
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
  }),
);
const invalidTimezoneTrigger = createScheduleTrigger(
  createDailySchedule({
    times: ["08:00"],
    timezone: "Mars/Olympus",
  }),
);
const tooFrequentTrigger = createScheduleTrigger(
  createDailySchedule({
    times: ["08:00", "08:03"],
  }),
);
const invalidTimeTrigger = {
  cron: "0 8-9 * * *",
  timezone: "UTC",
  triggerType: "schedule",
};

describe("public automation routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00.000Z"));
  });

  it("supports automation CRUD", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const createResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Daily summary",
            trigger: losAngelesWeekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Summarize yesterday's work" }],
                environment: {
                  type: "host",
                  hostId: host.id,
                  workspace: {
                    type: "managed-worktree",
                    baseBranch: { kind: "default" },
                  },
                },
              },
            },
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const createdAutomation = automationSchema.parse(
        await readJson(createResponse),
      );
      expect(createdAutomation.enabled).toBe(true);
      expect(createdAutomation.isValid).toBe(true);
      expect(createdAutomation.validationIssues).toEqual([]);
      expect(createdAutomation.autoArchive).toBe(false);
      expect(createdAutomation.trigger).toEqual(
        losAngelesWeekdayMorningTrigger,
      );
      expect(createdAutomation.nextRunAt).toBeTypeOf("number");

      const listResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
      );
      expect(listResponse.status).toBe(200);
      expect(
        automationSchema.array().parse(await readJson(listResponse)),
      ).toEqual([
        expect.objectContaining({
          id: createdAutomation.id,
          name: "Daily summary",
        }),
      ]);

      const disableResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: false,
          }),
        },
      );
      expect(disableResponse.status).toBe(200);
      expect(
        automationSchema.parse(await readJson(disableResponse)),
      ).toMatchObject({
        id: createdAutomation.id,
        enabled: false,
        nextRunAt: null,
      });

      const enableResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: true,
          }),
        },
      );
      expect(enableResponse.status).toBe(200);
      expect(
        automationSchema.parse(await readJson(enableResponse)),
      ).toMatchObject({
        id: createdAutomation.id,
        enabled: true,
      });

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            autoArchive: true,
          }),
        },
      );
      expect(updateResponse.status).toBe(200);
      expect(
        automationSchema.parse(await readJson(updateResponse)),
      ).toMatchObject({
        id: createdAutomation.id,
        autoArchive: true,
      });

      const deleteResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("resolves and stores host affinity for personal automations", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);

      const createResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/automations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Personal daily summary",
            trigger: weekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Summarize personal work" }],
                environment: {
                  type: "host",
                  workspace: { type: "personal" },
                },
              },
            },
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const createdAutomation = automationSchema.parse(
        await readJson(createResponse),
      );
      expect(createdAutomation.action.threadRequest.environment).toMatchObject({
        type: "host",
        hostId: host.id,
        workspace: { type: "personal" },
      });
      const storedAutomation = getAutomation(harness.db, createdAutomation.id);
      if (!storedAutomation) {
        throw new Error("Expected stored personal automation");
      }
      expect(JSON.parse(storedAutomation.action)).toMatchObject({
        threadRequest: {
          environment: {
            hostId: host.id,
            workspace: { type: "personal" },
          },
        },
      });

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${PERSONAL_PROJECT_ID}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Run updated personal work" }],
                environment: {
                  type: "host",
                  workspace: { type: "personal" },
                },
              },
            },
          }),
        },
      );
      expect(updateResponse.status).toBe(200);
      expect(
        automationSchema.parse(await readJson(updateResponse)).action
          .threadRequest.environment,
      ).toMatchObject({
        type: "host",
        hostId: host.id,
        workspace: { type: "personal" },
      });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("rejects personal automation workspaces on standard projects", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-standard-personal-automation",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Invalid personal workspace",
            trigger: weekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Should fail" }],
                environment: {
                  type: "host",
                  workspace: { type: "personal" },
                },
              },
            },
          }),
        },
      );

      expect(response.status).toBe(400);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("rejects invalid schedule shapes, invalid timezones, and sub-5-minute schedules", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      for (const trigger of [
        invalidTimeTrigger,
        invalidTimezoneTrigger,
        tooFrequentTrigger,
      ] as const) {
        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/automations`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              name: "Invalid schedule",
              trigger,
              action: {
                actionType: "scheduled-thread",
                threadRequest: {
                  providerId: "codex",
                  model: "gpt-5",
                  input: [{ type: "text", text: "Run invalid schedule" }],
                  environment: {
                    type: "host",
                    hostId: host.id,
                    workspace: {
                      type: "managed-worktree",
                      baseBranch: { kind: "default" },
                    },
                  },
                },
              },
            }),
          },
        );
        expect(response.status).toBe(400);
      }
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("rejects mixed enable toggles and config edits in one PATCH request", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-automation-mixed-patch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const automation = createAutomation(harness.db, harness.hub, {
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Run mixed patch" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        }),
        autoArchive: false,
        enabled: false,
        name: "Mixed patch automation",
        nextRunAt: null,
        projectId: project.id,
        triggerConfig: JSON.stringify(weekdayMorningTrigger),
        triggerType: "schedule",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${automation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: true,
            autoArchive: true,
          }),
        },
      );

      expect(response.status).toBe(400);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("rejects overlong automation schedule fields at the API boundary", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-automation-max-length",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      for (const payload of [
        {
          name: "n".repeat(AUTOMATION_NAME_MAX_LENGTH + 1),
          trigger: weekdayMorningTrigger,
        },
        {
          name: "Valid name",
          trigger: createScheduleTrigger({
            cron: "0 ".repeat(SCHEDULE_CRON_MAX_LENGTH + 1).trim(),
            timezone: "UTC",
          }),
        },
        {
          name: "Valid name",
          trigger: createScheduleTrigger(
            createDailySchedule({
              times: ["08:00"],
              timezone: "T".repeat(SCHEDULE_TIMEZONE_MAX_LENGTH + 1),
            }),
          ),
        },
      ] as const) {
        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/automations`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              ...payload,
              action: {
                actionType: "scheduled-thread",
                threadRequest: {
                  providerId: "codex",
                  model: "gpt-5",
                  input: [
                    { type: "text", text: "Reject this invalid payload" },
                  ],
                  environment: {
                    type: "host",
                    hostId: host.id,
                    workspace: {
                      type: "managed-worktree",
                      baseBranch: { kind: "default" },
                    },
                  },
                },
              },
            }),
          },
        );
        expect(response.status).toBe(400);
      }
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("validates disabled automation schedules on create and config update", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const invalidCreateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Disabled invalid automation" }],
                environment: {
                  type: "host",
                  hostId: host.id,
                  workspace: {
                    type: "managed-worktree",
                    baseBranch: { kind: "default" },
                  },
                },
              },
            },
            enabled: false,
            name: "Disabled invalid automation",
            trigger: tooFrequentTrigger,
          }),
        },
      );

      expect(invalidCreateResponse.status).toBe(400);

      const automation = createAutomation(harness.db, harness.hub, {
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Stay disabled" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        }),
        autoArchive: false,
        enabled: false,
        name: "Disabled automation",
        nextRunAt: null,
        projectId: project.id,
        triggerConfig: JSON.stringify(weekdayMorningTrigger),
        triggerType: "schedule",
      });

      const invalidUpdateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${automation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            trigger: tooFrequentTrigger,
          }),
        },
      );

      expect(invalidUpdateResponse.status).toBe(400);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("rejects automation actions that reference foreign project environments or hosts", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host: primaryHost } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: primaryHost.id,
      });
      // A different project's environment on the same (single) host: the
      // cross-project reuse rejection is independent of host topology.
      const foreignProject = createProject(harness.db, harness.hub, {
        name: "Foreign Automation Project",
        source: {
          type: "local_path",
          hostId: primaryHost.id,
          path: "/tmp/automation-foreign-project",
        },
      }).project;
      const foreignEnvironment = seedEnvironment(harness.deps, {
        hostId: primaryHost.id,
        projectId: foreignProject.id,
        path: "/tmp/automation-foreign-environment",
      });

      const reuseResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Foreign reuse environment",
            trigger: weekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Should be rejected" }],
                environment: {
                  type: "reuse",
                  environmentId: foreignEnvironment.id,
                },
              },
            },
          }),
        },
      );
      expect(reuseResponse.status).toBe(409);

      const hostResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Foreign host",
            trigger: weekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Should also be rejected" }],
                environment: {
                  type: "host",
                  // Non-local host ids are unknown in single-host mode.
                  hostId: "host-automation-project-scope-foreign",
                  workspace: {
                    type: "managed-worktree",
                    baseBranch: { kind: "default" },
                  },
                },
              },
            },
          }),
        },
      );
      expect(hostResponse.status).toBe(404);

      const createResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Scoped automation",
            trigger: weekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [
                  { type: "text", text: "Create a valid automation first" },
                ],
                environment: {
                  type: "host",
                  hostId: primaryHost.id,
                  workspace: {
                    type: "managed-worktree",
                    baseBranch: { kind: "default" },
                  },
                },
              },
            },
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const createdAutomation = automationSchema.parse(
        await readJson(createResponse),
      );

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [
                  { type: "text", text: "Cross project update should fail" },
                ],
                environment: {
                  type: "reuse",
                  environmentId: foreignEnvironment.id,
                },
              },
            },
          }),
        },
      );
      expect(updateResponse.status).toBe(409);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("allows unmanaged host automations with an explicit path on a host without a project source", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host: explicitPathHost } = seedHostSession(harness.deps);
      // Foreign-pinned source: the local host has no configured project
      // source, but an explicit unmanaged path must still work.
      const { project } = createProject(harness.db, harness.hub, {
        name: "Unmanaged Automation Project",
        source: {
          type: "local_path",
          hostId: "host-automation-unmanaged-default",
          path: "/tmp/automation-unmanaged-default-source",
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Explicit unmanaged host automation",
            trigger: weekdayMorningTrigger,
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [
                  { type: "text", text: "Use the explicit unmanaged path" },
                ],
                environment: {
                  type: "host",
                  hostId: explicitPathHost.id,
                  workspace: {
                    type: "unmanaged",
                    path: "/tmp/explicit-automation-workspace",
                  },
                },
              },
            },
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(automationSchema.parse(await readJson(response))).toMatchObject({
        action: {
          actionType: "scheduled-thread",
          threadRequest: {
            environment: {
              hostId: explicitPathHost.id,
              type: "host",
              workspace: {
                path: "/tmp/explicit-automation-workspace",
                type: "unmanaged",
              },
            },
          },
        },
      });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("enables invalid stored automations without failing and leaves them inert", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const automation = createAutomation(harness.db, harness.hub, {
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Enable invalid automation" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        }),
        autoArchive: false,
        enabled: false,
        name: "Invalid disabled automation",
        nextRunAt: null,
        projectId: project.id,
        triggerConfig: JSON.stringify(tooFrequentTrigger),
        triggerType: "schedule",
      });

      const enableResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${automation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: true,
          }),
        },
      );

      expect(enableResponse.status).toBe(200);
      expect(
        automationSchema.parse(await readJson(enableResponse)),
      ).toMatchObject({
        enabled: true,
        id: automation.id,
        isValid: false,
        nextRunAt: null,
        validationIssues: [
          "Schedule must not run more frequently than every 5 minutes",
        ],
      });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("reschedules enabled invalid automations when a config edit makes them valid", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-automation-revalidate-on-patch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const automation = createAutomation(harness.db, harness.hub, {
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Repair me" }],
            environment: {
              type: "reuse",
              environmentId: "env_missing",
            },
          },
        }),
        autoArchive: false,
        enabled: true,
        name: "Enabled invalid automation",
        nextRunAt: null,
        projectId: project.id,
        triggerConfig: JSON.stringify(weekdayMorningTrigger),
        triggerType: "schedule",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/automation-revalidate-on-patch",
      });

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${automation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Repair me" }],
                environment: {
                  type: "reuse",
                  environmentId: environment.id,
                },
              },
            },
          }),
        },
      );

      expect(updateResponse.status).toBe(200);
      expect(
        automationSchema.parse(await readJson(updateResponse)),
      ).toMatchObject({
        enabled: true,
        id: automation.id,
        isValid: true,
        nextRunAt: expect.any(Number),
        validationIssues: [],
      });
      expect(getAutomation(harness.db, automation.id)).toMatchObject({
        enabled: true,
        nextRunAt: expect.any(Number),
      });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("skips malformed stored automations while listing valid ones", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-automation-list-malformed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const validAutomation = createAutomation(harness.db, harness.hub, {
        projectId: project.id,
        name: "Valid automation",
        enabled: true,
        triggerType: "schedule",
        triggerConfig: JSON.stringify(weekdayMorningTrigger),
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Run the valid automation" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        }),
        autoArchive: false,
        nextRunAt: Date.now() + 60_000,
      });
      createAutomation(harness.db, harness.hub, {
        projectId: project.id,
        name: "Malformed automation",
        enabled: true,
        triggerType: "schedule",
        triggerConfig: "{",
        action: "{",
        autoArchive: false,
        nextRunAt: Date.now() + 120_000,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
      );

      expect(response.status).toBe(200);
      expect(automationSchema.array().parse(await readJson(response))).toEqual([
        expect.objectContaining({
          id: validAutomation.id,
          name: "Valid automation",
        }),
      ]);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });
});
