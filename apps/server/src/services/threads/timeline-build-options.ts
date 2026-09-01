import { getAppSettings } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import { THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT } from "./timeline.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "./timeline-output-truncation.js";

type TimelineBuildOptionDeps = Pick<
  AppDeps,
  "config" | "db" | "providerRegistry"
>;

export function resolveThreadProviderDisplayName(
  deps: Pick<AppDeps, "providerRegistry">,
  providerId: string,
): string | undefined {
  return deps.providerRegistry.get(providerId)?.info.displayName;
}

export function resolveIncludeProviderUnhandledOperations(
  deps: Pick<AppDeps, "config" | "db">,
): boolean {
  return (
    deps.config.isDevelopment ||
    getAppSettings(deps.db).showUnhandledProviderEvents
  );
}

export function resolveSummaryTimelineBuildOptions(
  deps: TimelineBuildOptionDeps,
  thread: Thread,
) {
  return {
    appVersion: deps.config.appVersion,
    includeProviderUnhandledOperations:
      resolveIncludeProviderUnhandledOperations(deps),
    includeNestedRows: false,
    maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
    maxSeq: 0,
    page: {
      kind: "latest" as const,
      segmentLimit: THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
    },
    providerDisplayName: resolveThreadProviderDisplayName(
      deps,
      thread.providerId,
    ),
    planCommand: resolveProviderPlanCommand(
      deps.providerRegistry,
      thread.providerId,
    ),
    summaryOnly: false,
  };
}
