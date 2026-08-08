import { toRecord } from "@bb/core-ui";
import { HttpError } from "@/lib/api";
import { BbHttpError } from "@/lib/sdk";

/**
 * Staleness window for prompt-history queries. Shared by the thread- and
 * project-scoped variants so they age out their cached suggestions together.
 */
export const PROMPT_HISTORY_STALE_TIME_MS = 10_000;
export const TRANSIENT_READ_MAX_ATTEMPTS = 5;
export const TRANSIENT_READ_RETRY_BASE_DELAY_MS = 250;
export const TRANSIENT_READ_RETRY_MAX_DELAY_MS = 4_000;

interface RequireEnabledQueryArgArgs<T> {
  value: T | null | undefined;
  hookName: string;
  argName: string;
}

/**
 * Asserts a query argument is present once its query is enabled. Query hooks
 * gate `enabled` on their id/arg being set, so the queryFn only runs with a
 * real value — this turns that invariant into a typed non-null at the call
 * site, and throws (rather than firing a request with a missing arg) if the
 * invariant is ever violated. Treats empty string as missing so a blank id is
 * rejected the same as null/undefined; a numeric `0` is kept.
 */
export function requireEnabledQueryArg<T>({
  value,
  hookName,
  argName,
}: RequireEnabledQueryArgArgs<T>): T {
  if (value == null || value === "") {
    throw new Error(
      `${hookName}: ${argName} is required when query is enabled`,
    );
  }
  return value;
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isTransientReadError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }

  if (toRecord(error)?.name === "AbortError") {
    return false;
  }
  if (error instanceof HttpError || error instanceof BbHttpError) {
    return error.retryable;
  }

  const record = toRecord(error);
  if (!record || typeof record.message !== "string") {
    return false;
  }

  const message = normalizeErrorMessage(record.message);
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("networkerror")
  );
}

export function shouldRetryTransientReadQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= TRANSIENT_READ_MAX_ATTEMPTS - 1) {
    return false;
  }

  return isTransientReadError(error);
}

export function getTransientReadRetryDelay(attemptIndex: number): number {
  const boundedAttemptIndex = Math.max(0, attemptIndex);
  const exponentialDelay = Math.min(
    TRANSIENT_READ_RETRY_BASE_DELAY_MS * 2 ** boundedAttemptIndex,
    TRANSIENT_READ_RETRY_MAX_DELAY_MS,
  );
  const jitterRange = exponentialDelay / 2;
  return Math.floor(jitterRange + Math.random() * jitterRange);
}
