type EnvironmentHostMode = "local" | "worktree";

interface ParsedHostEnvironmentValue {
  type: "host";
  hostId: string;
  mode: EnvironmentHostMode;
}

interface ParsedReuseEnvironmentValue {
  type: "reuse";
  environmentId: string | null;
}

interface ParsedTargetEnvironmentValue {
  type: "target";
  pluginId: string;
  targetId: string;
}

export const REUSE_VALUE_WITHOUT_ENVIRONMENT = "reuse";

export const WORKTREE_TARGET_PLUGIN_ID = "worktree";
export const WORKTREE_TARGET_ID = "worktree";

export function isWorktreeEnvironmentTarget(target: {
  pluginId: string;
  targetId: string;
}): boolean {
  return (
    target.pluginId === WORKTREE_TARGET_PLUGIN_ID &&
    target.targetId === WORKTREE_TARGET_ID
  );
}

const TARGET_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export type ParsedEnvironmentValue =
  | ParsedHostEnvironmentValue
  | ParsedReuseEnvironmentValue
  | ParsedTargetEnvironmentValue
  | null;

export function encodeHostValue(
  hostId: string,
  mode: EnvironmentHostMode,
): string {
  return `host:${hostId}:${mode}`;
}

export function encodeReuseValue(environmentId: string): string {
  return `reuse:${environmentId}`;
}

export function encodeTargetValue(pluginId: string, targetId: string): string {
  return `target:${pluginId}/${targetId}`;
}

function parseTargetValue(value: string): ParsedTargetEnvironmentValue | null {
  const identity = value.slice("target:".length);
  const separator = identity.lastIndexOf("/");
  if (separator <= 0) return null;
  const pluginId = identity.slice(0, separator);
  const targetId = identity.slice(separator + 1);
  if (pluginId.includes("/") || !TARGET_ID_PATTERN.test(targetId)) {
    return null;
  }
  return { type: "target", pluginId, targetId };
}

export function parseEnvironmentValue(value: string): ParsedEnvironmentValue {
  if (value === REUSE_VALUE_WITHOUT_ENVIRONMENT) {
    return { type: "reuse", environmentId: null };
  }
  if (value.startsWith("host:")) {
    const parts = value.split(":");
    const hostId = parts[1];
    const mode = parts[2];
    if (hostId && (mode === "local" || mode === "worktree")) {
      return { type: "host", hostId, mode };
    }
  }
  if (value.startsWith("reuse:")) {
    const environmentId = value.slice("reuse:".length);
    if (environmentId.length > 0) {
      return { type: "reuse", environmentId };
    }
  }
  if (value.startsWith("target:")) {
    return parseTargetValue(value);
  }
  return null;
}
