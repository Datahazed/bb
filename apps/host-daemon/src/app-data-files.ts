import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  appDataPathSchema,
  appIdSchema,
  jsonValueSchema,
  type AppDataPath,
  type AppId,
  type JsonValue,
} from "@bb/domain";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
} from "./command-dispatch-support.js";
import { isFsErrorWithCode } from "./fs-errors.js";
import { NON_IMAGE_FILE_SIZE_LIMIT_BYTES } from "./command-handlers/file-read.js";
import { resolveNonSymlinkDirectoryPath } from "./command-handlers/root-path.js";

export interface AppDataEntry {
  modifiedAtMs: number;
  path: AppDataPath;
  sizeBytes: number;
  value: JsonValue;
  version: string;
}

export interface ThreadAppDataEntry {
  appId: AppId;
  entry: AppDataEntry;
}

export interface ThreadAppDataSnapshot {
  appIds: AppId[];
  entries: ThreadAppDataEntry[];
}

interface AppDataTargetArgs {
  appId: AppId;
  path: AppDataPath;
  rootPath: string;
}

interface ResolveAppDataRootArgs {
  appId: AppId;
  rootPath: string;
}

interface ReadAppDataJsonArgs {
  bytes: Buffer;
  path: AppDataPath;
}

interface ListAppDataFilesArgs {
  appDataRoot: string;
  currentDirectory: string;
}

interface ListThreadAppDataArgs {
  rootPath: string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function createFileTooLargeError(stat: Stats): CommandDispatchError {
  return new CommandDispatchError(
    "file_too_large",
    `File size ${stat.size} bytes exceeds the ${Math.floor(NON_IMAGE_FILE_SIZE_LIMIT_BYTES / (1024 * 1024))} MB limit`,
  );
}

function parseJsonValue(args: ReadAppDataJsonArgs): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(args.bytes.toString("utf8")));
  } catch {
    throw new CommandDispatchError(
      "invalid_json",
      `App data path ${args.path} does not contain valid JSON`,
    );
  }
}

async function resolveAppDataRoot(
  args: ResolveAppDataRootArgs,
): Promise<string> {
  const appId = appIdSchema.parse(args.appId);
  if (!path.isAbsolute(args.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }
  const threadStoragePath = await resolveNonSymlinkDirectoryPath({
    description: "Thread storage root",
    path: args.rootPath,
  });
  const appDataPath = path.join(threadStoragePath, "apps", appId, "data");
  const resolvedAppDataPath = await resolveNonSymlinkDirectoryPath({
    description: "App data directory",
    path: appDataPath,
  });
  if (!isPathWithinRoot(resolvedAppDataPath, threadStoragePath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "App data path escapes thread storage root",
    );
  }
  return resolvedAppDataPath;
}

export async function readAppDataFromRoot(
  args: AppDataTargetArgs,
): Promise<AppDataEntry> {
  const appDataPath = appDataPathSchema.parse(args.path);
  let appDataRoot: string;
  try {
    appDataRoot = await resolveAppDataRoot({
      appId: args.appId,
      rootPath: args.rootPath,
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw new ExpectedCommandDispatchError(
        "ENOENT",
        `Path does not exist: ${appDataPath}`,
      );
    }
    throw error;
  }
  const filePath = path.join(appDataRoot, ...appDataPath.split("/"));
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw new ExpectedCommandDispatchError(
        "ENOENT",
        `Path does not exist: ${appDataPath}`,
      );
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CommandDispatchError(
      "invalid_path",
      `App data path ${appDataPath} is not a regular file`,
    );
  }
  if (stat.size > NON_IMAGE_FILE_SIZE_LIMIT_BYTES) {
    throw createFileTooLargeError(stat);
  }

  const bytes = await fs.readFile(filePath);
  return {
    modifiedAtMs: stat.mtimeMs,
    path: appDataPath,
    sizeBytes: stat.size,
    value: parseJsonValue({ bytes, path: appDataPath }),
    version: sha256(bytes),
  };
}

async function listAppDataFilePaths(
  args: ListAppDataFilesArgs,
): Promise<AppDataPath[]> {
  const entries = await fs.readdir(args.currentDirectory, {
    withFileTypes: true,
  });
  const paths: AppDataPath[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(args.currentDirectory, entry.name);
    if (entry.isDirectory()) {
      paths.push(
        ...(await listAppDataFilePaths({
          appDataRoot: args.appDataRoot,
          currentDirectory: entryPath,
        })),
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path
      .relative(args.appDataRoot, entryPath)
      .split(path.sep)
      .join("/");
    const parsed = appDataPathSchema.safeParse(relativePath);
    if (parsed.success) {
      paths.push(parsed.data);
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

export async function listThreadAppDataFromRoot(
  args: ListThreadAppDataArgs,
): Promise<ThreadAppDataSnapshot> {
  if (!path.isAbsolute(args.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }
  const threadStoragePath = await resolveNonSymlinkDirectoryPath({
    description: "Thread storage root",
    path: args.rootPath,
  });
  const appsRoot = path.join(threadStoragePath, "apps");
  let appDirectories;
  try {
    appDirectories = await fs.readdir(appsRoot, { withFileTypes: true });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return { appIds: [], entries: [] };
    }
    throw error;
  }

  const appIds: AppId[] = [];
  const snapshotEntries: ThreadAppDataEntry[] = [];
  for (const directory of appDirectories) {
    if (!directory.isDirectory()) {
      continue;
    }
    const parsedAppId = appIdSchema.safeParse(directory.name);
    if (!parsedAppId.success) {
      continue;
    }
    const appId = parsedAppId.data;
    appIds.push(appId);
    const appDataRoot = path.join(appsRoot, appId, "data");
    let resolvedAppDataRoot;
    try {
      resolvedAppDataRoot = await resolveNonSymlinkDirectoryPath({
        description: "App data directory",
        path: appDataRoot,
      });
    } catch (error) {
      if (isFsErrorWithCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
    const dataPaths = await listAppDataFilePaths({
      appDataRoot: resolvedAppDataRoot,
      currentDirectory: resolvedAppDataRoot,
    });
    for (const dataPath of dataPaths) {
      snapshotEntries.push({
        appId,
        entry: await readAppDataFromRoot({
          appId,
          path: dataPath,
          rootPath: threadStoragePath,
        }),
      });
    }
  }

  appIds.sort((left, right) => left.localeCompare(right));
  snapshotEntries.sort((left, right) => {
    const appOrder = left.appId.localeCompare(right.appId);
    return appOrder === 0
      ? left.entry.path.localeCompare(right.entry.path)
      : appOrder;
  });
  return {
    appIds,
    entries: snapshotEntries,
  };
}
