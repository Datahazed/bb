/**
 * Public thread-terminal routes against the in-process engine seam (plan §6
 * Phase 1): the lifecycle dispatches `EngineTerminalCommand`s through
 * `bindEngine` (recorded by the fixture) and consumes engine events through
 * `handleEngineTerminalEvent` — the replacement for the daemon WS fixture.
 * Daemon-session semantics (disconnected status, reconnect expiry) died with
 * the transport and have no tests here.
 */
import {
  createTerminalSession,
  getThread,
  getTerminalSessionForThread,
  listTerminalSessionsByEnvironment,
  listTerminalSessionsByThread,
  markEnvironmentTerminalSessionsExited,
  markTerminalSessionExited,
  markTerminalSessionUserInput,
  markThreadTerminalSessionsExited,
} from "@bb/db";
import {
  markEnvironmentOperationRecordQueued,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import type { EnvironmentStatus } from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  apiErrorSchema,
  terminalServerMessageSchema,
  type TerminalServerMessage,
  terminalSessionSchema,
  threadTerminalListResponseSchema,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineTerminalCommand } from "../../src/engine/ports.js";
import { LOCAL_HOST_ID } from "../../src/services/hosts/local-host.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

interface FakeBrowserSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  sentMessages: string[];
}

interface TerminalRouteFixture {
  engineCommands: EngineTerminalCommand[];
  environment: ReturnType<typeof seedEnvironment>;
  harness: TestAppHarness;
  thread: ReturnType<typeof seedThread>;
}

type TerminalOpenMessage = Extract<
  EngineTerminalCommand,
  { type: "terminal.open" }
>;

interface PendingTerminalOpen {
  openMessage: TerminalOpenMessage;
  responsePromise: Promise<Response>;
}

interface CreateTerminalRouteFixtureArgs {
  environmentStatus?: EnvironmentStatus;
}

function createFakeBrowserSocket(): FakeBrowserSocket {
  const sentMessages: string[] = [];
  const closeSocket: FakeBrowserSocket["close"] = () => {};
  const sendSocketMessage: FakeBrowserSocket["send"] = (data) => {
    sentMessages.push(data);
  };
  return {
    close: vi.fn(closeSocket),
    send: vi.fn(sendSocketMessage),
    sentMessages,
  };
}

function readBrowserMessages(
  socket: FakeBrowserSocket,
): TerminalServerMessage[] {
  return socket.sentMessages.map((message) =>
    terminalServerMessageSchema.parse(JSON.parse(message)),
  );
}

async function waitForEngineCommand(
  fixture: TerminalRouteFixture,
  messageIndex = 0,
): Promise<EngineTerminalCommand> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const message = fixture.engineCommands[messageIndex];
    if (message !== undefined) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for engine terminal command");
}

async function createTerminalRouteFixture(
  args: CreateTerminalRouteFixtureArgs = {},
): Promise<TerminalRouteFixture> {
  const harness = await createTestAppHarness();
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: LOCAL_HOST_ID,
    path: "/tmp/terminal-project",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: LOCAL_HOST_ID,
    path: "/tmp/terminal-workspace",
    projectId: project.id,
    status: args.environmentStatus ?? "ready",
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const engineCommands: EngineTerminalCommand[] = [];
  harness.deps.terminalSessions.bindEngine((message) => {
    engineCommands.push(message);
  });
  return {
    engineCommands,
    environment,
    harness,
    thread,
  };
}

async function startPendingTerminalOpen(
  fixture: TerminalRouteFixture,
): Promise<PendingTerminalOpen> {
  const responsePromise = Promise.resolve(
    fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    ),
  );
  const openMessage = await waitForEngineCommand(fixture);
  if (openMessage.type !== "terminal.open") {
    throw new Error(`Expected terminal.open, received ${openMessage.type}`);
  }
  return {
    openMessage,
    responsePromise,
  };
}

function acknowledgeTerminalOpen(
  fixture: TerminalRouteFixture,
  openMessage: TerminalOpenMessage,
): void {
  fixture.harness.deps.terminalSessions.handleEngineTerminalEvent({
    type: "terminal.opened",
    requestId: openMessage.requestId,
    terminalId: openMessage.terminalId,
    shell: "/bin/zsh",
    title: "zsh",
    initialCwd: "/tmp/terminal-workspace",
    currentCwd: null,
    cols: 100,
    rows: 30,
  });
}

describe("public thread terminal routes", () => {
  let harnesses: TestAppHarness[] = [];

  beforeEach(() => {
    harnesses = [];
  });

  afterEach(async () => {
    for (const harness of harnesses) {
      harness.engineRouting.releaseAll();
      await harness.cleanup();
    }
  });

  it("lists terminal sessions for a thread", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 120,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const exited = createTerminalSession(fixture.harness.db, {
      cols: 120,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 2",
    });
    markTerminalSessionExited(fixture.harness.db, {
      terminalId: exited.id,
      exitCode: 0,
      closeReason: "user",
    });

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
    );

    expect(response.status).toBe(200);
    const body = threadTerminalListResponseSchema.parse(
      await readJson(response),
    );
    expect(body.sessions).toEqual([
      expect.objectContaining({
        id: stored.id,
        status: "running",
        title: "Terminal 1",
      }),
    ]);
  });

  it("rejects terminal creation when the thread has no environment", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);
    harness.deps.terminalSessions.bindEngine(() => {});
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: LOCAL_HOST_ID,
      path: "/tmp/terminal-no-env-project",
    });
    const thread = seedThread(harness.deps, {
      environmentId: null,
      projectId: project.id,
      status: "idle",
    });

    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      },
    );

    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "thread_environment_unavailable",
      details: {
        reason: "never_attached",
        environmentStatus: null,
      },
    });
  });

  it("opens a terminal after the engine acknowledges the PTY", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const responsePromise = fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    );
    const openMessage = await waitForEngineCommand(fixture);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(openMessage).toMatchObject({
      cols: 100,
      environmentId: fixture.environment.id,
      rows: 30,
      threadId: fixture.thread.id,
      workspaceContext: {
        workspacePath: "/tmp/terminal-workspace",
      },
    });

    acknowledgeTerminalOpen(fixture, openMessage);

    const response = await responsePromise;
    expect(response.status).toBe(201);
    const body = terminalSessionSchema.parse(await readJson(response));
    expect(body).toMatchObject({
      currentCwd: null,
      initialCwd: "/tmp/terminal-workspace",
      status: "running",
      title: "zsh",
    });
  });

  it("does not resurrect a pending terminal after thread deletion", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const { openMessage, responsePromise } =
      await startPendingTerminalOpen(fixture);

    markThreadTerminalSessionsExited(fixture.harness.db, {
      threadId: fixture.thread.id,
      closeReason: "thread-deleted",
    });
    acknowledgeTerminalOpen(fixture, openMessage);

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_cancelled",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: openMessage.terminalId,
        closeReason: "thread-deleted",
        status: "exited",
      }),
    ]);
    const closeMessage = await waitForEngineCommand(fixture, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: openMessage.terminalId,
      reason: "thread-deleted",
    });
  });

  it("does not resurrect a pending terminal after environment destruction", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const { openMessage, responsePromise } =
      await startPendingTerminalOpen(fixture);

    markEnvironmentTerminalSessionsExited(fixture.harness.db, {
      environmentId: fixture.environment.id,
      closeReason: "environment-destroyed",
    });
    acknowledgeTerminalOpen(fixture, openMessage);

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_cancelled",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: openMessage.terminalId,
        closeReason: "environment-destroyed",
        status: "exited",
      }),
    ]);
    const closeMessage = await waitForEngineCommand(fixture, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: openMessage.terminalId,
      reason: "environment-destroyed",
    });
  });

  it("marks timed-out terminal opens exited", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      },
    );

    expect(response.status).toBe(504);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_timeout",
    });
    const sessions = listTerminalSessionsByThread(
      fixture.harness.db,
      fixture.thread.id,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      closeReason: "open-timeout",
      status: "exited",
    });
    const closeMessage = await waitForEngineCommand(fixture, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      reason: "open-timeout",
    });
  });

  it("closes terminal sessions when the owning thread is deleted", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerChildThreadsConfirmed: false }),
      },
    );

    expect(response.status).toBe(200);
    const closeMessage = await waitForEngineCommand(fixture);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "thread-deleted",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "thread-deleted",
          status: "exited",
        }),
      }),
    );
  });

  it("closes terminal sessions when the owning thread is archived", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/archive`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    const closeMessage = await waitForEngineCommand(fixture);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "thread-archived",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: stored.id,
        closeReason: "thread-archived",
        status: "exited",
      }),
    ]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "thread-archived",
          status: "exited",
        }),
      }),
    );
  });

  it("closes terminal sessions after an environment destroy result", async () => {
    const fixture = await createTerminalRouteFixture({
      environmentStatus: "destroying",
    });
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    // Mirror queueDestroyAndMarkDestroying: dispatch through the engine shim,
    // then thread the synthesized commandId into the op row's 'queued' write.
    const destroyCommand: Extract<
      HostDaemonCommand,
      { type: "environment.destroy" }
    > = {
      type: "environment.destroy",
      environmentId: fixture.environment.id,
      workspaceContext: {
        workspacePath: "/tmp/terminal-workspace",
        workspaceProvisionType: "managed-worktree",
      },
    };
    upsertEnvironmentOperationRecord(fixture.harness.db, {
      environmentId: fixture.environment.id,
      kind: "destroy",
      payload: JSON.stringify(destroyCommand),
    });
    const { commandId } = fixture.harness.deps.engineDispatch.dispatch({
      command: destroyCommand,
    });
    markEnvironmentOperationRecordQueued(fixture.harness.db, {
      environmentId: fixture.environment.id,
      kind: "destroy",
      commandId,
    });

    await fixture.harness.engineRouting.settle(
      fixture.harness.deps.engineDispatch,
      {
        commandId,
        completedAt: Date.now(),
        type: "environment.destroy",
        ok: true,
        result: {},
      },
    );

    expect(getThread(fixture.harness.db, fixture.thread.id)).toMatchObject({
      status: "error",
    });
    await vi.waitFor(() => {
      expect(
        listTerminalSessionsByEnvironment(
          fixture.harness.db,
          fixture.environment.id,
        ),
      ).toEqual([
        expect.objectContaining({
          id: stored.id,
          closeReason: "environment-destroyed",
          status: "exited",
        }),
      ]);
    });
    const closeMessage = await waitForEngineCommand(fixture);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "environment-destroyed",
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "environment-destroyed",
          status: "exited",
        }),
      }),
    );
  });

  it("closes a clean terminal through the public route when if-clean mode is requested", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "if-clean", reason: "user" }),
      },
    );

    expect(response.status).toBe(200);
    expect(terminalSessionSchema.parse(await readJson(response))).toMatchObject({
      id: stored.id,
      closeReason: "user",
      status: "exited",
    });
    const closeMessage = await waitForEngineCommand(fixture);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
  });

  it("does not close a dirty terminal unless force mode is requested", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    markTerminalSessionUserInput(fixture.harness.db, {
      terminalId: stored.id,
      threadId: fixture.thread.id,
      now: 10,
    });

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "if-clean", reason: "user" }),
      },
    );

    expect(response.status).toBe(200);
    expect(terminalSessionSchema.parse(await readJson(response))).toMatchObject({
      id: stored.id,
      lastUserInputAt: 10,
      status: "running",
    });
    expect(fixture.engineCommands).toEqual([]);

    const forceResponse = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "force", reason: "user" }),
      },
    );

    expect(forceResponse.status).toBe(200);
    expect(
      terminalSessionSchema.parse(await readJson(forceResponse)),
    ).toMatchObject({
      id: stored.id,
      closeReason: "user",
      lastUserInputAt: 10,
      status: "exited",
    });
    const closeMessage = await waitForEngineCommand(fixture);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
  });

  it("streams terminal traffic between browser sockets and the engine", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      currentCwd: null,
      environmentId: fixture.environment.id,
      hostId: LOCAL_HOST_ID,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();

    fixture.harness.deps.terminalSessions.attachBrowserTerminal({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
    });
    const attachMessage = await waitForEngineCommand(fixture);
    if (attachMessage.type !== "terminal.attach") {
      throw new Error(
        `Expected terminal.attach, received ${attachMessage.type}`,
      );
    }
    expect(attachMessage).toMatchObject({
      terminalId: stored.id,
      sinceSeq: 0,
    });

    const replayChunk = {
      seq: 0,
      dataBase64: Buffer.from("hello\n", "utf8").toString("base64"),
    };
    fixture.harness.deps.terminalSessions.handleEngineTerminalEvent({
      type: "terminal.replay",
      requestId: attachMessage.requestId,
      terminalId: stored.id,
      chunks: [replayChunk],
      nextSeq: 1,
    });
    expect(readBrowserMessages(browserSocket)).toEqual([
      expect.objectContaining({
        type: "attached",
        nextSeq: 1,
        session: expect.objectContaining({ id: stored.id }),
      }),
      { type: "output", chunk: replayChunk },
    ]);

    const liveChunk = {
      seq: 1,
      dataBase64: Buffer.from("world\n", "utf8").toString("base64"),
    };
    fixture.harness.deps.terminalSessions.handleEngineTerminalEvent({
      type: "terminal.output",
      terminalId: stored.id,
      chunk: liveChunk,
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual({
      type: "output",
      chunk: liveChunk,
    });

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      message: {
        type: "input",
        dataBase64: Buffer.from("pwd\n", "utf8").toString("base64"),
      },
    });
    const inputMessage = await waitForEngineCommand(fixture, 1);
    expect(inputMessage).toMatchObject({
      type: "terminal.input",
      terminalId: stored.id,
      dataBase64: Buffer.from("pwd\n", "utf8").toString("base64"),
    });
    expect(
      getTerminalSessionForThread(fixture.harness.db, {
        terminalId: stored.id,
        threadId: fixture.thread.id,
      })?.lastUserInputAt,
    ).toBeTypeOf("number");
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "session-updated",
        session: expect.objectContaining({
          id: stored.id,
          lastUserInputAt: expect.any(Number),
        }),
      }),
    );

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      message: {
        type: "resize",
        cols: 120,
        rows: 40,
      },
    });
    const resizeMessage = await waitForEngineCommand(fixture, 2);
    expect(resizeMessage).toMatchObject({
      type: "terminal.resize",
      terminalId: stored.id,
      cols: 120,
      rows: 40,
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "session-updated",
        session: expect.objectContaining({
          id: stored.id,
          cols: 120,
          rows: 40,
        }),
      }),
    );

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      message: {
        type: "close",
        reason: "user",
      },
    });
    const closeMessage = await waitForEngineCommand(fixture, 3);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "user",
          status: "exited",
        }),
      }),
    );
  });
});
