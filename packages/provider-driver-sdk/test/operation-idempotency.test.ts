import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderDriverOperationCapacityError,
  ProviderDriverOperationConflictError,
  ProviderDriverOperationLedger,
} from "../src/index.js";

const resultSchema = z.object({ value: z.string() }).strict();

function deferred<Result>() {
  let settle = (_result: Result): void => {};
  const promise = new Promise<Result>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (result: Result) => settle(result) };
}

describe("ProviderDriverOperationLedger", () => {
  it("deduplicates concurrent and completed operations", async () => {
    const ledger = new ProviderDriverOperationLedger();
    const operation = deferred<{ value: string }>();
    const execute = vi.fn(() => operation.promise);
    const args = {
      execute,
      kind: "turn.submit",
      operationId: "operation-1",
      params: { input: "hello" },
      resultSchema,
    };

    const first = ledger.run(args);
    const concurrentReplay = ledger.run(args);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    operation.resolve({ value: "accepted" });

    await expect(first).resolves.toEqual({
      replayed: false,
      result: { value: "accepted" },
    });
    await expect(concurrentReplay).resolves.toEqual({
      replayed: true,
      result: { value: "accepted" },
    });
    await expect(ledger.run(args)).resolves.toEqual({
      replayed: true,
      result: { value: "accepted" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects conflicting reuse and capacity without evicting records", async () => {
    const ledger = new ProviderDriverOperationLedger({ maximum: 1 });
    await ledger.run({
      execute: () => ({ value: "first" }),
      kind: "session.open",
      operationId: "operation-1",
      params: { value: 1 },
      resultSchema,
    });

    await expect(
      ledger.run({
        execute: () => ({ value: "conflict" }),
        kind: "session.open",
        operationId: "operation-1",
        params: { value: 2 },
        resultSchema,
      }),
    ).rejects.toBeInstanceOf(ProviderDriverOperationConflictError);
    await expect(
      ledger.run({
        execute: () => ({ value: "second" }),
        kind: "session.open",
        operationId: "operation-2",
        params: { value: 2 },
        resultSchema,
      }),
    ).rejects.toBeInstanceOf(ProviderDriverOperationCapacityError);
    expect(ledger.size).toBe(1);
  });

  it("allows retry after a failed execution", async () => {
    const ledger = new ProviderDriverOperationLedger();
    const execute = vi
      .fn<() => { value: string }>()
      .mockImplementationOnce(() => {
        throw new Error("transient failure");
      })
      .mockReturnValue({ value: "success" });
    const args = {
      execute,
      kind: "session.open",
      operationId: "operation-1",
      params: {},
      resultSchema,
    };

    await expect(ledger.run(args)).rejects.toThrow("transient failure");
    await expect(ledger.run(args)).resolves.toEqual({
      replayed: false,
      result: { value: "success" },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
