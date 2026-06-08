import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  createTerminalSession,
  listTerminalSessionsByThread,
  markActiveTerminalSessionExited,
  markEnvironmentTerminalSessionsExited,
  markTerminalSessionUserInput,
  markTerminalSessionRunning,
  markThreadTerminalSessionsExited,
} from "../../src/data/terminal-sessions.js";
import { createEnvironment } from "../../src/data/environments.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";

type TestDb = ReturnType<typeof createConnection>;
type TestEnvironment = ReturnType<typeof createEnvironment>;
type TestThread = ReturnType<typeof createThread>;

interface TerminalSessionFixture {
  db: TestDb;
  environment: TestEnvironment;
  thread: TestThread;
}

const LOCAL_HOST_ID = "local";

function setup(): TerminalSessionFixture {
  const db = createConnection(":memory:");
  migrate(db);
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: LOCAL_HOST_ID, path: "/tmp/project" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: LOCAL_HOST_ID,
    path: "/tmp/workspace",
    status: "ready",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    branchName: "main",
    baseBranch: null,
    defaultBranch: "main",
    mergeBaseBranch: null,
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
    status: "idle",
  });
  return {
    db,
    environment,
    thread,
  };
}

function createStartingTerminal(fixture: TerminalSessionFixture) {
  return createTerminalSession(fixture.db, {
    cols: 80,
    currentCwd: null,
    environmentId: fixture.environment.id,
    hostId: LOCAL_HOST_ID,
    initialCwd: "/tmp/workspace",
    rows: 24,
    status: "starting",
    threadId: fixture.thread.id,
    title: "Terminal 1",
  });
}

describe("terminal sessions", () => {
  it("marks a starting terminal running", () => {
    const fixture = setup();
    const terminal = createStartingTerminal(fixture);

    const running = markTerminalSessionRunning(fixture.db, {
      cols: 100,
      currentCwd: null,
      initialCwd: "/tmp/workspace",
      rows: 30,
      terminalId: terminal.id,
      title: "zsh",
    });

    expect(running).toMatchObject({
      id: terminal.id,
      status: "running",
      cols: 100,
      rows: 30,
      title: "zsh",
    });
  });

  it("does not resurrect a terminal exited by thread deletion", () => {
    const fixture = setup();
    const terminal = createStartingTerminal(fixture);
    markThreadTerminalSessionsExited(fixture.db, {
      threadId: fixture.thread.id,
      closeReason: "thread-deleted",
    });

    const running = markTerminalSessionRunning(fixture.db, {
      cols: 100,
      currentCwd: null,
      initialCwd: "/tmp/workspace",
      rows: 30,
      terminalId: terminal.id,
      title: "zsh",
    });

    expect(running).toBeNull();
    expect(listTerminalSessionsByThread(fixture.db, fixture.thread.id)).toEqual([
      expect.objectContaining({
        id: terminal.id,
        closeReason: "thread-deleted",
        status: "exited",
      }),
    ]);
  });

  it("marks a terminal dirty on first user input only", () => {
    const fixture = setup();
    const terminal = createStartingTerminal(fixture);

    const firstInput = markTerminalSessionUserInput(fixture.db, {
      terminalId: terminal.id,
      threadId: fixture.thread.id,
      now: 10,
    });
    const secondInput = markTerminalSessionUserInput(fixture.db, {
      terminalId: terminal.id,
      threadId: fixture.thread.id,
      now: 20,
    });

    expect(firstInput).toMatchObject({
      id: terminal.id,
      lastUserInputAt: 10,
      updatedAt: 10,
    });
    expect(secondInput).toBeNull();
    expect(listTerminalSessionsByThread(fixture.db, fixture.thread.id)).toEqual([
      expect.objectContaining({
        id: terminal.id,
        lastUserInputAt: 10,
      }),
    ]);
  });

  it("does not resurrect a terminal exited by environment destruction", () => {
    const fixture = setup();
    const terminal = createStartingTerminal(fixture);
    markEnvironmentTerminalSessionsExited(fixture.db, {
      environmentId: fixture.environment.id,
      closeReason: "environment-destroyed",
    });

    const running = markTerminalSessionRunning(fixture.db, {
      cols: 100,
      currentCwd: null,
      initialCwd: "/tmp/workspace",
      rows: 30,
      terminalId: terminal.id,
      title: "zsh",
    });

    expect(running).toBeNull();
    expect(listTerminalSessionsByThread(fixture.db, fixture.thread.id)).toEqual([
      expect.objectContaining({
        id: terminal.id,
        closeReason: "environment-destroyed",
        status: "exited",
      }),
    ]);
  });

  it("does not let an engine-reported exit overwrite a lifecycle close", () => {
    const fixture = setup();
    const terminal = createStartingTerminal(fixture);
    markThreadTerminalSessionsExited(fixture.db, {
      threadId: fixture.thread.id,
      closeReason: "thread-archived",
    });

    // A PTY exit racing the lifecycle close must not rewrite the recorded
    // close reason (the active-status guard replaces the daemon-session-id
    // match that used to scope this update).
    const exited = markActiveTerminalSessionExited(fixture.db, {
      terminalId: terminal.id,
      exitCode: 0,
      closeReason: "process-exit",
    });

    expect(exited).toBeNull();
    expect(listTerminalSessionsByThread(fixture.db, fixture.thread.id)).toEqual([
      expect.objectContaining({
        id: terminal.id,
        closeReason: "thread-archived",
        status: "exited",
      }),
    ]);
  });

  it("marks an active terminal exited from an engine-reported PTY exit", () => {
    const fixture = setup();
    const terminal = createStartingTerminal(fixture);
    markTerminalSessionRunning(fixture.db, {
      cols: 100,
      currentCwd: null,
      initialCwd: "/tmp/workspace",
      rows: 30,
      terminalId: terminal.id,
      title: "zsh",
    });

    const exited = markActiveTerminalSessionExited(fixture.db, {
      terminalId: terminal.id,
      exitCode: 1,
      closeReason: "process-exit",
    });

    expect(exited).toMatchObject({
      id: terminal.id,
      closeReason: "process-exit",
      exitCode: 1,
      status: "exited",
    });
  });
});
