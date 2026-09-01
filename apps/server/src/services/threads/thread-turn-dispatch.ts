import type { Environment } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  goneThreadEnvironmentDetails,
  throwEnvironmentNotReady,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";

export interface ReadyThreadEnvironment extends Environment {
  path: string;
  status: "ready";
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

export function ensureDispatchableThreadEnvironment(
  deps: LoggedPendingInteractionWorkSessionDeps,
  environment: Environment,
): void {
  if (environment.status === "ready" && environment.path) {
    return;
  }

  if (environment.status === "retiring") {
    applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: environment.id,
      event: { type: "retire.cancelled" },
    });
    return;
  }

  const goneDetails = goneThreadEnvironmentDetails(environment);
  if (goneDetails) {
    throwThreadEnvironmentUnavailable(goneDetails);
  }

  throwEnvironmentNotReady(environment);
}
