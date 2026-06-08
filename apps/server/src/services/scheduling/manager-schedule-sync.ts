import path from "node:path";
import matter from "gray-matter";
import {
  getEnvironment,
  getThread,
  replaceManagerThreadNudges,
  type ReplaceManagerThreadNudgeInput,
} from "@bb/db";
import {
  scheduleCronSchema,
  scheduleNameSchema,
  scheduleTimezoneSchema,
} from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { callEngineOnlineRpc } from "../hosts/online-rpc.js";
import {
  computeNextScheduledTime,
  ScheduleValidationError,
  validateScheduleDefinition,
} from "./schedule-helpers.js";
import { requireThreadStoragePath } from "../threads/thread-storage.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

const ASYNC_FILE_NAME = "ASYNC.md";
const DEFAULT_ASYNC_TIMEZONE = "UTC";
const MAX_MANAGER_SCHEDULES = 20;
const MAX_ASYNC_FILE_BYTES = 256 * 1024;
const ASYNC_FRONTMATTER_DELIMITER = "---";
const loggedInvalidScheduleKeys = new Set<string>();

const asyncScheduleFrontmatterSchema = z.object({
  // Parse entries individually so one malformed schedule does not poison the
  // rest of the file.
  schedules: z.array(z.unknown()).optional(),
  timezone: scheduleTimezoneSchema.optional(),
});

const asyncScheduleEntrySchema = z.object({
  cron: scheduleCronSchema,
  name: scheduleNameSchema,
  timezone: scheduleTimezoneSchema.optional(),
});

interface SyncManagerThreadSchedulesArgs {
  threadId: string;
}

interface InvalidScheduleLogContext {
  [key: string]: CompactScheduleValidationIssue[] | number | string | undefined;
}

interface LogInvalidScheduleArgs {
  context: InvalidScheduleLogContext;
  key: string;
  message: string;
}

interface CompactScheduleValidationIssue {
  code: string;
  message: string;
  path: string;
}

function compactScheduleValidationIssues(
  issues: z.ZodIssue[],
): CompactScheduleValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.join("."),
  }));
}

function logInvalidScheduleOnce(
  deps: Pick<AppDeps, "logger">,
  args: LogInvalidScheduleArgs,
): void {
  if (loggedInvalidScheduleKeys.has(args.key)) {
    deps.logger.debug(args.context, args.message);
    return;
  }

  loggedInvalidScheduleKeys.add(args.key);
  deps.logger.warn(args.context, args.message);
}

function hasFrontmatterPrefix(content: string): boolean {
  return content.trimStart().startsWith(ASYNC_FRONTMATTER_DELIMITER);
}

function hasSupportedFrontmatterDelimiter(content: string): boolean {
  const trimmed = content.trimStart();
  // Only accept a plain YAML opener. gray-matter treats suffixes like
  // `---js` as engine selectors, and the JavaScript engine evals the block.
  return (
    trimmed.startsWith(`${ASYNC_FRONTMATTER_DELIMITER}\n`) ||
    trimmed.startsWith(`${ASYNC_FRONTMATTER_DELIMITER}\r\n`)
  );
}

function toDesiredManagerThreadNudges(
  deps: Pick<AppDeps, "logger">,
  args: {
    content: string;
    now: number;
    threadId: string;
  },
): ReplaceManagerThreadNudgeInput[] | null {
  const parsed = matter(args.content);
  const frontmatter = asyncScheduleFrontmatterSchema.safeParse(parsed.data);
  if (!frontmatter.success) {
    deps.logger.warn(
      {
        issues: frontmatter.error.issues,
        threadId: args.threadId,
      },
      "Failed to parse ASYNC.md frontmatter",
    );
    return null;
  }

  const schedules = frontmatter.data.schedules ?? [];
  const limitedSchedules = schedules.slice(0, MAX_MANAGER_SCHEDULES);
  if (schedules.length > MAX_MANAGER_SCHEDULES) {
    deps.logger.warn(
      {
        scheduleCount: schedules.length,
        threadId: args.threadId,
      },
      "Skipping extra ASYNC.md schedules beyond the per-thread limit",
    );
  }

  const defaultTimezone = frontmatter.data.timezone ?? DEFAULT_ASYNC_TIMEZONE;
  const desiredNudges: ReplaceManagerThreadNudgeInput[] = [];
  const seenNames = new Set<string>();

  for (const rawEntry of limitedSchedules) {
    const parsedSchedule = asyncScheduleEntrySchema.safeParse(rawEntry);
    if (!parsedSchedule.success) {
      logInvalidScheduleOnce(deps, {
        context: {
          issues: compactScheduleValidationIssues(parsedSchedule.error.issues),
          issueCount: parsedSchedule.error.issues.length,
          threadId: args.threadId,
        },
        key: `${args.threadId}:schema:${JSON.stringify(
          parsedSchedule.error.issues,
        )}`,
        message: "Skipping invalid ASYNC.md schedule entry",
      });
      continue;
    }

    const rawSchedule = parsedSchedule.data;
    if (seenNames.has(rawSchedule.name)) {
      deps.logger.warn(
        {
          name: rawSchedule.name,
          threadId: args.threadId,
        },
        "Skipping duplicate ASYNC.md schedule name",
      );
      continue;
    }

    const timezone = rawSchedule.timezone ?? defaultTimezone;
    const cron = rawSchedule.cron.trim();

    try {
      validateScheduleDefinition({
        cron,
        timezone,
      });
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        logInvalidScheduleOnce(deps, {
          context: {
            name: rawSchedule.name,
            reason: error.message,
            threadId: args.threadId,
          },
          key: `${args.threadId}:definition:${rawSchedule.name}:${error.message}`,
          message: "Skipping invalid ASYNC.md schedule",
        });
        continue;
      }
      throw error;
    }

    desiredNudges.push({
      cron,
      name: rawSchedule.name,
      nextFireAt: computeNextScheduledTime({
        cron,
        now: args.now,
        timezone,
      }),
      timezone,
    });
    seenNames.add(rawSchedule.name);
  }

  return desiredNudges;
}

export async function syncManagerThreadSchedules(
  deps: LoggedWorkSessionDeps,
  args: SyncManagerThreadSchedulesArgs,
): Promise<void> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.type !== "manager" || !thread.environmentId) {
    return;
  }

  const environment = getEnvironment(deps.db, thread.environmentId);
  if (!environment) {
    deps.logger.warn(
      {
        environmentId: thread.environmentId,
        threadId: thread.id,
      },
      "Skipping ASYNC.md sync for manager thread without an environment",
    );
    return;
  }

  const threadStoragePath = requireThreadStoragePath(deps, {
    threadId: thread.id,
  });

  let content: string;
  let sizeBytes: number;
  try {
    const result = await callEngineOnlineRpc(deps, {
      timeoutMs: 10_000,
      command: {
        type: "host.read_file",
        path: path.join(threadStoragePath, ASYNC_FILE_NAME),
        rootPath: threadStoragePath,
      },
    });
    if (result.contentEncoding !== "utf8") {
      throw new ApiError(502, "invalid_request", "ASYNC.md must be UTF-8 text");
    }
    sizeBytes = result.sizeBytes;
    content = result.content;
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      replaceManagerThreadNudges(deps.db, deps.hub, {
        desiredNudges: [],
        projectId: thread.projectId,
        threadId: thread.id,
      });
      return;
    }
    throw error;
  }

  const contentSizeBytes = Buffer.byteLength(content, "utf8");
  if (
    sizeBytes > MAX_ASYNC_FILE_BYTES ||
    contentSizeBytes > MAX_ASYNC_FILE_BYTES
  ) {
    deps.logger.warn(
      {
        contentSizeBytes,
        sizeBytes,
        threadId: thread.id,
      },
      "Skipping ASYNC.md sync because the file is too large",
    );
    return;
  }

  if (!hasFrontmatterPrefix(content)) {
    replaceManagerThreadNudges(deps.db, deps.hub, {
      desiredNudges: [],
      projectId: thread.projectId,
      threadId: thread.id,
    });
    return;
  }

  if (!hasSupportedFrontmatterDelimiter(content)) {
    deps.logger.warn(
      {
        threadId: thread.id,
      },
      "Skipping ASYNC.md sync because frontmatter must start with a plain --- delimiter",
    );
    return;
  }

  const now = Date.now();
  let desiredNudges: ReplaceManagerThreadNudgeInput[] | null;
  try {
    desiredNudges = toDesiredManagerThreadNudges(deps, {
      content,
      now,
      threadId: thread.id,
    });
  } catch (error) {
    deps.logger.warn(
      {
        threadId: thread.id,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to parse ASYNC.md",
    );
    return;
  }

  if (desiredNudges === null) {
    return;
  }

  replaceManagerThreadNudges(deps.db, deps.hub, {
    desiredNudges,
    projectId: thread.projectId,
    threadId: thread.id,
  });
}
