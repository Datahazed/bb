import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import {
  freezeThreadAgentInstructions,
  getThreadAgentInstructions,
} from "../../src/data/thread-agent-instructions.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread, deleteThread } from "../../src/data/threads.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "instruction-test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "instruction-test-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/instruction-test",
    },
  });
  const firstThread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  const secondThread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  const thirdThread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  return { db, firstThread, secondThread, thirdThread };
}

describe("thread agent instructions", () => {
  it("keeps the first thread value and deduplicates identical snapshots", () => {
    const { db, firstThread, secondThread, thirdThread } = setup();

    expect(
      freezeThreadAgentInstructions(db, {
        threadId: firstThread.id,
        instructions: "shared instructions",
      }),
    ).toBe("shared instructions");
    expect(
      freezeThreadAgentInstructions(db, {
        threadId: firstThread.id,
        instructions: "changed instructions",
      }),
    ).toBe("shared instructions");
    expect(
      freezeThreadAgentInstructions(db, {
        threadId: secondThread.id,
        instructions: "shared instructions",
      }),
    ).toBe("shared instructions");
    expect(
      freezeThreadAgentInstructions(db, {
        threadId: thirdThread.id,
        instructions: "unique instructions",
      }),
    ).toBe("unique instructions");

    expect(getThreadAgentInstructions(db, firstThread.id)).toBe(
      "shared instructions",
    );
    expect(getThreadAgentInstructions(db, secondThread.id)).toBe(
      "shared instructions",
    );
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM agent_instruction_snapshots",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM thread_agent_instructions",
        )
        .get(),
    ).toEqual({ count: 3 });

    expect(deleteThread(db, noopNotifier, firstThread.id)).toBe(true);
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM agent_instruction_snapshots",
        )
        .get(),
    ).toEqual({ count: 2 });

    expect(deleteThread(db, noopNotifier, secondThread.id)).toBe(true);
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM agent_instruction_snapshots",
        )
        .get(),
    ).toEqual({ count: 1 });

    expect(deleteThread(db, noopNotifier, thirdThread.id)).toBe(true);
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM agent_instruction_snapshots",
        )
        .get(),
    ).toEqual({ count: 0 });

    db.$client.close();
  });
});
