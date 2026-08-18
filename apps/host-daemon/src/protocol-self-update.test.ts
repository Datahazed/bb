import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import {
  createProtocolSelfUpdater,
  SELF_UPDATE_INITIAL_RETRY_DELAY_MS,
  SELF_UPDATE_MAX_RETRY_DELAY_MS,
} from "./protocol-self-update.js";

const roots: string[] = [];

function logger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } satisfies HostDaemonLogger;
}

async function createFixture(
  args: {
    enabled?: boolean;
    protocolVersion?: number;
    installFailure?: Error;
    nativeProbeFailure?: Error;
    now?: () => number;
    serverUrl?: string;
    useDefaultInstaller?: boolean;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-self-update-test-"));
  roots.push(dataDir);
  const installTarball = vi.fn(async () => {
    if (args.installFailure) throw args.installFailure;
  });
  const runProcess = vi.fn(async (command: string, cliArgs: string[]) => {
    if (command === "npm" && cliArgs[0] === "root") {
      const prefixIndex = cliArgs.indexOf("--prefix");
      const prefix =
        prefixIndex === -1 ? "/usr/local" : cliArgs[prefixIndex + 1];
      return { stdout: `${prefix}/lib/node_modules\n` };
    }
    if (command === process.execPath && args.nativeProbeFailure) {
      throw args.nativeProbeFailure;
    }
    return { stdout: "" };
  });
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/install/version")) {
      return Response.json({
        version: "9.0.0-test",
        protocolVersion:
          args.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION + 1,
      });
    }
    if (url.endsWith("/install/bb-app.tgz")) {
      return new Response("tarball");
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  const testLogger = logger();
  const updater = createProtocolSelfUpdater({
    dataDir,
    enabled: args.enabled ?? true,
    fetchFn,
    ...(args.useDefaultInstaller ? { runProcess } : { installTarball }),
    logger: testLogger,
    now: args.now,
    serverUrl: args.serverUrl ?? "https://server.example.test",
  });
  return { fetchFn, installTarball, logger: testLogger, runProcess, updater };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("protocol self-update", () => {
  it("installs exactly once when the server protocol is newer and enabled", async () => {
    const test = await createFixture();
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.fetchFn).toHaveBeenCalledTimes(2);
    expect(test.installTarball).toHaveBeenCalledOnce();
  });

  it("finds npm beside the running Node executable when the service PATH omits it", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenCalledTimes(3);
    expect(test.runProcess).toHaveBeenNthCalledWith(
      1,
      "npm",
      [
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        expect.stringContaining("bb-app-update-"),
      ],
      {
        env: expect.objectContaining({
          PATH: `${dirname(process.execPath)}${delimiter}/usr/bin:/bin`,
        }),
      },
    );
  });

  it("updates an installer-managed bb-app inside its machine-specific prefix", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", "/machine-data/npm");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        "--prefix",
        "/machine-data/npm",
        expect.stringContaining("bb-app-update-"),
      ],
      expect.any(Object),
    );
  });

  it("verifies the installed native add-ons before it reports an update", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", "/machine-data/npm");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["root", "-g", "--prefix", "/machine-data/npm"],
      expect.any(Object),
    );
    expect(test.runProcess).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        "-e",
        expect.stringMatching(/better-sqlite3[\s\S]*:memory:[\s\S]*node-pty/u),
        "/machine-data/npm/lib/node_modules/bb-app",
      ],
      expect.any(Object),
    );
  });

  it("keeps the current daemon when the installed native add-ons do not load", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", "/machine-data/npm");
    const test = await createFixture({
      useDefaultInstaller: true,
      nativeProbeFailure: new Error("Could not locate the bindings file"),
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");

    expect(test.logger.error).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: expect.stringContaining(
            "native add-ons (better-sqlite3, node-pty) did not load",
          ),
        }),
      },
      expect.stringContaining("keeping the current daemon running"),
    );
  });

  it("keeps legacy global updates when the installer prefix is blank", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", " ");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        expect.stringContaining("bb-app-update-"),
      ],
      expect.any(Object),
    );
  });

  it("does nothing when auto-update is disabled", async () => {
    const test = await createFixture({ enabled: false });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
    expect(test.fetchFn).not.toHaveBeenCalled();
    expect(test.installTarball).not.toHaveBeenCalled();
  });

  it("refuses auto-update over non-loopback HTTP", async () => {
    const test = await createFixture({
      serverUrl: "http://server.example.test",
    });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.fetchFn).not.toHaveBeenCalled();
    expect(test.installTarball).not.toHaveBeenCalled();
    expect(test.logger.error).toHaveBeenCalledWith(
      { serverUrl: "http://server.example.test" },
      expect.stringContaining("insecure transport"),
    );
  });

  it("allows auto-update over loopback HTTP", async () => {
    const test = await createFixture({ serverUrl: "http://127.0.0.1:38886" });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).toHaveBeenCalledOnce();
  });

  it("refuses equal protocol reinstalls and downgrades", async () => {
    for (const protocolVersion of [
      HOST_DAEMON_PROTOCOL_VERSION,
      HOST_DAEMON_PROTOCOL_VERSION - 1,
    ]) {
      const test = await createFixture({ protocolVersion });
      await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
        "skipped",
      );
      expect(test.installTarball).not.toHaveBeenCalled();
    }
  });

  it("persists a short exponential retry backoff capped at five minutes", async () => {
    let now = 10_000;
    const test = await createFixture({ now: () => now });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    now += SELF_UPDATE_INITIAL_RETRY_DELAY_MS - 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
    expect(test.installTarball).toHaveBeenCalledOnce();

    now += 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).toHaveBeenCalledTimes(2);

    for (let attemptCount = 2; attemptCount < 8; attemptCount += 1) {
      now += Math.min(
        SELF_UPDATE_INITIAL_RETRY_DELAY_MS * 2 ** (attemptCount - 1),
        SELF_UPDATE_MAX_RETRY_DELAY_MS,
      );
      await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
        "updated",
      );
    }

    now += SELF_UPDATE_MAX_RETRY_DELAY_MS - 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
  });

  it("contains install failures and rate-limits their retry", async () => {
    const test = await createFixture({
      installFailure: new Error("npm failed"),
      now: () => 25_000,
    });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
    expect(test.installTarball).toHaveBeenCalledOnce();
    expect(test.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("self-update failed"),
    );
  });

  it("lets a user-requested retry bypass and reset the current backoff", async () => {
    let now = 25_000;
    const test = await createFixture({
      installFailure: new Error("download failed"),
      now: () => now,
    });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );

    await expect(
      test.updater.handleProtocolMismatch({ force: true }),
    ).resolves.toBe("failed");
    expect(test.installTarball).toHaveBeenCalledTimes(2);

    now += SELF_UPDATE_INITIAL_RETRY_DELAY_MS;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.installTarball).toHaveBeenCalledTimes(3);
  });

  it("tries immediately when the server advances to another protocol", async () => {
    let now = 30_000;
    let protocolVersion = HOST_DAEMON_PROTOCOL_VERSION + 1;
    const test = await createFixture({ now: () => now });
    test.fetchFn.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/install/version")) {
        return Response.json({ version: "test", protocolVersion });
      }
      return new Response("tarball");
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    protocolVersion += 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).toHaveBeenCalledTimes(2);
  });
});
