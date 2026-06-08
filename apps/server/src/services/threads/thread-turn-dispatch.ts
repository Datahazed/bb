import type {
  Environment,
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadTurnInitiator,
} from "@bb/domain";
import { createThreadProvisioningId } from "@bb/db";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  MANAGED_REPROVISION_IN_PROGRESS,
  MANAGED_REPROVISION_QUEUED,
} from "../lifecycle/environment-lifecycle.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { appendThreadProvisioningEvent } from "./thread-events.js";
import { tryTransition } from "./thread-transitions.js";

export interface ReadyThreadEnvironment extends Environment {
  path: string;
  status: "ready";
}

export interface QueueTurnDuringReprovisionArgs {
  deps: WorkSessionDeps &
    Pick<AppDeps, "environmentLifecycle" | "threadLifecycle">;
  environment: Environment;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  onQueued?: () => void;
  senderThreadId: string | null;
  thread: Thread;
}

function reprovisionStartedText(
  workspaceProvisionType: Environment["workspaceProvisionType"],
): string {
  switch (workspaceProvisionType) {
    case "managed-worktree":
      return "Restoring worktree";
    case "personal":
      return "Restoring personal workspace";
    case "unmanaged":
      return "Restoring environment";
  }
}

export function requireReadyThreadEnvironment(
  environment: Environment,
): ReadyThreadEnvironment {
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return {
    ...environment,
    path: environment.path,
    status: "ready",
  };
}

export async function queueTurnDuringReprovision(
  args: QueueTurnDuringReprovisionArgs,
): Promise<boolean> {
  if (args.environment.status === "ready" && args.environment.path) {
    return false;
  }

  if (!args.environment.managed || args.environment.status === "provisioning") {
    throwEnvironmentNotReady(args.environment);
  }
  if (
    args.deps.environmentLifecycle.hasActiveProvision(args.environment.id)
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment is already provisioning",
    );
  }
  if (args.thread.status === "idle") {
    tryTransition(args.deps.db, args.deps.hub, args.thread.id, "provisioning");
  }
  const provisioningId = createThreadProvisioningId();
  const provisionEventSequence = appendThreadProvisioningEvent(args.deps, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    provisioningId,
    status: "active",
    entries: [
      {
        type: "step",
        key: "workspace-restore-started",
        text: reprovisionStartedText(args.environment.workspaceProvisionType),
        status: "started",
      },
    ],
  });

  const reprovisionResult = args.deps.environmentLifecycle.reprovisionManaged({
    environment: args.environment,
    projectId: args.thread.projectId,
    provisionEventSequence,
    provisioningId,
    threadId: args.thread.id,
  });
  if (reprovisionResult === MANAGED_REPROVISION_IN_PROGRESS) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment is already provisioning",
    );
  }
  if (reprovisionResult.status !== MANAGED_REPROVISION_QUEUED) {
    throw new ApiError(500, "internal_error", "Unexpected reprovision result");
  }

  args.deps.threadLifecycle.requestReprovision({
    thread: args.thread,
    environment: args.environment,
    provisionEventSequence: reprovisionResult.provisionEventSequence,
    input: args.input,
    execution: args.execution,
    initiator: args.initiator,
    provisioningId,
    senderThreadId: args.senderThreadId,
  });
  args.onQueued?.();
  return true;
}
