import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolvePiAgentDir } from "../native-roots.js";

/**
 * Pi's settings files, read and written as files: the bridge runs without
 * pi's SDK in RPC mode, and pi itself reads the same JSON on its next
 * start. Only the keys the bridge owns are interpreted; everything else in
 * the file is carried through untouched.
 */

const piSettingsSchema = z
  .object({ enabledModels: z.array(z.string()).optional() })
  .passthrough();

export type PiSettings = z.infer<typeof piSettingsSchema>;

export function resolvePiGlobalSettingsPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(resolvePiAgentDir({ homeDir: homedir(), env }), "settings.json");
}

export function resolvePiProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

/** The parsed file, an empty object when it is absent; throws when unreadable. */
export function readPiSettingsFile(path: string): PiSettings {
  if (!existsSync(path)) {
    return {};
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to load Pi settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return piSettingsSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `Failed to load Pi settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Rewrite one settings file through `update` atomically: the new content
 * lands in a sibling temp file and is renamed over the original, so a
 * reader (pi starting up) sees the old file or the new one, never a torn
 * write. A new file is private to the user; an existing one keeps its mode.
 */
export function updatePiSettingsFile(
  path: string,
  update: (current: PiSettings) => PiSettings,
): PiSettings {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const exists = existsSync(path);
  const next = update(readPiSettingsFile(path));
  const temporaryPath = join(directory, `.settings-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (exists) chmodSync(temporaryPath, statSync(path).mode);
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return next;
}

/**
 * The `enabledModels` patterns in force for a cwd: the project file's when
 * it sets them, else the global file's (pi merges project settings over
 * global ones). Undefined when neither sets them.
 */
export function readPiEnabledModelPatterns(args: {
  cwd: string | null;
  env?: Readonly<Record<string, string | undefined>>;
}): string[] | undefined {
  const project =
    args.cwd === null ? {} : readPiSettingsFile(resolvePiProjectSettingsPath(args.cwd));
  if (project.enabledModels !== undefined) {
    return project.enabledModels;
  }
  return readPiSettingsFile(resolvePiGlobalSettingsPath(args.env)).enabledModels;
}
