import type { PromptInput } from "@bb/domain";
import type { LoggedWorkSessionDeps } from "../../types.js";
import {
  applyGeneratedThreadTitle,
  generateThreadMetadataWithOutcome,
} from "./title-generation.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { INFERENCE_POLICY } from "../ai/inference.js";

interface ThreadMetadataInferenceArgs {
  input: PromptInput[];
  threadId: string;
}

interface ThreadMetadataInferenceResult {
  titleApplied: boolean;
  title: string | null;
}

export async function inferThreadMetadata(
  deps: LoggedWorkSessionDeps,
  args: ThreadMetadataInferenceArgs,
): Promise<ThreadMetadataInferenceResult> {
  const outcome = await generateThreadMetadataWithOutcome(deps, {
    input: args.input,
    threadId: args.threadId,
    timeoutMaxAttempts: INFERENCE_POLICY.threadMetadata.maxAttempts,
    timeoutMs: INFERENCE_POLICY.threadMetadata.timeoutMs,
  });

  let titleApplied = false;
  if (outcome.metadata?.title) {
    try {
      titleApplied = applyGeneratedThreadTitle(deps, {
        threadId: args.threadId,
        title: outcome.metadata.title,
      });
    } catch (error) {
      deps.logger.warn(
        {
          threadId: args.threadId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Failed to apply generated thread title",
      );
    }
  }

  return {
    title: outcome.metadata?.title ?? null,
    titleApplied,
  };
}
