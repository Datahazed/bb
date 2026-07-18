import { appendStoredThreadEvent, upsertCollaborator } from "@bb/db";
import { threadScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { prepareTurnSubmitCommandPayload } from "../../../src/services/threads/thread-commands.js";
import { textInput } from "../../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const execution = {
  model: "gpt-5",
  permissionMode: "full",
  reasoningLevel: "medium",
  serviceTier: "default",
  source: "client/turn/requested",
} as const;

describe("thread turn speakers", () => {
  it("adds a speaker only once a different human has acted in the thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-speaker",
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      upsertCollaborator(
        harness.db,
        { displayName: "Alice", handle: "alice", imageUrl: null },
        1,
      );
      upsertCollaborator(
        harness.db,
        { displayName: "Bob", handle: "bob", imageUrl: null },
        1,
      );
      appendStoredThreadEvent(harness.db, harness.hub, {
        actorHandle: "alice",
        data: { reason: "manual-stop" },
        scope: threadScope(),
        threadId: thread.id,
        type: "system/thread/interrupted",
      });

      const singleHuman = await prepareTurnSubmitCommandPayload(harness.deps, {
        actorHandle: "alice",
        environment,
        execution,
        input: textInput("same speaker"),
        permissionEscalation: "deny",
        providerThreadId: "provider-thread-speaker",
        target: { mode: "start" },
        thread,
      });
      expect(singleHuman).not.toHaveProperty("speaker");

      const multiplayer = await prepareTurnSubmitCommandPayload(harness.deps, {
        actorHandle: "bob",
        environment,
        execution,
        input: textInput("new speaker"),
        permissionEscalation: "deny",
        providerThreadId: "provider-thread-speaker",
        target: { mode: "start" },
        thread,
      });
      expect(multiplayer.speaker).toEqual({
        displayName: "Bob",
        handle: "bob",
      });
    });
  });
});
