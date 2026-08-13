import { createHash } from "node:crypto";
import type { z } from "zod";

const DEFAULT_MAX_PROVIDER_DRIVER_OPERATION_RECORDS = 100_000;

interface OperationRecord {
  readonly kind: string;
  readonly paramsDigest: string;
  readonly result: Promise<unknown>;
}

export interface ProviderDriverOperationOutcome<Result> {
  readonly replayed: boolean;
  readonly result: Result;
}

export class ProviderDriverOperationConflictError extends Error {
  constructor(readonly operationId: string) {
    super(`Provider driver operation ${operationId} has conflicting semantics`);
    this.name = "ProviderDriverOperationConflictError";
  }
}

export class ProviderDriverOperationCapacityError extends Error {
  constructor(readonly maximum: number) {
    super(`Provider driver retained the maximum ${maximum} operation records`);
    this.name = "ProviderDriverOperationCapacityError";
  }
}

export class ProviderDriverOperationResultError extends Error {
  constructor(kind: string, options: ErrorOptions) {
    super(`Provider driver returned an invalid result for ${kind}`, options);
    this.name = "ProviderDriverOperationResultError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalJson(entryValue)}`,
    )
    .join(",")}}`;
}

function paramsDigest(params: unknown): string {
  return createHash("sha256").update(canonicalJson(params)).digest("hex");
}

/**
 * Process-generation operation ledger.
 *
 * Successful results are retained so a repeated operation ID cannot execute
 * provider input twice. Failed executions are removed and can be retried. At
 * capacity the ledger rejects new operations rather than evicting records and
 * silently weakening idempotency.
 */
export class ProviderDriverOperationLedger {
  private readonly maximum: number;
  private readonly records = new Map<string, OperationRecord>();

  constructor(options: { maximum?: number } = {}) {
    this.maximum =
      options.maximum ?? DEFAULT_MAX_PROVIDER_DRIVER_OPERATION_RECORDS;
    if (!Number.isSafeInteger(this.maximum) || this.maximum <= 0) {
      throw new Error("Provider driver operation capacity must be positive");
    }
  }

  get size(): number {
    return this.records.size;
  }

  async run<Result>(args: {
    execute(): Promise<Result> | Result;
    kind: string;
    operationId: string;
    params: unknown;
    resultSchema: z.ZodType<Result>;
  }): Promise<ProviderDriverOperationOutcome<Result>> {
    const digest = paramsDigest(args.params);
    const existing = this.records.get(args.operationId);
    if (existing) {
      if (existing.kind !== args.kind || existing.paramsDigest !== digest) {
        throw new ProviderDriverOperationConflictError(args.operationId);
      }
      return {
        replayed: true,
        result: args.resultSchema.parse(await existing.result),
      };
    }
    if (this.records.size >= this.maximum) {
      throw new ProviderDriverOperationCapacityError(this.maximum);
    }

    const result = Promise.resolve()
      .then(args.execute)
      .then((value) => {
        const parsed = args.resultSchema.safeParse(value);
        if (!parsed.success) {
          throw new ProviderDriverOperationResultError(args.kind, {
            cause: parsed.error,
          });
        }
        return parsed.data;
      });
    const record: OperationRecord = {
      kind: args.kind,
      paramsDigest: digest,
      result,
    };
    this.records.set(args.operationId, record);
    try {
      return {
        replayed: false,
        result: await result,
      };
    } catch (error) {
      if (this.records.get(args.operationId) === record) {
        this.records.delete(args.operationId);
      }
      throw error;
    }
  }
}
