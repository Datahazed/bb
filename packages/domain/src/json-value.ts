import { z } from "zod";

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const textEncoder = new TextEncoder();

interface JsonValidationFrame {
  depth: number;
  value: unknown;
}

function encodedJsonStringBytes(value: string): number {
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

function isJsonValue(value: unknown): value is JsonValue {
  const stack: JsonValidationFrame[] = [{ depth: 0, value }];
  const seenObjects = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      break;
    }
    nodes += 1;
    if (nodes > MAX_JSON_NODES || frame.depth > MAX_JSON_DEPTH) {
      return false;
    }

    const candidate = frame.value;
    if (candidate === null) {
      bytes += 4;
    } else if (typeof candidate === "string") {
      bytes += encodedJsonStringBytes(candidate);
    } else if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        return false;
      }
      bytes += String(candidate).length;
    } else if (typeof candidate === "boolean") {
      bytes += candidate ? 4 : 5;
    } else if (typeof candidate === "object") {
      if (seenObjects.has(candidate)) {
        return false;
      }
      seenObjects.add(candidate);
      if (Array.isArray(candidate)) {
        bytes += 2 + Math.max(0, candidate.length - 1);
        for (const item of candidate) {
          stack.push({ depth: frame.depth + 1, value: item });
        }
      } else {
        const prototype = Object.getPrototypeOf(candidate);
        if (prototype !== Object.prototype && prototype !== null) {
          return false;
        }
        const entries = Object.entries(candidate);
        bytes += 2 + Math.max(0, entries.length - 1);
        for (const [key, item] of entries) {
          bytes += encodedJsonStringBytes(key) + 1;
          stack.push({ depth: frame.depth + 1, value: item });
        }
      }
    } else {
      return false;
    }

    if (bytes > MAX_JSON_BYTES) {
      return false;
    }
  }

  return true;
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(
  isJsonValue,
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.custom<JsonObject>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isJsonValue(value),
);
