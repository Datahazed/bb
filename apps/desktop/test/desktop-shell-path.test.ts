import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  defaultSpawnLoginShellPath,
  ensurePackagedUserShellPath,
  type DesktopShellPathFs,
  type DesktopShellPathLogger,
  type ShellPathSpawnResult,
  type SpawnLoginShellPath,
  type SpawnLoginShellPathArgs,
} from "../src/desktop-shell-path.js";

const START_MARKER = "__BB_DESKTOP_SHELL_PATH_START__";
const END_MARKER = "__BB_DESKTOP_SHELL_PATH_END__";
const SHELL_PATH_COMMAND = `printf '\\n%s\\nPATH=%s\\n%s\\n' '${START_MARKER}' "$PATH" '${END_MARKER}'`;
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const HOME_DIR = "/Users/sawyerhood";
const NVM_VERSIONS_DIR = join(HOME_DIR, ".nvm", "versions", "node");
const HOMEBREW_PROFILE_PATH =
  "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

interface FakeSpawn {
  calls: SpawnLoginShellPathArgs[];
  spawn: SpawnLoginShellPath;
}

interface CreateSpawnResultArgs {
  error?: Error;
  signal?: NodeJS.Signals | null;
  status?: number | null;
  stderr?: string;
  stdout?: string;
}

interface CreateFakeFsArgs {
  directories?: string[];
  files?: Record<string, string>;
}

interface WarningLogger {
  logger: DesktopShellPathLogger;
  warnings: string[];
}

/** What the probe command prints: the PATH fenced by the marker lines. */
function shellPathOutput(path: string): string {
  return `\n${START_MARKER}\nPATH=${path}\n${END_MARKER}\n`;
}

function createSpawnResult(args: CreateSpawnResultArgs): ShellPathSpawnResult {
  return {
    ...(args.error === undefined ? {} : { error: args.error }),
    signal: args.signal ?? null,
    status: args.status ?? 0,
    stderr: args.stderr ?? "",
    stdout: args.stdout ?? "",
  };
}

function createTimedOutResult(stdout = ""): ShellPathSpawnResult {
  return createSpawnResult({
    error: new Error("timed out after 5000 ms"),
    signal: "SIGKILL",
    status: null,
    stdout,
  });
}

/** The shape Node gives a spawn error: the errno on `code`, in the message. */
function createSpawnError(command: string, code: string): Error {
  return Object.assign(new Error(`spawn ${command} ${code}`), { code });
}

function createFakeSpawn(results: ShellPathSpawnResult[]): FakeSpawn {
  const calls: SpawnLoginShellPathArgs[] = [];
  const queue = [...results];
  return {
    calls,
    spawn(spawnArgs) {
      calls.push(spawnArgs);
      const result = queue.shift();
      if (result === undefined) {
        throw new Error(
          `unexpected shell spawn: ${spawnArgs.command} ${spawnArgs.args.join(" ")}`,
        );
      }
      return Promise.resolve(result);
    },
  };
}

function createFakeFs(args: CreateFakeFsArgs = {}): DesktopShellPathFs {
  const directories = new Set(args.directories ?? []);
  const files = new Map(Object.entries(args.files ?? {}));
  return {
    isDirectory(path) {
      return directories.has(path) && !files.has(path);
    },
    listDirectory(path) {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const directory of directories) {
        if (!directory.startsWith(prefix)) {
          continue;
        }
        const [name] = directory.slice(prefix.length).split("/");
        if (name !== undefined && name.length > 0) {
          names.add(name);
        }
      }
      return [...names];
    },
    readTextFile(path) {
      return files.get(path) ?? null;
    },
  };
}

function createWarningLogger(): WarningLogger {
  const warnings: string[] = [];
  return {
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    warnings,
  };
}

function failIfSpawned(): SpawnLoginShellPath {
  return () => {
    throw new Error("shell spawn should not run");
  };
}

describe("desktop shell PATH loading", () => {
  it("uses the macOS login shell PATH for packaged desktop launches", async () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const shellPath = "/Users/sawyerhood/.bun/bin:/usr/bin:/bin";
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ stdout: shellPathOutput(shellPath) }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({
      appended: [],
      failures: [],
      kind: "updated",
      path: shellPath,
      shell: "/bin/zsh",
      source: "interactive-login-shell",
      uncleanExit: null,
    });
    expect(env.PATH).toBe(shellPath);
    expect(warningLogger.warnings).toEqual([]);
    expect(fakeSpawn.calls).toEqual([
      {
        args: ["-ilc", SHELL_PATH_COMMAND],
        command: "/bin/zsh",
        timeoutMs: 5_000,
      },
    ]);
  });

  it("probes the login shell launchd passes in SHELL instead of assuming zsh", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: LAUNCHD_PATH,
      SHELL: "/opt/homebrew/bin/fish",
    };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({
        stdout: shellPathOutput("/Users/sawyerhood/.volta/bin:/usr/bin:/bin"),
      }),
    ]);

    await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(fakeSpawn.calls.map((call) => call.command)).toEqual([
      "/opt/homebrew/bin/fish",
    ]);
  });

  it("merges the probed PATH with inherited entries the shell did not report", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({
        stdout: shellPathOutput("/opt/homebrew/bin:/usr/bin"),
      }),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({ kind: "updated" });
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(fakeSpawn.calls).toHaveLength(1);
  });

  it("ignores login banners and version-manager hook output around the PATH block", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const nvmBin = join(NVM_VERSIONS_DIR, "v22.11.0", "bin");
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({
        stdout: `Welcome to my shell\nNow using node v22.11.0 (npm v10.9.0)${shellPathOutput(`${nvmBin}:/usr/bin:/bin`)}bye\n`,
      }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      kind: "updated",
      path: `${nvmBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      uncleanExit: null,
    });
    expect(env.PATH).toBe(`${nvmBin}:/usr/bin:/bin:/usr/sbin:/sbin`);
    expect(warningLogger.warnings).toEqual([]);
  });

  it("keeps a complete PATH block when the shell printed it but did not exit cleanly", async () => {
    // A login file that leaves a background job holding stdout, or a hung
    // logout hook, makes the probe time out after the PATH was printed.
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const shellPath = "/Users/sawyerhood/.volta/bin:/usr/bin:/bin";
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(shellPathOutput(shellPath)),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({
      appended: [],
      failures: [],
      kind: "updated",
      path: `${shellPath}:/usr/sbin:/sbin`,
      shell: "/bin/zsh",
      source: "interactive-login-shell",
      uncleanExit: "timed out after 5000 ms",
    });
    expect(env.PATH).toBe(`${shellPath}:/usr/sbin:/sbin`);
    expect(fakeSpawn.calls).toHaveLength(1);
    expect(warningLogger.warnings).toEqual([
      "/bin/zsh -ilc printed the user shell PATH for the packaged desktop app but did not exit cleanly (timed out after 5000 ms). Using the printed PATH.",
    ]);

    // The reporter's shape: a numeric non-zero status with the block printed.
    const statusEnv: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const statusResult = await ensurePackagedUserShellPath({
      env: statusEnv,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: createFakeSpawn([
        createSpawnResult({
          error: new Error("timed out after 5000 ms"),
          status: 13,
          stdout: shellPathOutput(shellPath),
        }),
      ]).spawn,
    });
    expect(statusResult).toMatchObject({
      kind: "updated",
      source: "interactive-login-shell",
      uncleanExit: "timed out after 5000 ms",
    });
    expect(statusEnv.PATH).toBe(`${shellPath}:/usr/sbin:/sbin`);
  });

  it("falls back to the non-interactive login shell when the interactive probe times out", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(),
      createSpawnResult({
        stdout: shellPathOutput("/Users/sawyerhood/.volta/bin:/usr/bin:/bin"),
      }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({
      appended: [],
      failures: [
        {
          flags: "-ilc",
          message: "failed: timed out after 5000 ms",
          reason: "shell-error",
          shell: "/bin/zsh",
        },
      ],
      kind: "updated",
      path: "/Users/sawyerhood/.volta/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      shell: "/bin/zsh",
      source: "login-shell",
      uncleanExit: null,
    });
    expect(env.PATH).toBe(
      "/Users/sawyerhood/.volta/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
    expect(
      fakeSpawn.calls.map((call) => [call.command, call.args, call.timeoutMs]),
    ).toEqual([
      ["/bin/zsh", ["-ilc", SHELL_PATH_COMMAND], 5_000],
      ["/bin/zsh", ["-lc", SHELL_PATH_COMMAND], 3_000],
    ]);
    expect(warningLogger.warnings).toEqual([
      "Could not load the user shell PATH for the packaged desktop app: /bin/zsh -ilc failed: timed out after 5000 ms. Using the non-interactive login shell PATH from /bin/zsh -lc instead.",
    ]);
  });

  it("appends existing tool directories when the interactive stage fails and the login shell succeeds", async () => {
    // zsh -lc skips ~/.zshrc, which is where nvm and Volta install their PATH
    // hooks, so the profile PATH usually has Homebrew but no managed node.
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const voltaBin = join(HOME_DIR, ".volta", "bin");
    const nvmBin = join(NVM_VERSIONS_DIR, "v22.11.0", "bin");
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(),
      createSpawnResult({ stdout: shellPathOutput(HOMEBREW_PROFILE_PATH) }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({
        directories: [voltaBin, nvmBin, "/opt/homebrew/bin", "/usr/local/bin"],
      }),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      appended: [voltaBin, nvmBin],
      kind: "updated",
      path: `${HOMEBREW_PROFILE_PATH}:${voltaBin}:${nvmBin}`,
      source: "login-shell",
    });
    expect(env.PATH).toBe(`${HOMEBREW_PROFILE_PATH}:${voltaBin}:${nvmBin}`);
    expect(warningLogger.warnings).toEqual([
      `Could not load the user shell PATH for the packaged desktop app: /bin/zsh -ilc failed: timed out after 5000 ms. Using the non-interactive login shell PATH from /bin/zsh -lc instead plus existing tool directories: ${voltaBin}, ${nvmBin}.`,
    ]);
  });

  it("treats a truncated PATH block as a failed stage", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(`Welcome\n${START_MARKER}\nPATH=/opt/homebrew/bin`),
      createSpawnResult({
        stdout: shellPathOutput("/usr/local/bin:/usr/bin:/bin"),
      }),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      failures: [
        {
          flags: "-ilc",
          message: "failed: timed out after 5000 ms",
          reason: "shell-error",
          shell: "/bin/zsh",
        },
      ],
      kind: "updated",
      source: "login-shell",
    });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("treats a shell that exits without printing the block as a failed stage", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ stdout: "Welcome to my shell\n" }),
      createSpawnResult({
        stdout: shellPathOutput("/usr/local/bin:/usr/bin:/bin"),
      }),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      failures: [
        {
          flags: "-ilc",
          message: "exited without printing its PATH",
          reason: "missing-output",
          shell: "/bin/zsh",
        },
      ],
      kind: "updated",
      source: "login-shell",
    });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("augments the inherited PATH with existing user tool directories when every shell stage fails", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(),
      createSpawnResult({ signal: "SIGKILL", status: null }),
    ]);
    const warningLogger = createWarningLogger();
    const voltaBin = join(HOME_DIR, ".volta", "bin");
    const miseShims = join(HOME_DIR, ".local", "share", "mise", "shims");
    const pnpmHome = join(HOME_DIR, "Library", "pnpm");
    const cargoBin = join(HOME_DIR, ".cargo", "bin");

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({
        directories: [
          "/opt/homebrew/bin",
          pnpmHome,
          miseShims,
          voltaBin,
          cargoBin,
        ],
        // A candidate that exists as a file, not a directory, is skipped.
        files: { [cargoBin]: "" },
      }),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    // Version-manager directories rank ahead of Homebrew among the appended
    // entries, but all of them land after the inherited PATH.
    const appended = [voltaBin, miseShims, pnpmHome, "/opt/homebrew/bin"];
    expect(result).toEqual({
      appended,
      failures: [
        {
          flags: "-ilc",
          message: "failed: timed out after 5000 ms",
          reason: "shell-error",
          shell: "/bin/zsh",
        },
        {
          flags: "-lc",
          message: "exited from signal SIGKILL",
          reason: "signal",
          shell: "/bin/zsh",
        },
      ],
      kind: "augmented",
      path: `${LAUNCHD_PATH}:${appended.join(":")}`,
    });
    expect(env.PATH).toBe(`${LAUNCHD_PATH}:${appended.join(":")}`);
    expect(fakeSpawn.calls.map((call) => call.args[0])).toEqual([
      "-ilc",
      "-lc",
    ]);
    expect(warningLogger.warnings).toEqual([
      `Could not load the user shell PATH for the packaged desktop app: /bin/zsh -ilc failed: timed out after 5000 ms; /bin/zsh -lc exited from signal SIGKILL. Continuing with the inherited PATH plus existing tool directories: ${appended.join(", ")}.`,
    ]);
  });

  it("does not append tool directories that are already on the inherited PATH", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: `/opt/homebrew/bin:${LAUNCHD_PATH}`,
    };
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(),
      createTimedOutResult(),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({
        directories: ["/opt/homebrew/bin", "/usr/local/bin"],
      }),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      appended: ["/usr/local/bin"],
      kind: "augmented",
    });
    expect(env.PATH).toBe(`/opt/homebrew/bin:${LAUNCHD_PATH}:/usr/local/bin`);
  });

  it("keeps the inherited PATH and warns when no stage succeeds and no known tool directory exists", async () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ error: createSpawnError("/bin/zsh", "EAGAIN") }),
      createSpawnResult({ status: 1, stderr: "zsh: bad option\n" }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({
      failures: [
        {
          flags: "-ilc",
          message: "failed: spawn /bin/zsh EAGAIN",
          reason: "shell-error",
          shell: "/bin/zsh",
        },
        {
          flags: "-lc",
          message: "exited with status 1: zsh: bad option",
          reason: "non-zero-status",
          shell: "/bin/zsh",
        },
      ],
      kind: "unchanged",
    });
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(warningLogger.warnings).toEqual([
      "Could not load the user shell PATH for the packaged desktop app: /bin/zsh -ilc failed: spawn /bin/zsh EAGAIN; /bin/zsh -lc exited with status 1: zsh: bad option. Continuing with the inherited PATH.",
    ]);
  });

  it("retries with the platform default shell when the SHELL launchd passed cannot be started", async () => {
    // An uninstalled login shell (Homebrew fish removed, account record still
    // pointing at it) fails every stage with ENOENT; zsh is still there.
    const env: NodeJS.ProcessEnv = {
      PATH: LAUNCHD_PATH,
      SHELL: "/opt/homebrew/bin/fish",
    };
    const voltaBin = join(HOME_DIR, ".volta", "bin");
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({
        error: createSpawnError("/opt/homebrew/bin/fish", "ENOENT"),
      }),
      createSpawnResult({ stdout: shellPathOutput(HOMEBREW_PROFILE_PATH) }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({ directories: [voltaBin, "/opt/homebrew/bin"] }),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    // The missing shell is not retried with -lc: it would fail identically.
    expect(fakeSpawn.calls.map((call) => [call.command, call.args[0]])).toEqual(
      [
        ["/opt/homebrew/bin/fish", "-ilc"],
        ["/bin/zsh", "-ilc"],
      ],
    );
    expect(result).toEqual({
      appended: [voltaBin],
      failures: [
        {
          flags: "-ilc",
          message: "could not be started: spawn /opt/homebrew/bin/fish ENOENT",
          reason: "missing-shell",
          shell: "/opt/homebrew/bin/fish",
        },
      ],
      kind: "updated",
      path: `${HOMEBREW_PROFILE_PATH}:${voltaBin}`,
      shell: "/bin/zsh",
      source: "interactive-login-shell",
      uncleanExit: null,
    });
    expect(env.PATH).toBe(`${HOMEBREW_PROFILE_PATH}:${voltaBin}`);
    expect(warningLogger.warnings).toEqual([
      `Could not load the user shell PATH for the packaged desktop app: /opt/homebrew/bin/fish -ilc could not be started: spawn /opt/homebrew/bin/fish ENOENT; retried with the platform default shell /bin/zsh. Using the interactive login shell PATH from /bin/zsh -ilc instead plus existing tool directories: ${voltaBin}.`,
    ]);
  });

  it("names both shells when the platform default retry fails as well", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      SHELL: "/usr/bin/fish",
    };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ error: createSpawnError("/usr/bin/fish", "EACCES") }),
      createTimedOutResult(),
      createSpawnResult({ status: 127 }),
    ]);
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({ directories: ["/home/user/.local/bin"] }),
      homeDir: "/home/user",
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "linux",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(fakeSpawn.calls.map((call) => [call.command, call.args[0]])).toEqual(
      [
        ["/usr/bin/fish", "-ilc"],
        ["/bin/bash", "-ilc"],
        ["/bin/bash", "-lc"],
      ],
    );
    expect(result).toEqual({
      appended: ["/home/user/.local/bin"],
      failures: [
        {
          flags: "-ilc",
          message: "could not be started: spawn /usr/bin/fish EACCES",
          reason: "missing-shell",
          shell: "/usr/bin/fish",
        },
        {
          flags: "-ilc",
          message: "failed: timed out after 5000 ms",
          reason: "shell-error",
          shell: "/bin/bash",
        },
        {
          flags: "-lc",
          message: "exited with status 127",
          reason: "non-zero-status",
          shell: "/bin/bash",
        },
      ],
      kind: "augmented",
      path: "/usr/bin:/bin:/home/user/.local/bin",
    });
    expect(warningLogger.warnings).toEqual([
      "Could not load the user shell PATH for the packaged desktop app: /usr/bin/fish -ilc could not be started: spawn /usr/bin/fish EACCES; retried with the platform default shell /bin/bash: /bin/bash -ilc failed: timed out after 5000 ms; /bin/bash -lc exited with status 127. Continuing with the inherited PATH plus existing tool directories: /home/user/.local/bin.",
    ]);
  });

  it("does not retry when the missing shell already is the platform default", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH, SHELL: "/bin/zsh" };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ error: createSpawnError("/bin/zsh", "ENOENT") }),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(fakeSpawn.calls.map((call) => call.command)).toEqual(["/bin/zsh"]);
    expect(result).toMatchObject({
      failures: [{ reason: "missing-shell", shell: "/bin/zsh" }],
      kind: "unchanged",
    });
    expect(env.PATH).toBe(LAUNCHD_PATH);
  });

  it("treats an empty shell PATH as a failed stage", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ stdout: shellPathOutput("  ") }),
      createSpawnResult({
        stdout: shellPathOutput("/usr/local/bin:/usr/bin:/bin"),
      }),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      failures: [
        {
          flags: "-ilc",
          message: "printed an empty PATH",
          reason: "empty-output",
          shell: "/bin/zsh",
        },
      ],
      kind: "updated",
      source: "login-shell",
    });
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("resolves the nvm default alias chain to an installed Node version", async () => {
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(),
      createTimedOutResult(),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({
        directories: [
          join(NVM_VERSIONS_DIR, "v20.11.1", "bin"),
          join(NVM_VERSIONS_DIR, "v22.11.0", "bin"),
          join(NVM_VERSIONS_DIR, "v24.1.0", "bin"),
        ],
        files: {
          [join(HOME_DIR, ".nvm", "alias", "default")]: "lts/*\n",
          [join(HOME_DIR, ".nvm", "alias", "lts", "*")]: "lts/jod\n",
          [join(HOME_DIR, ".nvm", "alias", "lts", "jod")]: "v22.11.0\n",
        },
      }),
      homeDir: HOME_DIR,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toMatchObject({
      appended: [join(NVM_VERSIONS_DIR, "v22.11.0", "bin")],
      kind: "augmented",
    });
  });

  it("falls back to the newest installed nvm Node version for unresolvable or partial aliases", async () => {
    const directories = [
      join(NVM_VERSIONS_DIR, "v20.11.1", "bin"),
      join(NVM_VERSIONS_DIR, "v20.9.0", "bin"),
      join(NVM_VERSIONS_DIR, "v24.1.0", "bin"),
      join(NVM_VERSIONS_DIR, "v9.11.2", "bin"),
    ];
    const resolveAppended = async (
      files: Record<string, string>,
    ): Promise<string[]> => {
      const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
      const result = await ensurePackagedUserShellPath({
        env,
        fs: createFakeFs({ directories, files }),
        homeDir: HOME_DIR,
        isPackaged: true,
        logger: createWarningLogger().logger,
        platform: "darwin",
        spawnLoginShellPath: createFakeSpawn([
          createTimedOutResult(),
          createTimedOutResult(),
        ]).spawn,
      });
      return result.kind === "augmented" ? result.appended : [];
    };

    // `node` is an nvm built-in alias for the newest installed version.
    await expect(
      resolveAppended({
        [join(HOME_DIR, ".nvm", "alias", "default")]: "node\n",
      }),
    ).resolves.toEqual([join(NVM_VERSIONS_DIR, "v24.1.0", "bin")]);
    // No default alias at all: newest installed version, numerically sorted.
    await expect(resolveAppended({})).resolves.toEqual([
      join(NVM_VERSIONS_DIR, "v24.1.0", "bin"),
    ]);
    // A partial version alias selects the newest matching major.
    await expect(
      resolveAppended({
        [join(HOME_DIR, ".nvm", "alias", "default")]: "20\n",
      }),
    ).resolves.toEqual([join(NVM_VERSIONS_DIR, "v20.11.1", "bin")]);
  });

  it("does not append an nvm Node bin when the default alias opts out of nvm's node", async () => {
    // `nvm alias default system` keeps the system node on PATH at login, so
    // nothing under versions/node belongs there; `iojs`/`unstable` likewise
    // never point into versions/node. A non-nvm directory keeps the result
    // augmented so the absence of the nvm entry is what the test observes.
    const directories = [
      join(NVM_VERSIONS_DIR, "v22.11.0", "bin"),
      join(NVM_VERSIONS_DIR, "v24.1.0", "bin"),
      "/usr/local/bin",
    ];
    const resolveAppended = async (
      files: Record<string, string>,
    ): Promise<string[]> => {
      const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH };
      const result = await ensurePackagedUserShellPath({
        env,
        fs: createFakeFs({ directories, files }),
        homeDir: HOME_DIR,
        isPackaged: true,
        logger: createWarningLogger().logger,
        platform: "darwin",
        spawnLoginShellPath: createFakeSpawn([
          createTimedOutResult(),
          createTimedOutResult(),
        ]).spawn,
      });
      return result.kind === "augmented" ? result.appended : [];
    };

    await expect(
      resolveAppended({
        [join(HOME_DIR, ".nvm", "alias", "default")]: "system\n",
      }),
    ).resolves.toEqual(["/usr/local/bin"]);
    // The chain is followed to the built-in, not cut at the first hop.
    await expect(
      resolveAppended({
        [join(HOME_DIR, ".nvm", "alias", "default")]: "mine\n",
        [join(HOME_DIR, ".nvm", "alias", "mine")]: "unstable\n",
      }),
    ).resolves.toEqual(["/usr/local/bin"]);
    // `stable` still means the newest installed version.
    await expect(
      resolveAppended({
        [join(HOME_DIR, ".nvm", "alias", "default")]: "stable\n",
      }),
    ).resolves.toEqual([
      join(NVM_VERSIONS_DIR, "v24.1.0", "bin"),
      "/usr/local/bin",
    ]);
  });

  it("leaves PATH alone in desktop dev mode", async () => {
    const env: NodeJS.ProcessEnv = { PATH: "/opt/homebrew/bin:/usr/bin:/bin" };
    const warningLogger = createWarningLogger();

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({ directories: ["/usr/local/bin"] }),
      homeDir: HOME_DIR,
      isPackaged: false,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({ kind: "skipped", reason: "not-packaged" });
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(warningLogger.warnings).toEqual([]);
  });

  it("uses the configured Linux login shell", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      SHELL: "/usr/bin/fish",
    };
    const shellPath = "/home/user/.local/bin:/usr/bin:/bin";
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({ stdout: shellPathOutput(shellPath) }),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: "/home/user",
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "linux",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({
      appended: [],
      failures: [],
      kind: "updated",
      path: shellPath,
      shell: "/usr/bin/fish",
      source: "interactive-login-shell",
      uncleanExit: null,
    });
    expect(env.PATH).toBe(shellPath);
    expect(fakeSpawn.calls).toEqual([
      {
        args: ["-ilc", SHELL_PATH_COMMAND],
        command: "/usr/bin/fish",
        timeoutMs: 5_000,
      },
    ]);
  });

  it("stages and augments Linux launches the same way as macOS", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/bash",
    };
    const fakeSpawn = createFakeSpawn([
      createTimedOutResult(),
      createTimedOutResult(),
    ]);

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs({
        directories: [
          "/home/linuxbrew/.linuxbrew/bin",
          "/home/user/.local/bin",
        ],
      }),
      homeDir: "/home/user",
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "linux",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(fakeSpawn.calls.map((call) => [call.command, call.args[0]])).toEqual(
      [
        ["/bin/bash", "-ilc"],
        ["/bin/bash", "-lc"],
      ],
    );
    expect(result).toMatchObject({
      appended: ["/home/user/.local/bin", "/home/linuxbrew/.linuxbrew/bin"],
      kind: "augmented",
    });
    expect(env.PATH).toBe(
      "/usr/bin:/bin:/home/user/.local/bin:/home/linuxbrew/.linuxbrew/bin",
    );
  });

  it("falls back to bash when Linux SHELL is unset", async () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const fakeSpawn = createFakeSpawn([
      createSpawnResult({
        stdout: shellPathOutput("/home/user/bin:/usr/bin:/bin"),
      }),
    ]);

    await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: "/home/user",
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "linux",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(fakeSpawn.calls[0]?.command).toBe("/bin/bash");
  });

  it("skips unsupported platforms", async () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };

    const result = await ensurePackagedUserShellPath({
      env,
      fs: createFakeFs(),
      homeDir: "C:\\Users\\user",
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "win32",
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({
      kind: "skipped",
      reason: "unsupported-platform",
    });
    expect(env.PATH).toBe("C:\\Windows\\System32");
  });
});

describe.skipIf(process.platform === "win32")(
  "desktop shell PATH probe against real shells",
  () => {
    const tempRoots: string[] = [];

    afterAll(async () => {
      for (const root of tempRoots.splice(0)) {
        await rm(root, { force: true, recursive: true });
      }
    });

    async function createFakeLoginShell(contents: string): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "bb-desktop-shell-path-"));
      tempRoots.push(root);
      const path = join(root, "fake-login-shell");
      await writeFile(path, contents, "utf8");
      await chmod(path, 0o755);
      return path;
    }

    it("settles when the shell exits even though a background job keeps stdout open", async () => {
      // The job outlives the budget, so settling on pipe close instead of on
      // the shell's exit would surface here as a timeout with SIGKILL.
      const startedAt = Date.now();

      const result = await defaultSpawnLoginShellPath({
        args: ["-c", 'printf "%s" hello; sleep 10 & exit 0'],
        command: "/bin/bash",
        timeoutMs: 2_000,
      });

      expect(result).toEqual({
        signal: null,
        status: 0,
        stderr: "",
        stdout: "hello",
      });
      // Loose upper bound: the real cost is the 250 ms pipe grace.
      expect(Date.now() - startedAt).toBeLessThan(2_000);
    });

    it("surfaces a missing shell as a spawn error that carries its errno", async () => {
      // The retry with the platform default shell keys on this code; a
      // wrapper that rethrew a plain Error would silently disable it.
      const result = await defaultSpawnLoginShellPath({
        args: ["-ilc", "true"],
        command: "/nonexistent/bb-login-shell",
        timeoutMs: 2_000,
      });

      expect(result).toMatchObject({
        error: expect.objectContaining({ code: "ENOENT" }),
        signal: null,
        status: null,
        stdout: "",
      });
    });

    it("kills a shell that ignores SIGTERM once its budget expires", async () => {
      const startedAt = Date.now();

      const result = await defaultSpawnLoginShellPath({
        args: ["-c", "trap '' TERM; printf '%s' partial; sleep 5"],
        command: "/bin/bash",
        timeoutMs: 300,
      });

      expect(result).toMatchObject({
        error: expect.objectContaining({ message: "timed out after 300 ms" }),
        signal: "SIGKILL",
        status: null,
        stdout: "partial",
      });
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(290);
      expect(elapsedMs).toBeLessThan(2_000);
    });

    it(
      "loads the PATH from a login shell that prints a banner and leaves a background job",
      { timeout: 10_000 },
      async () => {
        // Stand-in for a user's login shell: a banner on stdout, a PATH
        // extension, a background job inheriting stdout that outlives the 5 s
        // interactive budget, then the probe command. The test timeout exceeds
        // that budget so a pipe-close regression is reported by the shape
        // assertion below (an unclean exit) rather than by vitest's own timeout.
        const shell = await createFakeLoginShell(`#!/bin/bash
echo "Welcome to my shell"
export PATH="/fake/tools/bin:$PATH"
sleep 10 &
eval "\${@: -1}"
`);
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", SHELL: shell };
        const warningLogger = createWarningLogger();
        const startedAt = Date.now();

        const result = await ensurePackagedUserShellPath({
          env,
          fs: createFakeFs(),
          homeDir: HOME_DIR,
          isPackaged: true,
          logger: warningLogger.logger,
          platform: process.platform,
        });

        expect(result).toMatchObject({
          appended: [],
          failures: [],
          kind: "updated",
          source: "interactive-login-shell",
          uncleanExit: null,
        });
        const entries = (env.PATH ?? "").split(":");
        expect(entries[0]).toBe("/fake/tools/bin");
        expect(entries).toContain("/usr/bin");
        expect(env.PATH).not.toContain("\n");
        expect(env.PATH).not.toContain("Welcome");
        expect(warningLogger.warnings).toEqual([]);
        expect(Date.now() - startedAt).toBeLessThan(2_500);
      },
    );
  },
);
