import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRunningBuildCache,
  parseGitBuildStatus,
  resolveRunningCheckoutRoot,
} from "../../src/services/system/running-build.js";

const execFileAsync = promisify(execFile);
const COMMIT = "e6f422ef5c1a9d3b7f0e2a4c8d1b6e9f3a5c7d20";
const SECOND_COMMIT = "b2f422ef5c1a9d3b7f0e2a4c8d1b6e9f3a5c7d21";
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "../../../..");

afterEach(() => {
  vi.useRealTimers();
});

describe("parseGitBuildStatus", () => {
  it("maps detached HEAD and tracked changes", () => {
    expect(
      parseGitBuildStatus(
        `# branch.oid ${COMMIT}\n# branch.head (detached)\n1 .M N... 100644 100644 100644 ${COMMIT} ${COMMIT} tracked.ts\n`,
      ),
    ).toEqual({
      branch: "HEAD",
      commit: COMMIT,
      shortCommit: "e6f422e",
      dirty: true,
    });
  });

  it("returns null when git does not report a commit", () => {
    expect(
      parseGitBuildStatus(
        "# branch.oid (initial)\n# branch.head feat/example\n",
      ),
    ).toBeNull();
  });
});

describe("resolveRunningCheckoutRoot", () => {
  it("accepts source package output but rejects an installed package path", () => {
    expect(
      resolveRunningCheckoutRoot(join(REPO_ROOT, "apps/server/dist")),
    ).toBe(resolve(REPO_ROOT));
    expect(
      resolveRunningCheckoutRoot(
        join(REPO_ROOT, "packages/bb-app/server/dist"),
      ),
    ).toBe(resolve(REPO_ROOT));
    expect(
      resolveRunningCheckoutRoot(
        join(REPO_ROOT, "node_modules/bb-app/server/dist"),
      ),
    ).toBeNull();
  });
});

describe("createRunningBuildCache", () => {
  it("refreshes the cached identity outside the request path", async () => {
    vi.useFakeTimers();
    const builds = [
      {
        branch: "feat/first",
        commit: COMMIT,
        shortCommit: COMMIT.slice(0, 7),
        dirty: false,
      },
      {
        branch: "feat/second",
        commit: SECOND_COMMIT,
        shortCommit: SECOND_COMMIT.slice(0, 7),
        dirty: true,
      },
    ];
    const resolveBuild = vi.fn(async () => builds.shift() ?? null);
    const cache = createRunningBuildCache({
      checkoutRoot: "/checkout",
      refreshIntervalMs: 100,
      resolveBuild,
    });

    expect(cache.getBuild()).toBeNull();
    cache.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.getBuild()?.branch).toBe("feat/first");
    await vi.advanceTimersByTimeAsync(100);
    expect(cache.getBuild()).toEqual({
      branch: "feat/second",
      commit: SECOND_COMMIT,
      shortCommit: "b2f422e",
      dirty: true,
    });
    cache.stop();
  });

  it("ignores untracked files when it resolves dirty state", async () => {
    const checkoutRoot = await mkdtemp(join(tmpdir(), "bb-build-test-"));
    try {
      await execFileAsync("git", ["init", "-b", "feat/example"], {
        cwd: checkoutRoot,
      });
      await writeFile(join(checkoutRoot, "tracked.txt"), "tracked\n");
      await execFileAsync("git", ["add", "tracked.txt"], {
        cwd: checkoutRoot,
      });
      await execFileAsync("git", ["commit", "-m", "initial"], {
        cwd: checkoutRoot,
        env: {
          ...process.env,
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_AUTHOR_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test",
        },
      });
      await writeFile(join(checkoutRoot, "scratch.txt"), "scratch\n");

      const cache = createRunningBuildCache({
        checkoutRoot,
        refreshIntervalMs: 60_000,
      });
      cache.start();
      await vi.waitFor(() => {
        expect(cache.getBuild()).not.toBeNull();
      });
      expect(cache.getBuild()).toMatchObject({
        branch: "feat/example",
        dirty: false,
      });
      cache.stop();
    } finally {
      await rm(checkoutRoot, { force: true, recursive: true });
    }
  });
});
