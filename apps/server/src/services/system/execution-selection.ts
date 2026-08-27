import type { AvailableModel, ReasoningLevel } from "@bb/domain";
import type {
  SystemExecutionSelectionValidationRequest,
  SystemExecutionSelectionValidationResponse,
} from "@bb/server-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import { resolveSystemProviderModels } from "./execution-options.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";

export interface AuthoritativeProviderExecutionCatalog {
  models: readonly AvailableModel[];
  selectedOnlyModels: readonly AvailableModel[];
}

interface LoadAuthoritativeProviderExecutionCatalogArgs {
  cwd?: string;
  hostId: string;
  providerId: string;
}

interface ValidateExecutionSelectionAgainstCatalogArgs {
  allowSelectedOnly?: boolean;
  catalog: AuthoritativeProviderExecutionCatalog;
  model: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
}

export interface ValidatedProviderExecutionSelection {
  model: string;
  modelEntry: AvailableModel;
  providerId: string;
  reasoningLevel: ReasoningLevel;
}

/**
 * Require a successfully loaded, target-specific catalog. Fallback rows from
 * a failed probe are useful for rendering but cannot prove that a selection
 * is valid, so mutation boundaries fail closed with a retryable error.
 */
export async function loadAuthoritativeProviderExecutionCatalog(
  deps: LoggedWorkSessionDeps,
  args: LoadAuthoritativeProviderExecutionCatalogArgs,
): Promise<AuthoritativeProviderExecutionCatalog> {
  const catalog = await resolveSystemProviderModels(deps, args);
  if (catalog.modelLoadError !== null) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `Unable to load ${args.providerId} models to validate the execution selection. Try again once the host is connected and the provider is ready.`,
      {
        details: catalog.modelLoadError,
        retryable: true,
      },
    );
  }
  return {
    models: catalog.models,
    selectedOnlyModels: catalog.selectedOnlyModels,
  };
}

/**
 * Validate one resolved tuple against a successfully loaded catalog. Explicit
 * selections use active models only; inherited selections may retain a
 * selected-only model. Matching accepts both the picker id and provider model
 * route, and returns the provider route so aliases resolve consistently.
 */
export function validateExecutionSelectionAgainstCatalog(
  args: ValidateExecutionSelectionAgainstCatalogArgs,
): ValidatedProviderExecutionSelection {
  const candidates = args.allowSelectedOnly
    ? [...args.catalog.models, ...args.catalog.selectedOnlyModels]
    : args.catalog.models;
  const modelEntry = candidates.find(
    (candidate) =>
      candidate.id === args.model || candidate.model === args.model,
  );
  if (modelEntry === undefined) {
    throw new ApiError(
      400,
      "model_not_available",
      `Model "${args.model}" is not available for provider ${args.providerId} on the selected machine. Choose a model from the provider catalog or register an accepted unlisted id in customModels.`,
    );
  }

  const supportedReasoningLevels = modelEntry.supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort,
  );
  // An empty list means the provider did not advertise an authoritative
  // per-model reasoning contract. Provider-level validation still runs in the
  // execution planner; do not manufacture a stricter per-model rule here.
  if (
    supportedReasoningLevels.length > 0 &&
    !supportedReasoningLevels.includes(args.reasoningLevel)
  ) {
    throw new ApiError(
      400,
      "reasoning_level_not_supported",
      `Reasoning level "${args.reasoningLevel}" is not supported by ${args.providerId} model "${args.model}". Supported reasoning levels: ${supportedReasoningLevels.join(", ")}.`,
    );
  }

  return {
    providerId: args.providerId,
    model: modelEntry.model,
    modelEntry,
    reasoningLevel: args.reasoningLevel,
  };
}

export async function validateProviderExecutionSelection(
  deps: LoggedWorkSessionDeps,
  args: LoadAuthoritativeProviderExecutionCatalogArgs & {
    allowSelectedOnly?: boolean;
    model: string;
    reasoningLevel: ReasoningLevel;
  },
): Promise<ValidatedProviderExecutionSelection> {
  const catalog = await loadAuthoritativeProviderExecutionCatalog(deps, args);
  return validateExecutionSelectionAgainstCatalog({
    ...(args.allowSelectedOnly === undefined
      ? {}
      : { allowSelectedOnly: args.allowSelectedOnly }),
    catalog,
    model: args.model,
    providerId: args.providerId,
    reasoningLevel: args.reasoningLevel,
  });
}

/** Public SDK preflight used by server-side plugins before persisting tuples. */
export async function validateSystemExecutionSelection(
  deps: LoggedWorkSessionDeps,
  request: SystemExecutionSelectionValidationRequest,
): Promise<SystemExecutionSelectionValidationResponse> {
  const hostId = resolveSystemLookupHostId(deps, request);
  const cwd =
    request.environmentId === undefined
      ? undefined
      : (requireEnvironment(deps.db, request.environmentId).path ?? undefined);
  const validated = await validateProviderExecutionSelection(deps, {
    ...(cwd === undefined ? {} : { cwd }),
    hostId,
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
  });
  return {
    providerId: validated.providerId,
    model: validated.model,
    reasoningLevel: validated.reasoningLevel,
  };
}
