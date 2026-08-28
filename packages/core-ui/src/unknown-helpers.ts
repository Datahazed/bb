type ErrorFunction = (...args: never[]) => never;
type ErrorValue =
  | string
  | number
  | boolean
  | null
  | ErrorFunction
  | ErrorRecord
  | ErrorValue[];
type ErrorRecord = { readonly [key: string]: ErrorValue };

interface ErrorExtractionOptions {
  readonly legacyKeys?: readonly string[];
}

function isText<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isFunction<T>(value: T): value is T & ErrorFunction {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Function]" || tag === "[object AsyncFunction]";
}

function isRecord<T>(value: T): value is T & ErrorRecord {
  return Object(value) === value && !Array.isArray(value) && !isFunction(value);
}

function parseErrorValue<T>(value: T): ErrorValue | null {
  if (isText(value) || isFunction(value)) return value;
  if (Array.isArray(value)) {
    const parsedItems: ErrorValue[] = [];
    for (const item of value) {
      const parsedItem = parseErrorValue(item);
      if (parsedItem !== null) parsedItems.push(parsedItem);
    }
    return parsedItems;
  }
  if (!isRecord(value)) return null;
  const parsedRecord: Record<string, ErrorValue> = {};
  const keys = new Set([
    ...Object.keys(value),
    "body",
    "detail",
    "headers",
    "message",
    "name",
    "status",
  ]);
  for (const key of keys) {
    const parsedValue = parseErrorValue(value[key]);
    if (parsedValue !== null) parsedRecord[key] = parsedValue;
  }
  return parsedRecord;
}

export function toRecord<T>(value: T): ErrorRecord | null {
  const parsedValue = parseErrorValue(value);
  return parsedValue !== null && isRecord(parsedValue) ? parsedValue : null;
}

export function extractErrorMessage<T>(
  value: T,
  opts?: ErrorExtractionOptions,
): string | null {
  const parsedValue = parseErrorValue(value);
  if (parsedValue === null) return null;
  if (isText(parsedValue)) {
    const normalized = parsedValue.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) return null;
    return normalized;
  }
  if (Array.isArray(parsedValue)) {
    for (const item of parsedValue) {
      const message = extractErrorMessage(item, opts);
      if (message) return message;
    }
    return null;
  }
  const record = toRecord(parsedValue);
  if (!record) return null;
  if (isText(record.message)) {
    const message = extractErrorMessage(record.message, opts);
    if (message) return message;
  }
  for (const key of opts?.legacyKeys ?? ["detail"]) {
    const message = extractErrorMessage(record[key], opts);
    if (message) return message;
  }
  return null;
}
