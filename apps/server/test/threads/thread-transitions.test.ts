import { describe, expect, it } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  migrate,
  noopNotifier,
} from "@bb/db";
import { tryTransition } from "../../src/services/threads/thread-transitions.js";
import { NotificationHub } from "../../src/ws/hub.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = { id: "local" };
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const hub = new NotificationHub();
  return { db, hub, project };
}

describe("tryTransition", () => {
  it("returns false for invalid transitions", () => {
    const { db, hub, project } = setup();
    const thread = createThread(db, hub, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });

    expect(tryTransition(db, hub, thread.id, "created")).toBe(false);
  });

  it("rethrows unexpected transition failures", () => {
    const { db, hub } = setup();

    expect(() => tryTransition(db, hub, "thr_missing", "active")).toThrow(
      Error,
    );
  });
});
