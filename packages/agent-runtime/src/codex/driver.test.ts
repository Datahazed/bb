import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSessionOpenParams } from "@bb/provider-driver-contract";
import { afterEach, describe, expect, it } from "vitest";
import { codexDriverTestHelpers } from "./driver.js";
import type { ProviderExecutionContext } from "../provider-driver/connection.js";

const directories: string[] = [];

function fullExecutionContext(): ProviderExecutionContext {
  return {
    model: "gpt-5.4",
    reasoningLevel: "high",
    serviceTier: "default",
    permissionMode: "full",
    permissionScope: "full",
    approvalReviewer: null,
    permissionEscalation: null,
    claudeCodeMockCliTraffic: {
      enabled: false,
      endpoint: "http://127.0.0.1:1",
    },
    workflowsEnabled: false,
    memoryEnabled: true,
    providerSubagentsEnabled: true,
  };
}

function openParams(
  overrides: Partial<ProviderSessionOpenParams> = {},
): ProviderSessionOpenParams {
  return {
    operationId: "operation-1",
    attachmentId: "attachment-1",
    bbThreadId: "thread-1",
    mode: { kind: "start" },
    workspace: {
      cwd: "/workspace",
      additionalWriteRoots: [],
      threadStoragePath: "/thread-storage/thread-1",
    },
    execution: {
      model: "gpt-5.4",
      reasoningLevel: "high",
      serviceTier: "default",
      permission: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      features: {
        workflowsEnabled: false,
        memoryEnabled: true,
        subagentsEnabled: true,
      },
      providerOptions: {},
    },
    instructions: { mode: "append", text: "Be concise" },
    skillSources: [],
    dynamicTools: [],
    disallowedTools: [],
    outputSchema: null,
    shellEnvironment: {},
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Codex canonical driver command mapping", () => {
  it("maps automatic review to a read-only sandbox", () => {
    const options: ProviderExecutionContext = {
      ...fullExecutionContext(),
      permissionMode: "auto",
      permissionScope: "workspace",
      approvalReviewer: "automatic",
      permissionEscalation: "deny",
    };

    expect(
      codexDriverTestHelpers.toCodexThreadPermissionSettings(options),
    ).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "read-only",
    });
    expect(
      codexDriverTestHelpers.toCodexPermissionSettings({
        additionalWorkspaceWriteRoots: ["/workspace/extra"],
        gitWritableRoots: ["/git/objects"],
        options,
      }),
    ).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "read-only",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
  });

  it("routes automatic-review escalation through the host in ask mode", () => {
    const options: ProviderExecutionContext = {
      ...fullExecutionContext(),
      permissionMode: "auto",
      permissionScope: "workspace",
      approvalReviewer: "automatic",
      permissionEscalation: "ask",
    };

    expect(
      codexDriverTestHelpers.toCodexThreadPermissionSettings(options),
    ).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "read-only",
    });
  });

  it("maps accepted edits to a workspace-write sandbox", () => {
    const options: ProviderExecutionContext = {
      ...fullExecutionContext(),
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
      permissionEscalation: "ask",
    };

    expect(
      codexDriverTestHelpers.toCodexPermissionSettings({
        additionalWorkspaceWriteRoots: ["/workspace/extra"],
        gitWritableRoots: ["/git/objects"],
        options,
      }),
    ).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/workspace/extra", "/git/objects"],
      },
    });
  });

  it("recovers archived resume and fork sessions inside the driver", async () => {
    expect(
      codexDriverTestHelpers.archivedSessionIdForOpen({
        kind: "resume",
        providerSessionId: "resume-session",
      }),
    ).toBe("resume-session");
    expect(
      codexDriverTestHelpers.archivedSessionIdForOpen({
        kind: "fork",
        sourceProviderSessionId: "fork-session",
        sourceCheckpointId: null,
      }),
    ).toBe("fork-session");

    let attempts = 0;
    const unarchived: string[] = [];
    await expect(
      codexDriverTestHelpers.withArchivedSessionRecovery({
        providerSessionId: "resume-session",
        request: () => {
          attempts += 1;
          return attempts === 1
            ? Promise.reject(
                new Error("no rollout found for thread id resume-session"),
              )
            : Promise.resolve("opened");
        },
        unarchive: (providerSessionId) => {
          unarchived.push(providerSessionId);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe("opened");
    expect(attempts).toBe(2);
    expect(unarchived).toEqual(["resume-session"]);
  });

  it("preserves the archived-session error when recovery fails", async () => {
    const archivedError = new Error("thread source-session is archived");
    await expect(
      codexDriverTestHelpers.withArchivedSessionRecovery({
        providerSessionId: "source-session",
        request: () => Promise.reject(archivedError),
        unarchive: () => Promise.reject(new Error("unarchive failed")),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(archivedError.message),
      cause: expect.objectContaining({ message: "unarchive failed" }),
    });
  });

  it("recognizes idempotent archive state errors", () => {
    expect(
      codexDriverTestHelpers.isAlreadyArchivedStateError(
        true,
        new Error("no rollout found for thread id session-1"),
      ),
    ).toBe(true);
    expect(
      codexDriverTestHelpers.isAlreadyArchivedStateError(
        false,
        new Error("no archived rollout found for thread id session-1"),
      ),
    ).toBe(true);
  });

  it("reopens the same session with current execution after an account error", () => {
    const original = openParams({
      dynamicTools: [
        {
          name: "ping",
          description: "Ping",
          inputSchema: { type: "object", properties: {} },
          statusLabels: null,
        },
      ],
    });
    const execution = {
      ...original.execution,
      model: "gpt-5.4-mini",
      reasoningLevel: "low" as const,
    };

    expect(
      codexDriverTestHelpers.toAccountRestartOpenParams({
        execution,
        openParams: original,
        providerSessionId: "provider-session-1",
      }),
    ).toEqual({
      ...original,
      execution,
      mode: {
        kind: "resume",
        providerSessionId: "provider-session-1",
      },
    });
  });

  it("pins durable starts and forwards fork checkpoints", () => {
    expect(
      codexDriverTestHelpers.buildCodexOpenParams(openParams(), []),
    ).toMatchObject({
      method: "thread/start",
      params: {
        ephemeral: false,
        experimentalRawEvents: true,
        developerInstructions: "Be concise",
      },
    });

    expect(
      codexDriverTestHelpers.buildCodexOpenParams(
        openParams({
          mode: {
            kind: "fork",
            sourceProviderSessionId: "source-session",
            sourceCheckpointId: "source-turn",
          },
        }),
        [],
      ),
    ).toMatchObject({
      method: "thread/fork",
      params: {
        threadId: "source-session",
        lastTurnId: "source-turn",
      },
    });
  });

  it("discovers linked-worktree Git roots without escaping the common dir", () => {
    const root = mkdtempSync(join(tmpdir(), "bb-codex-driver-git-"));
    directories.push(root);
    const realRoot = realpathSync.native(root);
    const workspace = join(realRoot, "worktree");
    const commonDir = join(realRoot, "repo.git");
    const gitDir = join(commonDir, "worktrees", "bb1");
    const headRefParent = join(commonDir, "refs", "heads", "bb");
    const headLogParent = join(commonDir, "logs", "refs", "heads", "bb");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(gitDir, { recursive: true });
    mkdirSync(join(commonDir, "objects"), { recursive: true });
    mkdirSync(headRefParent, { recursive: true });
    mkdirSync(headLogParent, { recursive: true });
    writeFileSync(join(workspace, ".git"), `gitdir: ${gitDir}\n`);
    writeFileSync(join(gitDir, "gitdir"), `${join(workspace, ".git")}\n`);
    writeFileSync(join(gitDir, "commondir"), "../..\n");
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/bb/probe\n");

    expect(
      codexDriverTestHelpers.gitWritableRootsForWorkspace(workspace),
    ).toEqual([
      gitDir,
      join(commonDir, "objects"),
      headRefParent,
      headLogParent,
    ]);
  });

  it("builds explicit memory, subagent, and shell environment config", () => {
    expect(
      codexDriverTestHelpers.buildCodexConfig({
        additionalWorkspaceWriteRoots: [],
        gitWritableRoots: [],
        options: {
          ...fullExecutionContext(),
          memoryEnabled: false,
          providerSubagentsEnabled: false,
          envVars: { SAFE_NAME: "value", "BAD.NAME": "ignored" },
        },
        threadId: "thread-1",
      }),
    ).toMatchObject({
      "shell_environment_policy.set.BB_THREAD_ID": "thread-1",
      "shell_environment_policy.set.SAFE_NAME": "value",
      "features.default_mode_request_user_input": false,
      "features.multi_agent": false,
      "memories.use_memories": false,
      "memories.generate_memories": false,
    });
  });
});
