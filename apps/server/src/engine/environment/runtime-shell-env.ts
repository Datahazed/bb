/**
 * Adapted from `apps/host-daemon/src/runtime-shell-env.ts` (P1a engine
 * scaffold; the daemon copy dies in P1c). Two deliberate changes:
 * - `hostDaemonPort?` becomes required `serverPort` — in the merged process
 *   the port always exists, but the injected env var keeps the name
 *   `BB_HOST_DAEMON_PORT` (plan §5.9): the injected `bb` CLI discovers the
 *   local API through it, and the server now serves that surface itself.
 * - The default CLI path resolves the `@bb/cli` package instead of a
 *   daemon-relative `../../cli/bin/bb` walk, which is wrong from
 *   `apps/server`.
 */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";

interface ResolveLocalBbExecutableDirectoryOptions {
  cliExecutablePath?: string;
}

export interface PrepareRuntimeShellEnvOptions {
  appsRootPath: string;
  bbExecutableDirectory: string;
  inheritedPath?: string;
  serverPort: number;
  serverUrl: string;
}

function getDefaultCliExecutablePath(): string {
  const requireFromEngine = createRequire(import.meta.url);
  return join(
    dirname(requireFromEngine.resolve("@bb/cli/package.json")),
    "bin",
    "bb",
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function resolveCliEntryPath(cliExecutablePath: string): Promise<string> {
  const cliEntryPath = resolve(cliExecutablePath);

  try {
    const stats = await fs.stat(cliEntryPath);
    if (!stats.isFile()) {
      throw new Error(`Resolved bb CLI entry is not a file: ${cliEntryPath}`);
    }
    if (process.platform !== "win32") {
      try {
        await fs.access(cliEntryPath, fsConstants.X_OK);
      } catch (error) {
        if (getErrorCode(error) === "EACCES") {
          throw new Error(
            `Resolved bb CLI entry is not executable: ${cliEntryPath}. Build @bb/cli before starting the server.`,
          );
        }
        throw error;
      }
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      throw new Error(
        `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the server.`,
      );
    }
    throw error;
  }

  return cliEntryPath;
}

function prependPath(
  executableDirectoryPath: string,
  inheritedPath?: string,
): string {
  return inheritedPath
    ? `${executableDirectoryPath}${delimiter}${inheritedPath}`
    : executableDirectoryPath;
}

export async function resolveLocalBbExecutableDirectory(
  options: ResolveLocalBbExecutableDirectoryOptions = {},
): Promise<string> {
  const resolvedCliExecutablePath =
    options.cliExecutablePath ?? getDefaultCliExecutablePath();
  const cliEntryPath = await resolveCliEntryPath(resolvedCliExecutablePath);

  return dirname(cliEntryPath);
}

export function prepareRuntimeShellEnv(
  options: PrepareRuntimeShellEnvOptions,
): NonNullable<AgentRuntimeOptions["shellEnv"]> {
  return {
    PATH: prependPath(
      options.bbExecutableDirectory,
      options.inheritedPath ?? process.env.PATH,
    ),
    BB_APPS_ROOT: options.appsRootPath,
    BB_SERVER_URL: options.serverUrl,
    BB_HOST_DAEMON_PORT: String(options.serverPort),
  };
}
