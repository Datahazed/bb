import {
  formatCustomAcpAgentProviderId,
  type CustomAcpAgent,
} from "@bb/config/bb-app-managed-config";
import {
  acpLaunchConfigSchema,
  normalizeAcpLaunchConfig,
  type AcpLaunchConfig,
} from "bb-plugin-acp/launch-config";
import type { AppDeps } from "../../types.js";
import { findKnownAcpAgentForProviderId } from "./known-acp-agents.js";

function findCustomAcpAgentForProviderId(
  customAcpAgents: readonly CustomAcpAgent[],
  providerId: string,
): CustomAcpAgent | undefined {
  return customAcpAgents.find(
    (agent) => formatCustomAcpAgentProviderId(agent.id) === providerId,
  );
}

export function resolveAcpProviderConfigForProviderId(
  deps: Pick<AppDeps, "config">,
  providerId: string,
): AcpLaunchConfig | undefined {
  const customAgent = findCustomAcpAgentForProviderId(
    deps.config.customAcpAgents,
    providerId,
  );
  if (customAgent !== undefined) {
    const { id: _id, ...launchConfig } = customAgent;
    return normalizeAcpLaunchConfig(acpLaunchConfigSchema.parse(launchConfig));
  }

  const knownAgent = findKnownAcpAgentForProviderId(providerId);
  if (knownAgent === undefined) return undefined;
  const {
    id: _id,
    executableName: _executableName,
    ...launchConfig
  } = knownAgent;
  return normalizeAcpLaunchConfig(acpLaunchConfigSchema.parse(launchConfig));
}
