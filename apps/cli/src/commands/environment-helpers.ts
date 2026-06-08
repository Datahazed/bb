import {
  type EnvironmentDisplayInfo,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import type { BbSdk } from "@bb/sdk";

export async function fetchEnvironmentInfo(args: {
  environmentId: string;
  sdk: BbSdk;
}): Promise<EnvironmentDisplayInfo | null> {
  try {
    const env = await args.sdk.environments.get({
      environmentId: args.environmentId,
    });
    // Single-host: every environment runs on the server's machine.
    return formatEnvironmentDisplay({ environment: env, isLocalHost: true });
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: EnvironmentDisplayInfo): void {
  console.log(`  Environment: ${env.modeLabel} (${env.id})`);
}
