import { isDeepStrictEqual } from "node:util";
import type {
  ClassifyProviderExecutionSettingsChangeArgs,
  ProviderExecutionContext,
  ProviderExecutionSettingsChange,
} from "./provider-driver/connection.js";
import type { AgentRuntimeExecutionOptions } from "./types.js";
import type { RuntimePermissionPolicy } from "@bb/domain";

interface AssertProviderSupportsExecutionOptionsArgs {
  capabilities: {
    supportedPermissionModes: readonly AgentRuntimeExecutionOptions["permissionMode"][];
    supportsServiceTier: boolean;
  };
  options: AgentRuntimeExecutionOptions;
  providerId: string;
}

interface ToProviderExecutionContextArgs {
  envVars: Record<string, string>;
  execOpts: AgentRuntimeExecutionOptions;
  instructions: string | undefined;
}

interface SameExecutionSettingsArgs {
  left: AgentRuntimeExecutionOptions;
  right: AgentRuntimeExecutionOptions;
}

export function assertProviderSupportsExecutionOptions(
  args: AssertProviderSupportsExecutionOptionsArgs,
): void {
  if (
    args.options.serviceTier !== "default" &&
    !args.capabilities.supportsServiceTier
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support service tiers.`,
    );
  }
  if (
    !args.capabilities.supportedPermissionModes.includes(
      args.options.permissionMode,
    )
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support permission mode "${args.options.permissionMode}".`,
    );
  }
}

export function sameExecutionSettings(
  args: SameExecutionSettingsArgs,
): boolean {
  return isDeepStrictEqual(args.left, args.right);
}

export function classifySessionExecutionSettingsChange(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): ProviderExecutionSettingsChange {
  return sameExecutionSettings({ left: args.current, right: args.next })
    ? "unchanged"
    : "session";
}

function sameSessionConstructionSettings(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): boolean {
  return (
    args.current.serviceTier === args.next.serviceTier &&
    args.current.planModeEnabled === args.next.planModeEnabled &&
    isDeepStrictEqual(
      args.current.providerOptions,
      args.next.providerOptions,
    ) &&
    args.current.permissionMode === args.next.permissionMode &&
    args.current.permissionScope === args.next.permissionScope &&
    args.current.approvalReviewer === args.next.approvalReviewer
  );
}

export function classifyLiveExecutionSettingsChange(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): ProviderExecutionSettingsChange {
  if (!sameSessionConstructionSettings(args)) return "session";
  return sameExecutionSettings({ left: args.current, right: args.next })
    ? "unchanged"
    : "live";
}

export function toProviderExecutionContext(
  args: ToProviderExecutionContextArgs,
): ProviderExecutionContext {
  const permissionPolicy: RuntimePermissionPolicy = args.execOpts;
  return {
    model: args.execOpts.model,
    serviceTier: args.execOpts.serviceTier,
    reasoningLevel: args.execOpts.reasoningLevel,
    providerOptions: args.execOpts.providerOptions,
    planModeEnabled: args.execOpts.planModeEnabled,
    workflowsEnabled: args.execOpts.workflowsEnabled,
    memoryEnabled: args.execOpts.memoryEnabled,
    providerSubagentsEnabled: args.execOpts.providerSubagentsEnabled,
    ...permissionPolicy,
    instructions: args.instructions,
    envVars: args.envVars,
  };
}
