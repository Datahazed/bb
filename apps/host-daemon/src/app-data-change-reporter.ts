import type { HostDaemonAppDataChangePayload } from "@bb/host-daemon-contract";
import {
  appDataPathSchema,
  appIdSchema,
  type AppDataPath,
  type AppId,
} from "@bb/domain";
import { CommandDispatchError } from "./command-dispatch-support.js";
import { runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";
import {
  listThreadAppDataFromRoot,
  readAppDataFromRoot,
  type ThreadAppDataEntry,
} from "./app-data-files.js";

interface CreateAppDataChangeReporterOptions {
  logger: HostDaemonLogger;
  postAppDataChange: (
    payload: HostDaemonAppDataChangePayload,
  ) => Promise<void>;
  postAppDataResync: (payload: AppDataResyncPayload) => Promise<void>;
}

interface AppDataCacheEntry {
  version: string;
}

interface AppDataResyncPayload {
  appId: AppId;
  threadId: string;
}

interface AppDataCacheKeyArgs {
  appId: AppId;
  path: AppDataPath;
  threadId: string;
}

interface ReportObservedDeleteArgs extends AppDataCacheKeyArgs {
  generation: number;
}

interface ReportObservedChangeArgs {
  change: ObserveAppDataChangeArgs;
  generation: number;
}

interface AppDataReporterGenerationArgs {
  generation: number;
}

interface TrackedAppDataThread {
  threadId: string;
  threadStoragePath: string;
}

interface ReplaceTrackedAppDataThreadsArgs {
  targets: readonly TrackedAppDataThread[];
}

interface ReprimeThreadArgs {
  generation: number;
  target: TrackedAppDataThread;
}

interface ApplyThreadSnapshotArgs extends ReprimeThreadArgs {
  snapshotEntries: readonly ThreadAppDataEntry[];
  snapshotAppIds: readonly AppId[];
}

interface CachedAppDataKey {
  appId: AppId;
  cacheKey: string;
  path: AppDataPath;
}

export interface ObserveAppDataChangeArgs {
  appId: AppId;
  path: AppDataPath;
  threadId: string;
  threadStoragePath: string;
}

function appDataCacheKey(args: AppDataCacheKeyArgs): string {
  return `${args.threadId}\0${args.appId}\0${args.path}`;
}

function isMissingAppDataEntryError(error: Error): boolean {
  return error instanceof CommandDispatchError && error.code === "ENOENT";
}

function isNonReportableAppDataReadError(error: Error): boolean {
  return (
    error instanceof CommandDispatchError &&
    (error.code === "invalid_json" ||
      error.code === "invalid_path" ||
      error.code === "file_too_large")
  );
}

export class AppDataChangeReporter {
  private readonly cache = new Map<string, AppDataCacheEntry>();
  private readonly appIdsByThreadId = new Map<string, Set<AppId>>();
  private readonly pendingByCacheKey = new Map<string, Promise<void>>();
  private readonly trackedThreadIds = new Set<string>();
  private generation = 0;

  constructor(private readonly options: CreateAppDataChangeReporterOptions) {}

  async replaceTrackedThreads(
    args: ReplaceTrackedAppDataThreadsArgs,
  ): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    const nextThreadIds = new Set(
      args.targets.map((target) => target.threadId),
    );
    this.replaceTrackedThreadIds(nextThreadIds);
    this.pendingByCacheKey.clear();
    await Promise.all(
      args.targets.map((target) =>
        this.reprimeThread({
          generation,
          target,
        }),
      ),
    );
  }

  observe(args: ObserveAppDataChangeArgs): Promise<void> {
    this.trackApp({
      appId: args.appId,
      threadId: args.threadId,
    });
    const cacheKey = appDataCacheKey(args);
    const generation = this.generation;
    const previous = this.pendingByCacheKey.get(cacheKey) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() =>
        this.reportObservedChange({
          change: args,
          generation,
        }),
      )
      .catch((error) => {
        this.options.logger.warn(
          {
            appId: args.appId,
            path: args.path,
            threadId: args.threadId,
            ...runtimeErrorLogFields(error),
          },
          "Failed to report observed app data change",
        );
      })
      .finally(() => {
        if (this.pendingByCacheKey.get(cacheKey) === pending) {
          this.pendingByCacheKey.delete(cacheKey);
        }
      });
    this.pendingByCacheKey.set(cacheKey, pending);
    return pending;
  }

  private isCurrentGeneration(args: AppDataReporterGenerationArgs): boolean {
    return args.generation === this.generation;
  }

  private replaceTrackedThreadIds(threadIds: ReadonlySet<string>): void {
    for (const threadId of Array.from(this.trackedThreadIds)) {
      if (threadIds.has(threadId)) {
        continue;
      }
      this.trackedThreadIds.delete(threadId);
      this.appIdsByThreadId.delete(threadId);
      for (const cached of this.cachedKeysForThread({ threadId })) {
        this.cache.delete(cached.cacheKey);
      }
    }
    for (const threadId of threadIds) {
      this.trackedThreadIds.add(threadId);
    }
  }

  private trackApp(args: AppDataResyncPayload): void {
    this.trackedThreadIds.add(args.threadId);
    let appIds = this.appIdsByThreadId.get(args.threadId);
    if (!appIds) {
      appIds = new Set<AppId>();
      this.appIdsByThreadId.set(args.threadId, appIds);
    }
    appIds.add(args.appId);
  }

  private cachedKeysForThread(args: {
    threadId: string;
  }): CachedAppDataKey[] {
    const prefix = `${args.threadId}\0`;
    return Array.from(this.cache.keys())
      .filter((cacheKey) => cacheKey.startsWith(prefix))
      .map((cacheKey) => {
        const [, rawAppId, rawDataPath] = cacheKey.split("\0");
        return {
          appId: appIdSchema.parse(rawAppId),
          path: appDataPathSchema.parse(rawDataPath),
          cacheKey,
        };
      });
  }

  private async reprimeThread(args: ReprimeThreadArgs): Promise<void> {
    try {
      const snapshot = await listThreadAppDataFromRoot({
        rootPath: args.target.threadStoragePath,
      });
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      const previousAppIds = new Set(
        this.appIdsByThreadId.get(args.target.threadId) ?? [],
      );
      await this.applyThreadSnapshot({
        ...args,
        snapshotEntries: snapshot.entries,
        snapshotAppIds: snapshot.appIds,
      });
      const resyncAppIds = new Set<AppId>([
        ...previousAppIds,
        ...snapshot.appIds,
      ]);
      await Promise.all(
        Array.from(resyncAppIds)
          .sort((left, right) => left.localeCompare(right))
          .map((appId) =>
            this.postResyncHint({
              appId,
              threadId: args.target.threadId,
            }),
          ),
      );
    } catch (error) {
      this.options.logger.warn(
        {
          threadId: args.target.threadId,
          threadStoragePath: args.target.threadStoragePath,
          ...runtimeErrorLogFields(error),
        },
        "Failed to reprime app data change cache",
      );
    }
  }

  private async applyThreadSnapshot(
    args: ApplyThreadSnapshotArgs,
  ): Promise<void> {
    const seenCacheKeys = new Set<string>();
    const appIds = new Set<AppId>(args.snapshotAppIds);
    for (const snapshotEntry of args.snapshotEntries) {
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      appIds.add(snapshotEntry.appId);
      const cacheKey = appDataCacheKey({
        appId: snapshotEntry.appId,
        path: snapshotEntry.entry.path,
        threadId: args.target.threadId,
      });
      seenCacheKeys.add(cacheKey);
      this.cache.set(cacheKey, { version: snapshotEntry.entry.version });
    }
    this.appIdsByThreadId.set(args.target.threadId, appIds);
    for (const cached of this.cachedKeysForThread({
      threadId: args.target.threadId,
    })) {
      if (!seenCacheKeys.has(cached.cacheKey)) {
        this.cache.delete(cached.cacheKey);
      }
    }
  }

  private async postResyncHint(args: AppDataResyncPayload): Promise<void> {
    try {
      await this.options.postAppDataResync(args);
    } catch (error) {
      this.options.logger.warn(
        {
          appId: args.appId,
          threadId: args.threadId,
          ...runtimeErrorLogFields(error),
        },
        "Failed to report app data resync hint",
      );
    }
  }

  private async reportObservedChange(
    args: ReportObservedChangeArgs,
  ): Promise<void> {
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    const cacheKey = appDataCacheKey(args.change);
    const previous = this.cache.get(cacheKey);

    try {
      const entry = await readAppDataFromRoot({
        appId: args.change.appId,
        path: args.change.path,
        rootPath: args.change.threadStoragePath,
      });
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      if (previous?.version === entry.version) {
        return;
      }
      await this.options.postAppDataChange({
        appId: args.change.appId,
        threadId: args.change.threadId,
        path: entry.path,
        deleted: false,
        value: entry.value,
        version: entry.version,
      });
      if (!this.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
      this.trackApp({
        appId: args.change.appId,
        threadId: args.change.threadId,
      });
      this.cache.set(cacheKey, { version: entry.version });
    } catch (error) {
      if (error instanceof Error && isMissingAppDataEntryError(error)) {
        await this.reportObservedDelete({
          appId: args.change.appId,
          generation: args.generation,
          path: args.change.path,
          threadId: args.change.threadId,
        });
        return;
      }
      if (error instanceof Error && isNonReportableAppDataReadError(error)) {
        this.options.logger.warn(
          {
            appId: args.change.appId,
            path: args.change.path,
            threadId: args.change.threadId,
            ...runtimeErrorLogFields(error),
          },
          "Ignoring unreadable observed app data file",
        );
        return;
      }
      throw error;
    }
  }

  private async reportObservedDelete(
    args: ReportObservedDeleteArgs,
  ): Promise<void> {
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    await this.options.postAppDataChange({
      appId: args.appId,
      threadId: args.threadId,
      path: args.path,
      deleted: true,
      value: null,
      version: null,
    });
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    this.trackApp({
      appId: args.appId,
      threadId: args.threadId,
    });
    this.cache.delete(appDataCacheKey(args));
  }
}
