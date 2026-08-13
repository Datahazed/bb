import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PI_DRIVER_SESSION_DIR_ENV = "BB_PI_DRIVER_SESSION_DIR";
const LEGACY_PI_BRIDGE_SESSION_DIR_ENV = "BB_PI_BRIDGE_SESSION_DIR";

export interface ResolvePiDriverSessionDirArgs {
  env: NodeJS.ProcessEnv;
}

export interface ResolvePiSessionFilePathArgs extends ResolvePiDriverSessionDirArgs {
  sessionPath?: string;
  threadId: string;
}

export function resolvePiDriverSessionDir(
  args: ResolvePiDriverSessionDirArgs,
): string {
  const configuredSessionDir =
    args.env[PI_DRIVER_SESSION_DIR_ENV]?.trim() ??
    args.env[LEGACY_PI_BRIDGE_SESSION_DIR_ENV]?.trim();
  if (configuredSessionDir) {
    return resolve(configuredSessionDir);
  }

  return join(homedir(), ".bb", "pi-driver-sessions");
}

export function resolvePiSessionFilePath(
  args: ResolvePiSessionFilePathArgs,
): string {
  if (args.sessionPath?.trim()) {
    return resolve(args.sessionPath);
  }

  return join(
    resolvePiDriverSessionDir({ env: args.env }),
    `${sanitizeSessionKey(args.threadId)}.jsonl`,
  );
}

function sanitizeSessionKey(threadId: string): string {
  return threadId.replace(/[^A-Za-z0-9._-]/g, "_");
}
