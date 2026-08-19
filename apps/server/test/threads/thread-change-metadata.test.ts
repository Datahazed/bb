import { pinThread, updateThread } from "@bb/db";
import {
  changedMessageLenientSchema,
  type ThreadListEntry,
} from "@bb/domain";
import { sidebarBootstrapResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function lastThreadMessageMetadata(messages: string[]) {
  const last = messages.at(-1);
  if (last === undefined) {
    throw new Error("Expected a broadcast message");
  }
  const parsed = changedMessageLenientSchema.parse(JSON.parse(last));
  if (parsed.entity !== "thread") {
    throw new Error(`Expected a thread message, got ${parsed.entity}`);
  }
  return { changes: parsed.changes, metadata: parsed.metadata };
}

async function readSidebarRow(
  harness: TestAppHarness,
  threadId: string,
): Promise<ThreadListEntry> {
  const response = await harness.app.request("/api/v1/sidebar-bootstrap");
  const bootstrap = sidebarBootstrapResponseSchema.parse(
    await readJson(response),
  );
  const row = [
    ...bootstrap.projects.flatMap((project) => project.threads),
    ...bootstrap.personalProject.threads,
  ].find((thread) => thread.id === threadId);
  if (!row) {
    throw new Error(`Thread ${threadId} missing from sidebar bootstrap`);
  }
  return row;
}

describe("thread change metadata enrichment", () => {
  it("attaches the sidebar row to row-only changes for subscribed clients", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
        title: "Before",
      });
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      harness.hub.notifyThread(thread.id, ["status-changed"]);
      const statusChange = lastThreadMessageMetadata(socket.messages);
      expect(statusChange.changes).toEqual(["status-changed"]);
      // The attached row is exactly what a bootstrap refetch would return.
      expect(statusChange.metadata?.listEntry).toEqual(
        await readSidebarRow(harness, thread.id),
      );
      expect(statusChange.metadata?.listEntry?.status).toBe("active");

      updateThread(harness.db, harness.hub, thread.id, { title: "After" });
      const titleChange = lastThreadMessageMetadata(socket.messages);
      expect(titleChange.changes).toEqual(["title-changed"]);
      expect(titleChange.metadata).toMatchObject({
        projectId: project.id,
        listEntry: { id: thread.id, title: "After" },
      });

      pinThread(harness.db, harness.hub, { threadId: thread.id });
      const pinChange = lastThreadMessageMetadata(socket.messages);
      expect(pinChange.changes).toEqual(["pin-state-changed"]);
      expect(pinChange.metadata?.listEntry?.pinnedAt).toEqual(
        expect.any(Number),
      );
      expect(pinChange.metadata?.listEntry?.pinSortKey).toEqual(
        expect.any(String),
      );
    });
  });

  it("leaves membership changes and plain event batches without a row", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });
      const thread = seedThread(harness.deps, { projectId: project.id });

      const created = lastThreadMessageMetadata(socket.messages);
      expect(created.changes).toContain("thread-created");
      expect(created.metadata?.listEntry).toBeUndefined();

      harness.hub.notifyThread(thread.id, ["events-appended"], {
        eventTypes: ["item/agentMessage/delta"],
      });
      const appended = lastThreadMessageMetadata(socket.messages);
      expect(appended.metadata?.listEntry).toBeUndefined();

      harness.hub.notifyThread(thread.id, ["events-appended"], {
        backgroundActivityChanged: true,
        eventTypes: ["item/backgroundTask/progress"],
      });
      const activity = lastThreadMessageMetadata(socket.messages);
      expect(activity.metadata?.listEntry?.id).toBe(thread.id);
      expect(activity.metadata?.backgroundActivityChanged).toBe(true);
    });
  });

  it("sends the original metadata when the thread no longer exists", async () => {
    await withTestHarness(async (harness) => {
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      harness.hub.notifyThread("thr_missing", ["status-changed"], {
        projectId: "project-1",
      });

      expect(lastThreadMessageMetadata(socket.messages).metadata).toEqual({
        projectId: "project-1",
      });
    });
  });
});
