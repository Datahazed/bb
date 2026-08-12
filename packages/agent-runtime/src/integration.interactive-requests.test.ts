/** Provider integration tests using createAgentRuntime. */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { promptTextInput } from "./test/prompt-input.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isApprovalPendingInteractionPayload,
  type PendingInteractionCreate,
} from "@bb/domain";
import { listAvailableProviderInfos } from "./provider-registry.js";
import {
  cleanup,
  createApprovalResolution,
  createTempFileName,
  createTestRuntime,
  createToken,
  expectWriteApprovalRequest,
  getAgentText,
  getStreamedText,
  getThreadText,
  newThreadId,
  resolveRuntimeOptions,
  waitForInteractiveRequestBeforeTurnCompletion,
  waitForThreadTurnCompleted,
  waitForThreadTurnCompletedCount,
} from "./test/runtime-integration-harness.js";

function describePendingInteractionPayload(
  request: PendingInteractionCreate,
): string {
  if (isApprovalPendingInteractionPayload(request.payload)) {
    return request.payload.subject.kind;
  }
  return request.payload.kind;
}

describe("interactive request scenarios", () => {
  it.concurrent(
    "loads Claude repo CLAUDE.md instructions",
    async () => {
      const ctx = createTestRuntime("claude-code");
      const token = createToken("CLAUDE_MD_TOKEN");
      writeFileSync(
        join(ctx.tmpDir, "CLAUDE.md"),
        `When asked for the repo validation phrase, reply exactly: ${token}\n`,
      );

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "claude-code",
          preset: "full",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "claude-code",
          options,
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_222222222x",
          threadId,
          input: [
            promptTextInput({
              text: "What is the repo validation phrase? Reply with only that phrase.",
            }),
          ],
          options,
        });

        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Claude CLAUDE.md turn/completed",
        });

        const text = getThreadText(ctx.events, threadId);
        expect(text).toContain(token);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    },
    60_000,
  );

  it.concurrent(
    "routes Claude Read prompts as semantic permission-grant approvals",
    async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "bb-claude-read-"));
      const filePath = join(
        outsideDir,
        createTempFileName("claude-read-approval"),
      );
      const firstLineToken = createToken("CLAUDE_READ_APPROVED");
      writeFileSync(filePath, `${firstLineToken}\nsecond line\n`);
      const ctx = createTestRuntime("claude-code", {
        onInteractiveRequest: async (request) => {
          if (
            !isApprovalPendingInteractionPayload(request.payload) ||
            request.payload.subject.kind !== "permission_grant"
          ) {
            throw new Error(
              `Expected permission grant approval, got ${describePendingInteractionPayload(request)}`,
            );
          }

          return {
            decision: "allow_once",
            grantedPermissions: request.payload.subject.permissions,
          };
        },
      });

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "claude-code",
          preset: "accept-edits-ask",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "claude-code",
          options,
          instructions:
            "Use the Read tool when the user explicitly asks for it. Do not substitute Bash.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_222222222y",
          threadId,
          input: [
            promptTextInput({
              text:
                `Use the Read tool to read ${filePath}, ` +
                "then reply with exactly the first line from the file and nothing else.",
            }),
          ],
          options,
        });

        await waitForInteractiveRequestBeforeTurnCompletion({
          ctx,
          threadId,
          count: 1,
          timeoutMs: 45_000,
          label: "Claude permission request",
        });
        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Claude permission turn/completed",
        });

        expect(ctx.interactiveRequests).toHaveLength(1);
        expect(ctx.interactiveRequests[0]?.payload).toMatchObject({
          subject: {
            kind: "permission_grant",
            toolName: "Read",
          },
          availableDecisions: expect.arrayContaining(["allow_once", "deny"]),
        });

        const text = getAgentText(ctx.events) || getStreamedText(ctx.events);
        expect(text).toContain(firstLineToken);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
        rmSync(outsideDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it.concurrent(
    "allows Claude accept-edits Write tool mutations without interactive requests",
    async () => {
      const ctx = createTestRuntime("claude-code");
      const fileName = createTempFileName("claude-accept-edits-tool");
      const filePath = join(ctx.tmpDir, fileName);
      const token = createToken("CLAUDE_WORKSPACE_WRITE_TOOL_APPROVED");

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "claude-code",
          preset: "accept-edits-ask",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "claude-code",
          options,
          instructions:
            "Use the Write tool when the user explicitly asks for Write. Do not substitute Bash.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_222222222z",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Use the Write tool to create exactly this file: ${filePath}. ` +
                `The file content must be exactly ${token} with no trailing newline. ` +
                "Do not use Bash. After the file is written, reply with exactly DONE.",
            }),
          ],
        });

        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Claude accept-edits Write turn/completed",
        });

        expect(ctx.interactiveRequests).toHaveLength(0);
        expect(readFileSync(filePath, "utf8")).toBe(token);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    },
    75_000,
  );

  it.concurrent(
    "allows Claude accept-edits sandboxed Bash workspace writes without interactive requests",
    async () => {
      const ctx = createTestRuntime("claude-code");
      const fileName = createTempFileName("claude-accept-edits-bash");
      const filePath = join(ctx.tmpDir, fileName);
      const token = createToken("CLAUDE_WORKSPACE_BASH_APPROVED");

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "claude-code",
          preset: "accept-edits-ask",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "claude-code",
          options,
          instructions:
            "Use the Bash tool when the user explicitly asks for Bash. Do not substitute Write.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_2222222232",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Use Bash to run exactly: printf '${token}' > ${fileName}. ` +
                "Do not use the Write tool. After the command finishes, reply with exactly DONE.",
            }),
          ],
        });

        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Claude accept-edits sandboxed Bash turn/completed",
        });

        expect(ctx.interactiveRequests).toHaveLength(0);
        expect(readFileSync(filePath, "utf8")).toBe(token);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    },
    75_000,
  );

  it.concurrent(
    "blocks Claude accept-edits outside-workspace Bash without interactive requests when escalation is deny",
    async () => {
      const ctx = createTestRuntime("claude-code");
      const outsideDir = mkdtempSync(join(tmpdir(), "bb-claude-outside-"));
      const filePath = join(
        outsideDir,
        createTempFileName("claude-outside-bash-denied"),
      );
      const token = createToken("CLAUDE_WORKSPACE_BASH_DENIED");

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "claude-code",
          preset: "accept-edits-deny",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "claude-code",
          options,
          instructions:
            "Use the Bash tool when the user explicitly asks for Bash. Do not substitute Write.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_2222222233",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Use Bash to run exactly: printf '${token}' > '${filePath}'. ` +
                "If it is denied or blocked, say DENIED.",
            }),
          ],
        });

        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Claude accept-edits outside Bash deny turn/completed",
        });

        expect(ctx.interactiveRequests).toHaveLength(0);
        expect(existsSync(filePath)).toBe(false);
      } finally {
        await ctx.runtime.shutdown();
        rmSync(outsideDir, { recursive: true, force: true });
        cleanup(ctx);
      }
    },
    75_000,
  );

  it.concurrent(
    "allows Codex accept-edits workspace writes without interactive requests",
    async () => {
      const ctx = createTestRuntime("codex");
      const fileName = createTempFileName("codex-accept-edits");
      const filePath = join(ctx.tmpDir, fileName);
      const token = createToken("CODEX_WORKSPACE_WRITE_APPROVED");

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "codex",
          preset: "accept-edits-ask",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "codex",
          options,
          instructions:
            "When the user asks you to run an exact shell command, run that shell command exactly once and then report DONE.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_2222222234",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Run this exact shell command: printf '${token}' > ${fileName}. ` +
                "After the command finishes, reply with exactly DONE.",
            }),
          ],
        });

        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Codex accept-edits turn/completed",
        });

        expect(ctx.interactiveRequests).toHaveLength(0);
        expect(readFileSync(filePath, "utf8")).toBe(token);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    },
    75_000,
  );

  it.concurrent(
    "routes Codex accept-edits outside-workspace writes through onInteractiveRequest",
    async () => {
      const ctx = createTestRuntime("codex", {
        onInteractiveRequest: createApprovalResolution,
      });
      const outsideDir = mkdtempSync(join(process.cwd(), ".bb-codex-outside-"));
      const filePath = join(
        outsideDir,
        createTempFileName("codex-outside-write"),
      );
      const token = createToken("CODEX_WORKSPACE_WRITE_ESCALATED");

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "codex",
          preset: "accept-edits-ask",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "codex",
          options,
          instructions:
            "When the user asks you to run an exact shell command, run that shell command exactly once. If approval is needed, request approval; it will be approved. Then report DONE.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_2222222235",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Run this exact shell command: printf '${token}' > '${filePath}'. ` +
                "If approval is needed, request approval. If it is denied or blocked, report the exact error. Otherwise reply DONE.",
            }),
          ],
        });

        await waitForInteractiveRequestBeforeTurnCompletion({
          ctx,
          threadId,
          count: 1,
          timeoutMs: 45_000,
          label: "Codex accept-edits outside-workspace approval",
        });
        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Codex accept-edits outside-workspace turn/completed",
        });

        expectWriteApprovalRequest(ctx.interactiveRequests);
        expect(readFileSync(filePath, "utf8")).toBe(token);
      } finally {
        await ctx.runtime.shutdown();
        rmSync(outsideDir, { recursive: true, force: true });
        cleanup(ctx);
      }
    },
    75_000,
  );

  it.concurrent(
    "applies Claude allow_for_session approvals to later WebFetch calls in the same session",
    async () => {
      const ctx = createTestRuntime("claude-code", {
        onInteractiveRequest: createApprovalResolution,
      });
      const fetchUrl = "https://example.com";

      try {
        const threadId = newThreadId();
        const options = await resolveRuntimeOptions({
          ctx,
          providerId: "claude-code",
          preset: "accept-edits-ask",
        });
        await ctx.runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "test-project",
          providerId: "claude-code",
          options,
          instructions:
            "Use the WebFetch tool when the user explicitly asks for WebFetch. Do not substitute Bash or any other tool.",
        });

        await ctx.runtime.runTurn({
          clientRequestId: "creq_222222223d",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Use WebFetch to fetch ${fetchUrl}. ` +
                "After the fetch finishes, reply with exactly FIRST_DONE.",
            }),
          ],
        });

        await waitForInteractiveRequestBeforeTurnCompletion({
          ctx,
          threadId,
          count: 1,
          timeoutMs: 45_000,
          label: "Claude session WebFetch approval",
        });
        await waitForThreadTurnCompleted({
          ctx,
          threadId,
          timeoutMs: 45_000,
          label: "Claude session first WebFetch turn/completed",
        });

        const firstRequestCount = ctx.interactiveRequests.length;
        expect(
          ctx.interactiveRequests.some((request) => {
            if (
              !isApprovalPendingInteractionPayload(request.payload) ||
              request.payload.subject.kind !== "permission_grant"
            ) {
              return false;
            }
            return (
              request.payload.subject.toolName === "WebFetch" &&
              request.payload.availableDecisions.includes("allow_for_session")
            );
          }),
          `Expected a session-capable WebFetch permission approval; got ${JSON.stringify(
            ctx.interactiveRequests.map((request) => request.payload),
          )}`,
        ).toBe(true);

        await ctx.runtime.runTurn({
          clientRequestId: "creq_222222223e",
          threadId,
          options,
          input: [
            promptTextInput({
              text:
                `Use WebFetch to fetch ${fetchUrl} again. ` +
                "After the fetch finishes, reply with exactly SECOND_DONE.",
            }),
          ],
        });

        await waitForThreadTurnCompletedCount({
          ctx,
          threadId,
          count: 2,
          timeoutMs: 45_000,
          label: "Claude session second WebFetch turn/completed",
        });

        expect(
          ctx.interactiveRequests,
          `Expected no new WebFetch approvals; got ${JSON.stringify(
            ctx.interactiveRequests.map((request) => request.payload),
          )}`,
        ).toHaveLength(firstRequestCount);
      } finally {
        await ctx.runtime.shutdown();
        cleanup(ctx);
      }
    },
    90_000,
  );

  it.concurrent("keeps Pi limited to full permission mode", () => {
    const piProvider = listAvailableProviderInfos().find(
      (provider) => provider.id === "pi",
    );

    expect(piProvider?.capabilities.supportedPermissionModes).toEqual(["full"]);
  });
});
