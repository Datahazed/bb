import { createQueuedThreadMessage, getThread } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { buildExecutionOptions } from "./thread-commands.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import {
  ensureThreadIsNotAwaitingUserInteraction,
  ensureThreadIsWritable,
  sendThreadMessage,
} from "./thread-send.js";

export interface SendPluginSystemMessageArgs {
  systemMessageKind: "workflow-finished";
  text: string;
  threadId: string;
}

/** Trusted plugin-only entry point; public thread routes cannot set provenance. */
export async function sendPluginSystemMessage(
  deps: AppDeps,
  args: SendPluginSystemMessageArgs,
): Promise<void> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread) {
    throw new ApiError(404, "not_found", "Thread not found");
  }
  ensureThreadIsWritable(thread);
  ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
  const input = [{ type: "text" as const, text: args.text, mentions: [] }];

  if (thread.status === "active") {
    const execution = await buildExecutionOptions(
      deps,
      {},
      { threadId: thread.id },
      "client/turn/requested",
    );
    createQueuedThreadMessage(deps.db, deps.hub, {
      threadId: thread.id,
      content: input,
      senderThreadId: null,
      systemMessageKind: args.systemMessageKind,
      model: execution.model,
      reasoningLevel: execution.reasoningLevel,
      permissionMode: execution.permissionMode,
      serviceTier: execution.serviceTier,
    });
    return;
  }

  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload: {
      input,
      mode: "queue-if-active",
    },
    systemMessageKind: args.systemMessageKind,
    thread,
    trigger: "auto-dispatch",
  });
}
