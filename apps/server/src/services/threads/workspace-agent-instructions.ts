import fs from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

export const THREAD_AGENT_INSTRUCTIONS_MAX_BYTES = 256 * 1024;

/** Data-dir-relative path bb reads user agent instructions from. */
export const DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH = "AGENTS.md";

/** Workspace-relative path bb reads project agent instructions from. */
export const WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH = path.join(
  ".bb",
  "AGENTS.md",
);

function isFsErrorWithCode(error: Error, code: string): boolean {
  return "code" in error && error.code === code;
}

function assertInstructionSize(sizeBytes: number, source: string): void {
  if (sizeBytes <= THREAD_AGENT_INSTRUCTIONS_MAX_BYTES) {
    return;
  }
  throw new ApiError(
    413,
    "agent_instructions_too_large",
    `${source} exceeds the 256 KiB thread instruction limit`,
    { details: { limitBytes: THREAD_AGENT_INSTRUCTIONS_MAX_BYTES, sizeBytes } },
  );
}

export function assertThreadAgentInstructionsSize(instructions: string): void {
  assertInstructionSize(
    Buffer.byteLength(instructions, "utf8"),
    "The resolved agent instructions",
  );
}

function readAgentInstructionsFile(filePath: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }

  const trimmed = content.trim();
  assertInstructionSize(
    Buffer.byteLength(trimmed, "utf8"),
    DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  );
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads user-level agent instructions from `<dataDir>/AGENTS.md`.
 * Returns the trimmed contents, or `null` when the file is missing or empty.
 * Other read errors propagate so the server never freezes incomplete input.
 */
export function readDataDirAgentInstructions(dataDir: string): string | null {
  return readAgentInstructionsFile(
    path.join(dataDir, DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH),
  );
}

/**
 * Reads workspace-level agent instructions from `<workspacePath>/.bb/AGENTS.md`.
 * Returns the trimmed contents, or `null` when the file is missing or empty.
 * Other host RPC failures propagate so an unavailable target host fails the
 * turn instead of silently dropping its workspace instructions.
 */
export async function readWorkspaceAgentInstructions(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; workspacePath: string },
): Promise<string | null> {
  const filePath = path.join(
    args.workspacePath,
    WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  );
  let result;
  try {
    result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        path: filePath,
        rootPath: args.workspacePath,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const content =
    result.contentEncoding === "utf8"
      ? result.content
      : Buffer.from(result.content, "base64").toString("utf8");
  const trimmed = content.trim();
  assertInstructionSize(
    Buffer.byteLength(trimmed, "utf8"),
    WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  );
  return trimmed.length > 0 ? trimmed : null;
}
