import { appendFileSync } from "node:fs";
import { isUserQuestionPendingInteractionResolution } from "@bb/domain";
import {
  defineProviderDriver,
  serveProviderDriverProcess,
  type ProviderDriverContext,
} from "@bb/provider-driver-sdk";
import type {
  ProviderSessionOpenParams,
  ProviderTurnSubmitParams,
} from "@bb/provider-driver-contract";

interface FakeTurn {
  timer: ReturnType<typeof setTimeout> | null;
  turnId: string;
}

interface FakeSession {
  activeTurn: FakeTurn | null;
  attachmentId: string;
  providerSessionId: string;
}

interface FakeTurnPlan {
  delayMs: number;
  questionRequested: boolean;
  responseText: string;
  toolName: string | null;
}

const providerId = process.env.BB_TEST_PROVIDER_ID ?? "fake";
const sessions = new Map<string, FakeSession>();
let nextProviderSessionId = 1;
let nextItemId = 1;
let nextCallId = 1;
let failDiscardOnce = false;
let sessionOpenLogPath: string | null = null;

function inputText(params: ProviderTurnSubmitParams): string {
  return params.inputGroups
    .flat()
    .map((input) => (input.type === "text" ? input.text : ""))
    .filter((text) => text.length > 0)
    .join(" ");
}

function parseTurnPlan(text: string): FakeTurnPlan {
  const delayMatch = /(?:^|\s)delay:(\d+)(?:\s|$)/u.exec(text);
  const toolMatch = /(?:^|\s)call_tool(?:_unresolved)?:([^\s]+)(?:\s|$)/u.exec(
    text,
  );
  const envMatch = /(?:^|\s)report_env:([^\s]+)(?:\s|$)/u.exec(text);
  const responseText = text.includes("report_pid")
    ? `pid:${process.pid}`
    : envMatch
      ? `${envMatch[1]}=${process.env[envMatch[1] ?? ""] ?? ""}`
      : text
        ? `Response to: ${text}`
        : "Response complete";
  return {
    delayMs: delayMatch ? Number(delayMatch[1]) : 0,
    questionRequested: /(?:^|\s)ask_user(?:\s|$)/u.test(text),
    responseText,
    toolName: toolMatch?.[1] ?? null,
  };
}

function requireSession(attachmentId: string): FakeSession {
  const session = sessions.get(attachmentId);
  if (!session) {
    throw new Error(`Unknown fake provider attachment ${attachmentId}`);
  }
  return session;
}

function clearActiveTurn(session: FakeSession): FakeTurn | null {
  const activeTurn = session.activeTurn;
  if (activeTurn?.timer) {
    clearTimeout(activeTurn.timer);
  }
  session.activeTurn = null;
  return activeTurn;
}

function completeTurn(args: {
  context: ProviderDriverContext;
  responseText: string;
  session: FakeSession;
  turnId: string;
}): void {
  if (args.session.activeTurn?.turnId !== args.turnId) {
    return;
  }
  clearActiveTurn(args.session);
  const item = {
    type: "agentMessage" as const,
    id: `fake-message-${nextItemId++}`,
    text: args.responseText,
  };
  args.context.events.emit({
    type: "item.started",
    attachmentId: args.session.attachmentId,
    turnId: args.turnId,
    item,
  });
  args.context.events.emit({
    type: "item.completed",
    attachmentId: args.session.attachmentId,
    turnId: args.turnId,
    item,
    outcome: "completed",
    error: null,
  });
  args.context.events.emit({
    type: "turn.settled",
    attachmentId: args.session.attachmentId,
    turnId: args.turnId,
    outcome: "completed",
    error: null,
    providerCheckpointId: `fake-checkpoint-${args.turnId}`,
  });
}

async function runTurnPlan(args: {
  context: ProviderDriverContext;
  plan: FakeTurnPlan;
  session: FakeSession;
  turnId: string;
}): Promise<void> {
  let responseText = args.plan.responseText;
  if (args.plan.toolName) {
    const result = await args.context.host.callTool({
      attachmentId: args.session.attachmentId,
      turnId: args.turnId,
      callId: `fake-tool-${nextCallId++}`,
      tool: args.plan.toolName,
      arguments: {},
    });
    responseText = result.content
      .map((content) =>
        content.type === "text" ? content.text : content.imageUrl,
      )
      .join("\n");
  }
  if (args.plan.questionRequested) {
    const result = await args.context.host.requestInteraction({
      attachmentId: args.session.attachmentId,
      turnId: args.turnId,
      requestId: `fake-question-${nextCallId++}`,
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "fake-question",
            prompt: "Which deployment path should the fake provider use?",
            shortLabel: "Path",
            multiSelect: false,
            options: [
              {
                value: "staging",
                label: "Staging",
                description: "Deploy to staging first.",
              },
              { value: "production", label: "Production" },
            ],
            allowFreeText: true,
          },
        ],
      },
    });
    if (isUserQuestionPendingInteractionResolution(result.resolution)) {
      const answered = Object.values(result.resolution.answers).flatMap(
        (answer) => [
          ...answer.selected,
          ...(answer.freeText ? [answer.freeText] : []),
        ],
      );
      responseText = `Question answered: ${answered.join(", ")}`;
    } else {
      responseText = JSON.stringify(result.resolution);
    }
  }
  const finish = (): void =>
    completeTurn({
      context: args.context,
      responseText,
      session: args.session,
      turnId: args.turnId,
    });
  if (args.plan.delayMs > 0) {
    const activeTurn = args.session.activeTurn;
    if (activeTurn?.turnId === args.turnId) {
      activeTurn.timer = setTimeout(finish, args.plan.delayMs);
    }
  } else {
    queueMicrotask(finish);
  }
}

function providerSessionIdForOpen(params: ProviderSessionOpenParams): string {
  switch (params.mode.kind) {
    case "resume":
      return params.mode.providerSessionId;
    case "start":
    case "fork":
      return `fake-session-${nextProviderSessionId++}`;
  }
}

const driver = defineProviderDriver({
  identity: {
    pluginId: "test-plugin",
    driverId: "test-driver",
    providerId,
  },
  processCapabilities: { multiplexSessions: true },
  initialize: (params) => {
    failDiscardOnce = params.config.failDiscardOnce === true;
    sessionOpenLogPath =
      typeof params.config.sessionOpenLogPath === "string"
        ? params.config.sessionOpenLogPath
        : null;
    if (typeof params.config.stderrText === "string") {
      process.stderr.write(params.config.stderrText);
    }
    if (params.config.crashDuringInitialize === true) {
      process.kill(process.pid, "SIGKILL");
    }
  },
  inspect: () => ({
    readiness: { status: "ready" },
    capabilities: {
      multiplexSessions: true,
      supportedSessionOperations: ["fork", "archive", "rename"],
      supportedPermissionModes: ["accept-edits", "auto", "full"],
      supportsServiceTier: false,
      supportsSteering: true,
      supportsUserQuestions: true,
    },
    models: [
      {
        id: "fake-model",
        model: "fake-model",
        displayName: "Fake Model",
        description: "Fake model for runtime tests",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Medium" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
    ],
    selectedOnlyModels: [],
    diagnostics: [],
  }),
  openSession: (params) => {
    if (sessionOpenLogPath) {
      appendFileSync(sessionOpenLogPath, `${JSON.stringify(params)}\n`, "utf8");
    }
    const providerSessionId = providerSessionIdForOpen(params);
    sessions.set(params.attachmentId, {
      activeTurn: null,
      attachmentId: params.attachmentId,
      providerSessionId,
    });
    return { providerSessionId, sessionFormatVersion: "fake-v1" };
  },
  detachSession: (params) => {
    const session = sessions.get(params.attachmentId);
    if (session) {
      clearActiveTurn(session);
      sessions.delete(params.attachmentId);
    }
    return { providerCheckpointId: null };
  },
  discardSession: (params) => {
    if (failDiscardOnce) {
      failDiscardOnce = false;
      throw new Error("discard is temporarily unavailable");
    }
    const session = sessions.get(params.attachmentId);
    if (session) clearActiveTurn(session);
    sessions.delete(params.attachmentId);
  },
  submitTurn: (params, context) => {
    const session = requireSession(params.attachmentId);
    const turnId =
      params.mode === "start" ? params.turnId : params.expectedTurnId;
    if (
      params.mode === "steer" &&
      session.activeTurn?.turnId !== params.expectedTurnId
    ) {
      return {
        outcome: "stale" as const,
        activeTurnId: session.activeTurn?.turnId ?? null,
      };
    }
    if (params.mode === "start") {
      if (session.activeTurn) {
        return {
          outcome: "stale" as const,
          activeTurnId: session.activeTurn.turnId,
        };
      }
      session.activeTurn = { timer: null, turnId };
    } else {
      clearActiveTurn(session);
      session.activeTurn = { timer: null, turnId };
    }
    const text = inputText(params);
    if (text.includes("crash_process")) {
      setTimeout(() => process.kill(process.pid, "SIGKILL"), 50);
      return {
        outcome: "accepted" as const,
        disposition:
          params.mode === "start" ? ("started" as const) : ("steered" as const),
        turnId,
        providerTurnId: `fake-provider-turn-${turnId}`,
      };
    }
    void runTurnPlan({
      context,
      plan: parseTurnPlan(text),
      session,
      turnId,
    }).catch((error: unknown) => {
      if (session.activeTurn?.turnId !== turnId) return;
      clearActiveTurn(session);
      const message = error instanceof Error ? error.message : String(error);
      context.events.emit({
        type: "turn.settled",
        attachmentId: session.attachmentId,
        turnId,
        outcome: "failed",
        error: {
          code: "fake_turn_failed",
          category: "provider",
          message,
          retry: { disposition: "never" },
        },
        providerCheckpointId: null,
      });
    });
    return {
      outcome: "accepted" as const,
      disposition:
        params.mode === "start" ? ("started" as const) : ("steered" as const),
      turnId,
      providerTurnId: `fake-provider-turn-${turnId}`,
    };
  },
  cancelTurn: (params, context) => {
    const session = requireSession(params.attachmentId);
    if (session.activeTurn?.turnId !== params.turnId) {
      return { outcome: "not_active" as const };
    }
    clearActiveTurn(session);
    context.events.emit({
      type: "turn.settled",
      attachmentId: params.attachmentId,
      turnId: params.turnId,
      outcome: "cancelled",
      error: null,
      providerCheckpointId: null,
    });
    return { outcome: "cancellation_requested" as const };
  },
  renameSession: () => ({ outcome: "applied" }),
  setSessionArchived: () => ({ outcome: "applied" }),
  clearSessionGoal: () => ({ outcome: "applied" }),
  shutdown: () => {
    for (const session of sessions.values()) clearActiveTurn(session);
    sessions.clear();
  },
});

serveProviderDriverProcess(driver);
