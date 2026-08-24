import { describe, expect, it, vi } from "vitest";
import { createAsyncTtlMemo } from "../../src/services/lib/async-ttl-memo.js";

describe("createAsyncTtlMemo", () => {
  it("serves a settled value until it expires, then runs the task again", async () => {
    let currentTime = 1_000;
    const memo = createAsyncTtlMemo<string, number>({
      ttlMs: 100,
      now: () => currentTime,
    });
    const task = vi.fn(async () => currentTime);

    await expect(memo.run("k", task)).resolves.toBe(1_000);
    currentTime = 1_099;
    await expect(memo.run("k", task)).resolves.toBe(1_000);
    expect(task).toHaveBeenCalledTimes(1);

    currentTime = 1_100;
    await expect(memo.run("k", task)).resolves.toBe(1_100);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("holds each value for the window ttlMsForValue picks for it", async () => {
    let currentTime = 0;
    const memo = createAsyncTtlMemo<string, boolean>({
      ttlMs: 5 * 60_000,
      // An "absent" answer may be a failed lookup; keep it for much less
      // time than a "present" one.
      ttlMsForValue: (present) => (present ? 5 * 60_000 : 30_000),
      now: () => currentTime,
    });
    const absent = vi.fn(async () => false);
    const present = vi.fn(async () => true);
    await expect(memo.run("absent", absent)).resolves.toBe(false);
    await expect(memo.run("present", present)).resolves.toBe(true);

    currentTime = 30_000;
    await expect(memo.run("absent", absent)).resolves.toBe(false);
    await expect(memo.run("present", present)).resolves.toBe(true);
    expect(absent).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenCalledTimes(1);

    currentTime = 4 * 60_000;
    await expect(memo.run("present", present)).resolves.toBe(true);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight task and never stores a rejection", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    let reject: (error: Error) => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<string>((_resolve, rejectTask) => {
          reject = rejectTask;
        }),
    );

    const first = memo.run("k", task);
    const second = memo.run("k", task);
    expect(task).toHaveBeenCalledTimes(1);
    reject(new Error("probe failed"));
    await expect(first).rejects.toThrow("probe failed");
    await expect(second).rejects.toThrow("probe failed");

    const recovered = vi.fn(async () => "ok");
    await expect(memo.run("k", recovered)).resolves.toBe("ok");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("replays a memoizable failure until failures.ttlMs, then runs the task again", async () => {
    let currentTime = 1_000;
    const memo = createAsyncTtlMemo<string, string>({
      ttlMs: 60_000,
      failures: {
        ttlMs: 100,
        shouldMemoize: (error) =>
          error instanceof Error && error.message === "auth_required",
      },
      now: () => currentTime,
    });
    const failure = new Error("auth_required");
    const failing = vi.fn(async (): Promise<string> => {
      throw failure;
    });

    await expect(memo.run("k", failing)).rejects.toBe(failure);
    currentTime = 1_099;
    await expect(memo.run("k", failing)).rejects.toBe(failure);
    expect(failing).toHaveBeenCalledTimes(1);

    // Past the failure window the task runs again, and its success is kept
    // for the (longer) success window.
    currentTime = 1_100;
    const recovered = vi.fn(async () => "ok");
    await expect(memo.run("k", recovered)).resolves.toBe("ok");
    currentTime = 1_100 + 59_999;
    await expect(memo.run("k", recovered)).resolves.toBe("ok");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("does not store a failure the predicate rejects", async () => {
    const memo = createAsyncTtlMemo<string, string>({
      ttlMs: 60_000,
      failures: {
        ttlMs: 60_000,
        shouldMemoize: (error) =>
          error instanceof Error && error.message === "host answered",
      },
    });
    const transport = vi.fn(async (): Promise<string> => {
      throw new Error("host_unavailable");
    });

    await expect(memo.run("k", transport)).rejects.toThrow("host_unavailable");
    await expect(memo.run("k", transport)).rejects.toThrow("host_unavailable");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("clear() forgets a memoized failure", async () => {
    const memo = createAsyncTtlMemo<string, string>({
      ttlMs: 60_000,
      failures: { ttlMs: 60_000, shouldMemoize: () => true },
    });
    const failing = vi.fn(async (): Promise<string> => {
      throw new Error("probe failed");
    });
    await expect(memo.run("k", failing)).rejects.toThrow("probe failed");
    await expect(memo.run("k", failing)).rejects.toThrow("probe failed");
    expect(failing).toHaveBeenCalledTimes(1);

    memo.clear();
    const recovered = vi.fn(async () => "ok");
    await expect(memo.run("k", recovered)).resolves.toBe("ok");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("clear() discards a success that was still in flight when it ran", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    let resolve: (value: string) => void = () => {};
    const stale = memo.run(
      "k",
      () =>
        new Promise<string>((resolveTask) => {
          resolve = resolveTask;
        }),
    );

    // An install (or forced recheck) lands while the probe is running: the
    // probe's answer describes the host before it and must not outlive the
    // clear, even though its own caller still receives it.
    memo.clear();
    resolve("pre-install");
    await expect(stale).resolves.toBe("pre-install");

    const fresh = vi.fn(async () => "post-install");
    await expect(memo.run("k", fresh)).resolves.toBe("post-install");
    expect(fresh).toHaveBeenCalledOnce();
  });

  it("clear() discards a memoizable failure that was still in flight when it ran", async () => {
    const memo = createAsyncTtlMemo<string, string>({
      ttlMs: 60_000,
      failures: { ttlMs: 30_000, shouldMemoize: () => true },
    });
    let reject: (error: Error) => void = () => {};
    const stale = memo.run(
      "k",
      () =>
        new Promise<string>((_resolve, rejectTask) => {
          reject = rejectTask;
        }),
    );

    memo.clear();
    const missing = new Error("missing_executable");
    reject(missing);
    await expect(stale).rejects.toBe(missing);

    const fresh = vi.fn(async () => "ok");
    await expect(memo.run("k", fresh)).resolves.toBe("ok");
    expect(fresh).toHaveBeenCalledOnce();
  });

  it("keeps storing a task started after clear() while an older one is still in flight", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    let resolveStale: (value: string) => void = () => {};
    const stale = memo.run(
      "k",
      () =>
        new Promise<string>((resolveTask) => {
          resolveStale = resolveTask;
        }),
    );
    memo.clear();

    // The post-clear probe settles first; the stale one settling later must
    // not overwrite it.
    await expect(memo.run("k", async () => "fresh")).resolves.toBe("fresh");
    resolveStale("stale");
    await stale;

    const task = vi.fn(async () => "unused");
    await expect(memo.run("k", task)).resolves.toBe("fresh");
    expect(task).not.toHaveBeenCalled();
  });

  it("keys entries independently and clears them on demand", async () => {
    const memo = createAsyncTtlMemo<string, string>({ ttlMs: 60_000 });
    await expect(memo.run("a", async () => "A")).resolves.toBe("A");
    await expect(memo.run("b", async () => "B")).resolves.toBe("B");
    await expect(memo.run("a", async () => "A2")).resolves.toBe("A");
    memo.clear();
    await expect(memo.run("a", async () => "A2")).resolves.toBe("A2");
  });
});
