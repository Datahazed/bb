import { describe, expect, it } from "vitest";
import { jsonObjectSchema, jsonValueSchema } from "../src/json-value.js";

describe("JSON value schemas", () => {
  it("rejects excessive depth without an exception", () => {
    let value: unknown = "leaf";
    for (let depth = 0; depth < 2_000; depth += 1) {
      value = { value };
    }

    expect(() => jsonValueSchema.safeParse(value)).not.toThrow();
    expect(jsonValueSchema.safeParse(value).success).toBe(false);
  });

  it("rejects cyclic objects", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(jsonObjectSchema.safeParse(value).success).toBe(false);
  });

  it("accepts normal nested JSON objects", () => {
    expect(
      jsonObjectSchema.safeParse({
        enabled: true,
        items: [{ id: 1, label: "one" }],
      }).success,
    ).toBe(true);
  });
});
