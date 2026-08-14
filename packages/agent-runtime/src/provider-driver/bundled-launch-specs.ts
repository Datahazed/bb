import { isAcpProviderId } from "@bb/agent-providers";

export type BundledProviderDriverId = "acp" | "claude-code" | "codex" | "pi";

export interface BundledProviderDriverLaunchSpec {
  readonly driverId: BundledProviderDriverId;
  readonly entrypoint: {
    readonly bundleFileName: string;
    readonly sourceRelativePath: string;
  };
  readonly processPolicy: {
    readonly multiplexSessions: boolean;
    readonly scope: "environment" | "thread";
  };
}

const bundledProviderDriverSpecs = {
  acp: {
    driverId: "acp",
    entrypoint: {
      bundleFileName: "bb-acp-driver.mjs",
      sourceRelativePath: "acp/driver-entry.js",
    },
    processPolicy: { multiplexSessions: true, scope: "environment" },
  },
  "claude-code": {
    driverId: "claude-code",
    entrypoint: {
      bundleFileName: "bb-claude-code-driver.mjs",
      sourceRelativePath: "claude-code/driver-entry.js",
    },
    processPolicy: { multiplexSessions: true, scope: "environment" },
  },
  codex: {
    driverId: "codex",
    entrypoint: {
      bundleFileName: "bb-codex-driver.mjs",
      sourceRelativePath: "codex/driver-entry.js",
    },
    processPolicy: { multiplexSessions: false, scope: "thread" },
  },
  pi: {
    driverId: "pi",
    entrypoint: {
      bundleFileName: "bb-pi-driver.mjs",
      sourceRelativePath: "pi/driver-entry.js",
    },
    processPolicy: { multiplexSessions: true, scope: "environment" },
  },
} as const satisfies Record<
  BundledProviderDriverId,
  BundledProviderDriverLaunchSpec
>;

export function getBundledProviderDriverLaunchSpec(
  providerId: string,
): BundledProviderDriverLaunchSpec | null {
  if (isAcpProviderId(providerId)) {
    return bundledProviderDriverSpecs.acp;
  }
  if (
    providerId === "claude-code" ||
    providerId === "codex" ||
    providerId === "pi"
  ) {
    return bundledProviderDriverSpecs[providerId];
  }
  return null;
}
