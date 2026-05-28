import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ThreadStorageWatchTarget } from "../src/host-watcher-types.js";
import { collectThreadStorageObservedChanges } from "../src/parcel-host-watcher.js";

function createResolver(
  targets: Record<string, ThreadStorageWatchTarget>,
): (threadId: string) => ThreadStorageWatchTarget | null {
  return (threadId) => targets[threadId] ?? null;
}

describe("thread storage watcher classification", () => {
  it("emits broad storage changes for ordinary thread storage changes", () => {
    const rootPath = path.join("/tmp", "thread-storage");
    const changes = collectThreadStorageObservedChanges({
      threadStorageRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "thr_one", "notes.md"),
        path.join(rootPath, "thr_two", "reports", "summary.html"),
        path.join(rootPath, "thr_unknown", "notes.md"),
        path.join(rootPath, "..", "outside", "notes.md"),
      ],
      resolveThreadTarget: createResolver({
        thr_one: {
          environmentId: "env_one",
          threadId: "thr_one",
        },
        thr_two: {
          environmentId: "env_two",
          threadId: "thr_two",
        },
      }),
    });

    expect(changes).toEqual([
      {
        kind: "thread-storage-changed",
        environmentId: "env_one",
        threadId: "thr_one",
      },
      {
        kind: "thread-storage-changed",
        environmentId: "env_two",
        threadId: "thr_two",
      },
    ]);
  });

  it("emits targeted app data changes without broad storage changes", () => {
    const rootPath = path.join("/tmp", "thread-storage");
    const changes = collectThreadStorageObservedChanges({
      threadStorageRootPath: rootPath,
      changedPaths: [
        path.join(rootPath, "thr_one", "apps", "status", "data", "state.json"),
        path.join(rootPath, "thr_one", "apps", "status", "data", "state.json"),
        path.join(rootPath, "thr_one", "apps", "kanban", "data", "cards", "1"),
        path.join(rootPath, "thr_one", "apps", "bad.app", "data", "state.json"),
        path.join(rootPath, "thr_one", "apps", "status", "data", ".state.tmp"),
        path.join(
          rootPath,
          "thr_one",
          "apps",
          "status",
          "assets",
          "index.html",
        ),
        path.join(
          rootPath,
          "thr_unknown",
          "apps",
          "status",
          "data",
          "state.json",
        ),
      ],
      resolveThreadTarget: createResolver({
        thr_one: {
          environmentId: "env_one",
          threadId: "thr_one",
        },
      }),
    });

    expect(changes).toEqual([
      {
        kind: "thread-storage-changed",
        environmentId: "env_one",
        threadId: "thr_one",
      },
      {
        kind: "thread-app-data-changed",
        appId: "status",
        environmentId: "env_one",
        path: "state.json",
        threadId: "thr_one",
      },
      {
        kind: "thread-app-data-changed",
        appId: "kanban",
        environmentId: "env_one",
        path: "cards/1",
        threadId: "thr_one",
      },
    ]);
  });
});
