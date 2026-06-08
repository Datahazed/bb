import fs from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTarget,
  readRunningSupervisorPid,
} from "../src/commands/request-dev-restart.js";
import {
  resolveDevDataDir,
  resolveSupervisorPidPath,
} from "../src/lib/dev-restart-utils.js";
import { expectedDevDataDir } from "./dev-instance-expectations.js";

const tempDirs: string[] = [];
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("request-dev-restart", () => {
  it("rejects invalid restart targets", () => {
    expect(() => parseTarget("nope")).toThrow('Expected "server"');
    expect(() => parseTarget("host-daemon")).toThrow('Expected "server"');
    expect(() => parseTarget("both")).toThrow('Expected "server"');
  });

  it("accepts the server restart target", () => {
    expect(parseTarget("server")).toBe("server");
  });

  it("reads a valid running supervisor pid", async () => {
    const dataDir = await makeTempDir("bb-request-restart-");
    const serviceDir = join(dataDir, "dev-supervisors");
    const pidPath = join(serviceDir, "server.pid");
    await fs.mkdir(serviceDir, { recursive: true });
    await fs.writeFile(pidPath, `${process.pid}\n`, "utf8");

    await expect(
      readRunningSupervisorPid({ pidPath, serviceName: "server" }),
    ).resolves.toBe(process.pid);
  });

  it("resolves restart supervisor files from the current checkout data dir", () => {
    vi.stubEnv("BB_DATA_DIR", "/tmp/wrong-bb-data");
    const expectedDataDir = expectedDevDataDir({
      homeDir: os.homedir(),
      repoRoot,
    });

    expect(resolveDevDataDir()).toBe(expectedDataDir);
    expect(resolveSupervisorPidPath("server")).toBe(
      join(expectedDataDir, "dev-supervisors", "server.pid"),
    );
  });

  it("removes stale pid files", async () => {
    const dataDir = await makeTempDir("bb-request-restart-");
    const serviceDir = join(dataDir, "dev-supervisors");
    const pidPath = join(serviceDir, "server.pid");
    await fs.mkdir(serviceDir, { recursive: true });
    await fs.writeFile(pidPath, "456789\n", "utf8");

    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 456789 && signal === 0) {
        const error = new Error("stale");
        Object.defineProperty(error, "code", { value: "ESRCH" });
        throw error;
      }
      return true;
    });

    await expect(
      readRunningSupervisorPid({ pidPath, serviceName: "server" }),
    ).rejects.toThrow(`Stale PID file for server: ${pidPath}`);
    await expect(fs.access(pidPath)).rejects.toThrow();
  });
});
