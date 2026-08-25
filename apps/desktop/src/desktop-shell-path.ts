import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const MACOS_DEFAULT_SHELL = "/bin/zsh";
const LINUX_DEFAULT_SHELL = "/bin/bash";
const SHELL_PATH_START_MARKER = "__BB_DESKTOP_SHELL_PATH_START__";
const SHELL_PATH_END_MARKER = "__BB_DESKTOP_SHELL_PATH_END__";
// The markers fence the PATH line so banners, `nvm use` hooks, and other
// login output on stdout cannot be mistaken for it. The leading newline
// detaches the start marker from output that ends without one.
const SHELL_PATH_COMMAND = `printf '\\n%s\\nPATH=%s\\n%s\\n' '${SHELL_PATH_START_MARKER}' "$PATH" '${SHELL_PATH_END_MARKER}'`;
// An interactive login shell sources ~/.zshrc (brew shellenv, nvm, volta),
// which is where macOS users usually extend PATH, so it runs first. It also
// pays for completion and prompt-framework startup, hence the larger budget.
const INTERACTIVE_SHELL_PATH_TIMEOUT_MS = 5_000;
// A non-interactive login shell sources only the profile files and is the
// cheaper second stage when the interactive one hangs or times out.
const LOGIN_SHELL_PATH_TIMEOUT_MS = 3_000;
// A login file can leave a background job holding the shell's stdout open
// after the shell itself has exited. Once the shell exits, its output is in
// the pipe; this is how long to keep reading it before settling.
const SHELL_EXIT_PIPE_GRACE_MS = 250;
const NVM_ALIAS_MAX_HOPS = 8;
const NVM_INSTALLED_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/u;
const NVM_VERSION_ALIAS_PATTERN = /^v?\d+(?:\.\d+){0,2}$/u;
// nvm's built-in aliases have no alias file. `node` and `stable` mean the
// newest installed version; `system` means the user opted out of nvm's node,
// and `iojs`/`unstable` name io.js and odd-numbered releases that nvm keeps
// outside versions/node, so none of these three adds a Node bin directory.
const NVM_NEWEST_INSTALLED_ALIASES = new Set(["node", "stable"]);
const NVM_UNMANAGED_ALIASES = new Set(["system", "iojs", "unstable"]);

export interface DesktopShellPathLogger {
  warn(message: string): void;
}

export interface DesktopShellPathFs {
  isDirectory(path: string): boolean;
  /** Names inside `path`; empty when it is missing or unreadable. */
  listDirectory(path: string): string[];
  /** File contents; `null` when it is missing or unreadable. */
  readTextFile(path: string): string | null;
}

export interface SpawnLoginShellPathArgs {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface ShellPathSpawnResult {
  /** Set when the shell could not be started or did not exit within budget. */
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  /** Everything the shell wrote before the result settled, complete or not. */
  stdout: string;
}

export type SpawnLoginShellPath = (
  args: SpawnLoginShellPathArgs,
) => Promise<ShellPathSpawnResult>;

export interface ShellPathStageFailure {
  flags: ShellPathStageFlags;
  message: string;
  /**
   * `missing-shell` is a spawn error of ENOENT or EACCES: the shell binary
   * itself could not be started, so every stage with it would fail the same
   * way. Other spawn errors and timeouts are `shell-error`.
   */
  reason:
    | "empty-output"
    | "missing-output"
    | "missing-shell"
    | "non-zero-status"
    | "shell-error"
    | "signal";
  shell: string;
}

export type EnsurePackagedUserShellPathResult =
  | ShellPathAugmentedResult
  | ShellPathSkippedResult
  | ShellPathUnchangedResult
  | ShellPathUpdatedResult;

type ShellPathStageFlags = "-ilc" | "-lc";
type ShellPathSource = "interactive-login-shell" | "login-shell";

interface ShellPathStage {
  flags: ShellPathStageFlags;
  source: ShellPathSource;
  timeoutMs: number;
}

interface EnsurePackagedUserShellPathArgs {
  env: NodeJS.ProcessEnv;
  fs?: DesktopShellPathFs;
  homeDir: string;
  isPackaged: boolean;
  logger: DesktopShellPathLogger;
  platform: NodeJS.Platform;
  spawnLoginShellPath?: SpawnLoginShellPath;
}

interface ShellPathAugmentedResult {
  appended: string[];
  failures: ShellPathStageFailure[];
  kind: "augmented";
  path: string;
}

interface ShellPathSkippedResult {
  kind: "skipped";
  reason: "not-packaged" | "unsupported-platform";
}

interface ShellPathUnchangedResult {
  failures: ShellPathStageFailure[];
  kind: "unchanged";
}

interface ShellPathUpdatedResult {
  /**
   * Existing tool directories appended because an earlier stage failed and
   * the one that succeeded may not source the files that add them. Empty
   * when the first stage succeeded.
   */
  appended: string[];
  failures: ShellPathStageFailure[];
  kind: "updated";
  path: string;
  /**
   * The shell that printed the PATH: `$SHELL`, or the platform default when
   * `$SHELL` could not be started and the stages were retried with it.
   */
  shell: string;
  source: ShellPathSource;
  /**
   * How the stage that printed the PATH then failed to exit cleanly (timed
   * out, signalled, non-zero status); `null` when it exited cleanly.
   */
  uncleanExit: string | null;
}

interface KnownToolDirectoriesArgs {
  fs: DesktopShellPathFs;
  homeDir: string;
  platform: NodeJS.Platform;
}

interface ShellExitProblem {
  detail: string;
  message: string;
  reason: ShellPathStageFailure["reason"];
}

type ShellPathOutput =
  | { kind: "empty" }
  | { kind: "missing" }
  | { kind: "path"; path: string };

type ShellPathStageOutcome =
  | { kind: "failure"; failure: ShellPathStageFailure }
  | { kind: "success"; path: string; uncleanExit: string | null };

interface ShellPathStageSuccess {
  flags: ShellPathStageFlags;
  path: string;
  shell: string;
  source: ShellPathSource;
  uncleanExit: string | null;
}

/** Every stage run with one shell, in order, up to the first success. */
interface ShellPathProbeRun {
  failures: ShellPathStageFailure[];
  shell: string;
  success: ShellPathStageSuccess | null;
}

const SHELL_PATH_STAGES: readonly ShellPathStage[] = [
  {
    flags: "-ilc",
    source: "interactive-login-shell",
    timeoutMs: INTERACTIVE_SHELL_PATH_TIMEOUT_MS,
  },
  {
    flags: "-lc",
    source: "login-shell",
    timeoutMs: LOGIN_SHELL_PATH_TIMEOUT_MS,
  },
];

const defaultDesktopShellPathFs: DesktopShellPathFs = {
  isDirectory(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  listDirectory(path) {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  readTextFile(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runs the shell with stdin closed (an rc file that reads from it cannot
 * block the probe) and settles as soon as the shell exits, after a short
 * grace to drain its pipes: waiting for the pipes to close would let a
 * background job started by a login file hold the probe until the budget
 * expires. A shell that has not exited by the budget is SIGKILLed so a TERM
 * trap cannot extend it; whatever it printed is still returned.
 */
export function defaultSpawnLoginShellPath(
  args: SpawnLoginShellPathArgs,
): Promise<ShellPathSpawnResult> {
  return new Promise<ShellPathSpawnResult>((resolveSpawn) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess;

    function settle(
      result: Omit<ShellPathSpawnResult, "stderr" | "stdout">,
    ): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(budgetTimer);
      clearTimeout(graceTimer);
      // Release the pipes: a lingering background job may keep them open.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolveSpawn({ ...result, stderr, stdout });
    }

    try {
      child = spawn(args.command, args.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolveSpawn({
        error: toError(error),
        signal: null,
        status: null,
        stderr,
        stdout,
      });
      return;
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({ error, signal: null, status: null });
    });
    child.on("exit", (status, signal) => {
      if (settled) {
        return;
      }
      clearTimeout(budgetTimer);
      graceTimer = setTimeout(() => {
        settle({ signal, status });
      }, SHELL_EXIT_PIPE_GRACE_MS);
    });
    child.on("close", (status, signal) => {
      settle({ signal, status });
    });
    budgetTimer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({
        error: new Error(`timed out after ${args.timeoutMs} ms`),
        signal: "SIGKILL",
        status: null,
      });
    }, args.timeoutMs);
  });
}

function parseShellPathOutput(stdout: string): ShellPathOutput {
  const lines = stdout.split(/\r?\n/u);
  const startIndex = lines.findIndex(
    (line) => line.trim() === SHELL_PATH_START_MARKER,
  );
  if (startIndex === -1) {
    return { kind: "missing" };
  }
  const endIndex = lines.findIndex(
    (line, index) =>
      index > startIndex && line.trim() === SHELL_PATH_END_MARKER,
  );
  if (endIndex === -1) {
    return { kind: "missing" };
  }
  const pathLine = lines
    .slice(startIndex + 1, endIndex)
    .find((line) => line.startsWith("PATH="));
  if (pathLine === undefined) {
    return { kind: "missing" };
  }
  const path = pathLine.slice("PATH=".length).trim();
  return path.length === 0 ? { kind: "empty" } : { kind: "path", path };
}

/** Node reports a missing or non-executable command as an errno on the error. */
function isMissingShellError(error: Error): boolean {
  if (!("code" in error)) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "EACCES";
}

function classifyShellExit(
  result: ShellPathSpawnResult,
): ShellExitProblem | null {
  if (result.error !== undefined) {
    if (isMissingShellError(result.error)) {
      return {
        detail: result.error.message,
        message: `could not be started: ${result.error.message}`,
        reason: "missing-shell",
      };
    }
    return {
      detail: result.error.message,
      message: `failed: ${result.error.message}`,
      reason: "shell-error",
    };
  }
  if (result.signal !== null) {
    return {
      detail: `signal ${result.signal}`,
      message: `exited from signal ${result.signal}`,
      reason: "signal",
    };
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return {
      detail: `status ${result.status}`,
      message:
        stderr.length > 0
          ? `exited with status ${result.status}: ${stderr}`
          : `exited with status ${result.status}`,
      reason: "non-zero-status",
    };
  }
  return null;
}

function stageFailure(
  shell: string,
  stage: ShellPathStage,
  reason: ShellPathStageFailure["reason"],
  message: string,
): ShellPathStageOutcome {
  return {
    failure: { flags: stage.flags, message, reason, shell },
    kind: "failure",
  };
}

/**
 * A complete marker block is authoritative: the shell only prints it after
 * every login file has run, so the PATH is valid even when the shell then
 * hung, was killed at the budget, or exited non-zero.
 */
async function runShellPathStage(
  spawnLoginShellPath: SpawnLoginShellPath,
  shell: string,
  stage: ShellPathStage,
): Promise<ShellPathStageOutcome> {
  const result = await spawnLoginShellPath({
    args: [stage.flags, SHELL_PATH_COMMAND],
    command: shell,
    timeoutMs: stage.timeoutMs,
  });
  const output = parseShellPathOutput(result.stdout);
  const exitProblem = classifyShellExit(result);
  if (output.kind === "path") {
    return {
      kind: "success",
      path: output.path,
      uncleanExit: exitProblem === null ? null : exitProblem.detail,
    };
  }
  if (exitProblem !== null) {
    return stageFailure(shell, stage, exitProblem.reason, exitProblem.message);
  }
  if (output.kind === "empty") {
    return stageFailure(shell, stage, "empty-output", "printed an empty PATH");
  }
  return stageFailure(
    shell,
    stage,
    "missing-output",
    "exited without printing its PATH",
  );
}

/**
 * Runs the stages with one shell until one prints a PATH. A `missing-shell`
 * failure ends the run early: the binary cannot be started, so the remaining
 * stages would fail identically.
 */
async function runShellPathStages(
  spawnLoginShellPath: SpawnLoginShellPath,
  shell: string,
): Promise<ShellPathProbeRun> {
  const failures: ShellPathStageFailure[] = [];
  for (const stage of SHELL_PATH_STAGES) {
    const outcome = await runShellPathStage(spawnLoginShellPath, shell, stage);
    if (outcome.kind === "success") {
      return {
        failures,
        shell,
        success: {
          flags: stage.flags,
          path: outcome.path,
          shell,
          source: stage.source,
          uncleanExit: outcome.uncleanExit,
        },
      };
    }
    failures.push(outcome.failure);
    if (outcome.failure.reason === "missing-shell") {
      break;
    }
  }
  return { failures, shell, success: null };
}

function formatStageFailures(failures: ShellPathStageFailure[]): string {
  return failures
    .map((failure) => `${failure.shell} ${failure.flags} ${failure.message}`)
    .join("; ");
}

/** The failed stages in the order they ran, naming the retry shell. */
function formatProbeFailures(
  configuredRun: ShellPathProbeRun,
  retryRun: ShellPathProbeRun | null,
): string {
  let summary = formatStageFailures(configuredRun.failures);
  if (retryRun !== null) {
    summary += `; retried with the platform default shell ${retryRun.shell}`;
    if (retryRun.failures.length > 0) {
      summary += `: ${formatStageFailures(retryRun.failures)}`;
    }
  }
  return summary;
}

function describeShellPathSource(source: ShellPathSource): string {
  return source === "interactive-login-shell"
    ? "interactive login shell"
    : "non-interactive login shell";
}

function splitPathEntries(value: string): string[] {
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

function mergePathEntries(...entryLists: string[][]): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const entries of entryLists) {
    for (const entry of entries) {
      if (seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      merged.push(entry);
    }
  }
  return merged.join(delimiter);
}

function compareNvmVersionsDescending(left: string, right: string): number {
  const leftParts = left.slice(1).split(".").map(Number);
  const rightParts = right.slice(1).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Resolves nvm's default Node `bin` directory without running nvm. nvm keeps
 * aliases as files whose content is either a version (`v22.11.0`, `22`) or
 * another alias (`default` -> `lts/*` -> `lts/jod` -> `v22.11.0`). A chain
 * that ends at the built-in `node` or `stable`, or a `default` alias that is
 * missing or broken, resolves to the newest installed version; a chain that
 * ends at `system`, `iojs`, or `unstable` resolves to nothing, because the
 * user's login does not put a versions/node `bin` on PATH.
 */
function resolveNvmDefaultNodeBin(
  homeDir: string,
  fs: DesktopShellPathFs,
): string | null {
  const nvmDir = join(homeDir, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  const installed = fs
    .listDirectory(versionsDir)
    .filter((name) => NVM_INSTALLED_VERSION_PATTERN.test(name))
    .sort(compareNvmVersionsDescending);
  const newest = installed[0];
  if (newest === undefined) {
    return null;
  }

  let alias = "default";
  for (let hop = 0; hop < NVM_ALIAS_MAX_HOPS; hop += 1) {
    const target = fs.readTextFile(join(nvmDir, "alias", alias))?.trim();
    if (target === undefined || target.length === 0) {
      break;
    }
    if (NVM_UNMANAGED_ALIASES.has(target)) {
      return null;
    }
    if (NVM_NEWEST_INSTALLED_ALIASES.has(target)) {
      break;
    }
    if (NVM_VERSION_ALIAS_PATTERN.test(target)) {
      const prefix = target.startsWith("v") ? target : `v${target}`;
      const match = installed.find(
        (version) => version === prefix || version.startsWith(`${prefix}.`),
      );
      return join(versionsDir, match ?? newest, "bin");
    }
    alias = target;
  }
  return join(versionsDir, newest, "bin");
}

/**
 * Well-known user tool directories that exist on disk, in the order their
 * shell hooks usually prepend themselves: version managers, then language
 * toolchains, then Homebrew and /usr/local. That order only ranks these
 * directories among themselves. The caller appends them after the probed or
 * inherited PATH, so they fill in what that PATH lacks and never shadow it: a
 * Homebrew `node` the login shell already reported keeps winning over a
 * version-managed one appended here.
 */
function knownToolDirectories(args: KnownToolDirectoriesArgs): string[] {
  const { fs, homeDir } = args;
  const nvmNodeBin = resolveNvmDefaultNodeBin(homeDir, fs);
  const candidates = [
    join(homeDir, ".volta", "bin"),
    ...(nvmNodeBin === null ? [] : [nvmNodeBin]),
    join(homeDir, ".local", "share", "fnm", "aliases", "default", "bin"),
    join(
      homeDir,
      "Library",
      "Application Support",
      "fnm",
      "aliases",
      "default",
      "bin",
    ),
    join(homeDir, ".fnm", "aliases", "default", "bin"),
    join(homeDir, ".local", "share", "mise", "shims"),
    join(homeDir, ".asdf", "shims"),
    join(homeDir, ".nodenv", "shims"),
    join(homeDir, ".n", "bin"),
    join(homeDir, ".proto", "shims"),
    // pnpm's default PNPM_HOME, where `pnpm add -g` and `pnpm env` put binaries.
    ...(args.platform === "darwin"
      ? [join(homeDir, "Library", "pnpm")]
      : [join(homeDir, ".local", "share", "pnpm")]),
    join(homeDir, ".bun", "bin"),
    join(homeDir, ".deno", "bin"),
    join(homeDir, ".cargo", "bin"),
    join(homeDir, "go", "bin"),
    join(homeDir, ".local", "bin"),
    join(homeDir, "bin"),
    ...(args.platform === "darwin"
      ? ["/opt/homebrew/bin", "/opt/homebrew/sbin"]
      : ["/home/linuxbrew/.linuxbrew/bin", "/snap/bin"]),
    "/usr/local/bin",
  ];
  return candidates.filter((candidate) => fs.isDirectory(candidate));
}

function platformDefaultShell(platform: NodeJS.Platform): string {
  return platform === "darwin" ? MACOS_DEFAULT_SHELL : LINUX_DEFAULT_SHELL;
}

/**
 * The user's login shell when the launcher passed one (launchd and desktop
 * sessions set `SHELL` from the account record), taken verbatim, otherwise
 * the platform default; the host daemon's resolveUserShellPath makes the same
 * choice. Whether the shell can actually run is learned from the probe.
 */
function resolveShellCommand(args: EnsurePackagedUserShellPathArgs): string {
  const configuredShell = args.env.SHELL?.trim();
  if (configuredShell !== undefined && configuredShell.length > 0) {
    return configuredShell;
  }
  return platformDefaultShell(args.platform);
}

/**
 * Loads the user's shell PATH into `args.env` for packaged GUI launches, which
 * inherit launchd's `/usr/bin:/bin:/usr/sbin:/sbin` on macOS (and a similarly
 * bare PATH from a Linux desktop session).
 *
 * Stages run in order until one prints a PATH: interactive login shell, then
 * non-interactive login shell, with `$SHELL`. When `$SHELL` itself cannot be
 * started (ENOENT or EACCES: a login shell that was uninstalled or an account
 * record pointing at a stale path) and differs from the platform default, the
 * stages run once more with the platform default shell. The probed PATH is
 * merged with the inherited one (probed entries first, inherited entries that
 * are missing appended) so nothing the parent already had is lost. When an
 * earlier stage failed, existing well-known tool directories are appended as
 * well, because the stage that succeeded may not source the files that
 * usually add them; when every stage fails they are appended to the inherited
 * PATH instead, so the server, host daemon, and plugins can still find
 * `node`, `gh`, and provider CLIs. Every fallback is logged at warn; startup
 * stays bounded by the sum of the stage budgets.
 */
export async function ensurePackagedUserShellPath(
  args: EnsurePackagedUserShellPathArgs,
): Promise<EnsurePackagedUserShellPathResult> {
  if (args.platform !== "darwin" && args.platform !== "linux") {
    return { kind: "skipped", reason: "unsupported-platform" };
  }
  if (!args.isPackaged) {
    return { kind: "skipped", reason: "not-packaged" };
  }

  const spawnLoginShellPath =
    args.spawnLoginShellPath ?? defaultSpawnLoginShellPath;
  const fs = args.fs ?? defaultDesktopShellPathFs;
  const configuredShell = resolveShellCommand(args);
  const defaultShell = platformDefaultShell(args.platform);
  const inheritedEntries = splitPathEntries(args.env.PATH ?? "");

  const configuredRun = await runShellPathStages(
    spawnLoginShellPath,
    configuredShell,
  );
  const retryRun =
    configuredRun.success === null &&
    configuredShell !== defaultShell &&
    configuredRun.failures.some((failure) => failure.reason === "missing-shell")
      ? await runShellPathStages(spawnLoginShellPath, defaultShell)
      : null;
  const failures = [...configuredRun.failures, ...(retryRun?.failures ?? [])];
  const success = retryRun === null ? configuredRun.success : retryRun.success;
  const failureSummary = `Could not load the user shell PATH for the packaged desktop app: ${formatProbeFailures(configuredRun, retryRun)}`;

  if (success !== null) {
    const probedEntries = splitPathEntries(success.path);
    const present = new Set([...probedEntries, ...inheritedEntries]);
    const appended =
      failures.length === 0
        ? []
        : knownToolDirectories({
            fs,
            homeDir: args.homeDir,
            platform: args.platform,
          }).filter((directory) => !present.has(directory));
    const path = mergePathEntries(probedEntries, inheritedEntries, appended);
    if (success.uncleanExit !== null) {
      args.logger.warn(
        `${success.shell} ${success.flags} printed the user shell PATH for the packaged desktop app but did not exit cleanly (${success.uncleanExit}). Using the printed PATH.`,
      );
    }
    if (failures.length > 0) {
      args.logger.warn(
        `${failureSummary}. Using the ${describeShellPathSource(success.source)} PATH from ${success.shell} ${success.flags} instead${
          appended.length > 0
            ? ` plus existing tool directories: ${appended.join(", ")}`
            : ""
        }.`,
      );
    }
    args.env.PATH = path;
    return {
      appended,
      failures,
      kind: "updated",
      path,
      shell: success.shell,
      source: success.source,
      uncleanExit: success.uncleanExit,
    };
  }

  const appended = knownToolDirectories({
    fs,
    homeDir: args.homeDir,
    platform: args.platform,
  }).filter((directory) => !inheritedEntries.includes(directory));
  if (appended.length === 0) {
    args.logger.warn(`${failureSummary}. Continuing with the inherited PATH.`);
    return { failures, kind: "unchanged" };
  }

  const path = mergePathEntries(inheritedEntries, appended);
  args.logger.warn(
    `${failureSummary}. Continuing with the inherited PATH plus existing tool directories: ${appended.join(", ")}.`,
  );
  args.env.PATH = path;
  return { appended, failures, kind: "augmented", path };
}
