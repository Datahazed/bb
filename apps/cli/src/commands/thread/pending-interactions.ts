import { formatPendingInteractionSummary } from "@bb/core-ui";
import {
  isUserQuestionPendingInteractionPayload,
  type PendingInteraction,
} from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import {
  formatInteractionKind,
  formatInteractionResolveHint,
} from "./interactions.js";

export interface FetchThreadPendingInteractionsArgs {
  sdk: Pick<BbSdk, "threads">;
  threadId: string;
}

/**
 * Best-effort fetch of the pending and resolving interactions of a thread.
 * Returns null when the interactions endpoint fails so the wrapping command
 * still prints the rest of the thread details.
 */
export async function fetchThreadPendingInteractions(
  args: FetchThreadPendingInteractionsArgs,
): Promise<PendingInteraction[] | null> {
  try {
    return await args.sdk.threads.interactions.list({
      threadId: args.threadId,
    });
  } catch {
    return null;
  }
}

function formatQuestionOptionsLine(interaction: PendingInteraction): string[] {
  if (!isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return [];
  }
  return interaction.payload.questions.map((question) => {
    const prefix =
      interaction.payload.kind === "user_question" &&
      interaction.payload.questions.length > 1
        ? `${question.id}: `
        : "";
    const options = (question.options ?? []).map(
      (option) => `${option.value} (${option.label})`,
    );
    const parts = [
      ...(options.length > 0 ? [`Options: ${options.join(", ")}`] : []),
      ...(question.allowFreeText ? ["free text allowed"] : []),
    ];
    return `    ${prefix}${parts.join("; ")}`;
  });
}

/**
 * Prints the pending-interactions section of `bb thread show`. Each entry
 * ends with the exact command that resolves it, because a thread with a
 * pending interaction rejects new prompts until someone answers.
 */
export function printPendingInteractions(
  interactions: readonly PendingInteraction[] | null,
): void {
  if (!interactions || interactions.length === 0) return;

  console.log("");
  console.log(`Pending interactions (${interactions.length}):`);
  for (const interaction of interactions) {
    const summary = formatPendingInteractionSummary({
      interaction,
      surface: "cli",
    });
    console.log(
      `  ${interaction.id}  ${formatInteractionKind(interaction)}  ${interaction.status}  ${summary}`,
    );
    for (const line of formatQuestionOptionsLine(interaction)) {
      console.log(line);
    }
    if (interaction.status === "resolving") {
      console.log("    Delivery: waiting for provider acknowledgement");
      continue;
    }
    console.log(`    ${formatInteractionResolveHint(interaction)}`);
  }
}
