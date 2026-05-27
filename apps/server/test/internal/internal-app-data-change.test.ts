import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("internal app-data change route", () => {
  it("broadcasts daemon-reported app data changes for session-owned threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-app-data-change",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/app-data-change",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const notifyThreadAppDataSpy = vi.spyOn(
        harness.hub,
        "notifyThreadAppData",
      );

      const response = await harness.app.request(
        "/internal/session/app-data-change",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: thread.id,
            appId: "status",
            path: "state.json",
            value: { workers: [] },
            deleted: false,
            version: "version-next",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(notifyThreadAppDataSpy).toHaveBeenCalledWith({
        type: "app-data.changed",
        threadId: thread.id,
        appId: "status",
        path: "state.json",
        value: { workers: [] },
        deleted: false,
        version: "version-next",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects daemon-reported app data changes for threads owned by another host", async () => {
    const harness = await createTestAppHarness();
    try {
      const hostA = seedHostSession(harness.deps, {
        id: "host-app-data-change-a",
      });
      const hostB = seedHostSession(harness.deps, {
        id: "host-app-data-change-b",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: hostB.host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: hostB.host.id,
        projectId: project.id,
        path: "/tmp/app-data-change-other",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const notifyThreadAppDataSpy = vi.spyOn(
        harness.hub,
        "notifyThreadAppData",
      );

      const response = await harness.app.request(
        "/internal/session/app-data-change",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: hostA.session.id,
            threadId: thread.id,
            appId: "status",
            path: "state.json",
            value: null,
            deleted: true,
            version: null,
          }),
        },
      );

      expect(response.status).toBe(403);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(notifyThreadAppDataSpy).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("broadcasts daemon-requested app data resync hints", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-app-data-resync",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/app-data-resync",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const notifyThreadAppDataSpy = vi.spyOn(
        harness.hub,
        "notifyThreadAppData",
      );

      const response = await harness.app.request(
        "/internal/session/app-data-resync",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: thread.id,
            appId: "status",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(notifyThreadAppDataSpy).toHaveBeenCalledWith({
        type: "app-data.resync",
        threadId: thread.id,
        appId: "status",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
