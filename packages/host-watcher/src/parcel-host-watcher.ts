import path from "node:path";
import {
  appDataPathSchema,
  appIdSchema,
  type AppDataPath,
  type AppId,
  type StatusDataKey,
} from "@bb/domain";
import {
  parseStatusDataFileName,
  STATUS_DATA_DIRECTORY_NAME,
} from "./status-data-paths.js";
import { watchPathChanges } from "./watch-path.js";
import { watchWorkspaceStatus } from "./watch-status.js";
import type {
  HostWatcher,
  ThreadStorageObservedChange,
  ThreadStorageWatchTarget,
  WatchThreadStorageRootArgs,
  WatchWorkspaceArgs,
} from "./host-watcher-types.js";

interface ThreadStoragePathArgs {
  changedPath: string;
  threadStorageRootPath: string;
}

interface ThreadStoragePath {
  parts: string[];
  threadId: string;
}

interface ThreadStatusDataPath {
  key: StatusDataKey;
  threadId: string;
}

interface ThreadAppDataPath {
  appId: AppId;
  path: AppDataPath;
  threadId: string;
}

interface CollectThreadStorageObservedChangesArgs {
  changedPaths: string[];
  threadStorageRootPath: string;
  resolveThreadTarget: (threadId: string) => ThreadStorageWatchTarget | null;
}

function toThreadStoragePath(
  args: ThreadStoragePathArgs,
): ThreadStoragePath | null {
  const relativePath = path.relative(
    args.threadStorageRootPath,
    args.changedPath,
  );
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  const parts = relativePath.split(path.sep).filter(Boolean);
  const threadId = parts[0];
  if (!threadId) {
    return null;
  }
  return {
    parts,
    threadId,
  };
}

function isStatusDataSubtreePath(path: ThreadStoragePath): boolean {
  return path.parts[1] === STATUS_DATA_DIRECTORY_NAME;
}

function isAppDataSubtreePath(path: ThreadStoragePath): boolean {
  return path.parts[1] === "apps" && path.parts[3] === "data";
}

function toThreadStatusDataPath(
  path: ThreadStoragePath,
): ThreadStatusDataPath | null {
  if (!isStatusDataSubtreePath(path) || path.parts.length !== 3) {
    return null;
  }
  const parsedKey = parseStatusDataFileName(path.parts[2] ?? "");
  if (!parsedKey) {
    return null;
  }
  return {
    threadId: path.threadId,
    key: parsedKey,
  };
}

function toThreadAppDataPath(path: ThreadStoragePath): ThreadAppDataPath | null {
  if (!isAppDataSubtreePath(path) || path.parts.length < 5) {
    return null;
  }
  const appId = appIdSchema.safeParse(path.parts[2]);
  if (!appId.success) {
    return null;
  }
  const dataPath = appDataPathSchema.safeParse(path.parts.slice(4).join("/"));
  if (!dataPath.success) {
    return null;
  }
  return {
    appId: appId.data,
    threadId: path.threadId,
    path: dataPath.data,
  };
}

export function collectThreadStorageObservedChanges(
  args: CollectThreadStorageObservedChangesArgs,
): ThreadStorageObservedChange[] {
  const storageChanges = new Map<string, ThreadStorageWatchTarget>();
  const statusDataChanges = new Map<string, ThreadStorageObservedChange>();
  const appDataChanges = new Map<string, ThreadStorageObservedChange>();
  for (const changedPath of args.changedPaths) {
    const storagePath = toThreadStoragePath({
      changedPath,
      threadStorageRootPath: args.threadStorageRootPath,
    });
    if (!storagePath) {
      continue;
    }
    const target = args.resolveThreadTarget(storagePath.threadId);
    if (!target) {
      continue;
    }
    if (isStatusDataSubtreePath(storagePath)) {
      const statusDataPath = toThreadStatusDataPath(storagePath);
      if (statusDataPath) {
        statusDataChanges.set(
          `${target.environmentId}:${target.threadId}:${statusDataPath.key}`,
          {
            kind: "thread-status-data-changed",
            environmentId: target.environmentId,
            threadId: target.threadId,
            key: statusDataPath.key,
          },
        );
      }
      continue;
    }
    if (isAppDataSubtreePath(storagePath)) {
      const appDataPath = toThreadAppDataPath(storagePath);
      if (appDataPath) {
        appDataChanges.set(
          `${target.environmentId}:${target.threadId}:${appDataPath.appId}:${appDataPath.path}`,
          {
            kind: "thread-app-data-changed",
            appId: appDataPath.appId,
            environmentId: target.environmentId,
            path: appDataPath.path,
            threadId: target.threadId,
          },
        );
      }
      continue;
    }
    storageChanges.set(`${target.environmentId}:${target.threadId}`, target);
  }

  const observedChanges: ThreadStorageObservedChange[] = [];
  for (const target of storageChanges.values()) {
    observedChanges.push({
      kind: "thread-storage-changed",
      environmentId: target.environmentId,
      threadId: target.threadId,
    });
  }
  observedChanges.push(...statusDataChanges.values());
  observedChanges.push(...appDataChanges.values());
  return observedChanges;
}

function watchWorkspace(args: WatchWorkspaceArgs): () => void {
  return watchWorkspaceStatus(args.workspacePath, {
    onChange: (event) => {
      args.onChange({
        changedPaths: event.changedPaths,
        changeKinds: event.changeKinds,
        kind: "workspace-status-changed",
        environmentId: args.environmentId,
      });
    },
    onWatchError: (error) => {
      args.onWatchError({
        kind: "workspace-watch-error",
        environmentId: args.environmentId,
        rootPath: error.rootPath,
        message: error.message,
      });
    },
  });
}

function watchThreadStorageRoot(args: WatchThreadStorageRootArgs): () => void {
  return watchPathChanges(args.threadStorageRootPath, {
    onChange: ({ changedPaths }) => {
      const events = collectThreadStorageObservedChanges({
        changedPaths,
        threadStorageRootPath: args.threadStorageRootPath,
        resolveThreadTarget: args.resolveThreadTarget,
      });
      for (const event of events) {
        args.onChange(event);
      }
    },
    onWatchError: (error) => {
      args.onWatchError({
        kind: "thread-storage-watch-error",
        rootPath: error.rootPath,
        message: error.message,
      });
    },
  });
}

export function createParcelHostWatcher(): HostWatcher {
  return {
    watchWorkspace,
    watchThreadStorageRoot,
  };
}
