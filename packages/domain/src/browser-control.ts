import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";

export const BROWSER_CONTROL_MAX_SCRIPT_SOURCE_BYTES = 64 * 1024;
export const BROWSER_CONTROL_MAX_INPUT_BYTES = 64 * 1024;
export const BROWSER_CONTROL_MAX_RESULT_BYTES = 9 * 1024 * 1024;
export const BROWSER_CONTROL_MIN_TIMEOUT_MS = 100;
export const BROWSER_CONTROL_MAX_TIMEOUT_MS = 120_000;

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const browserPageLocatorSchema = z
  .object({
    selectors: z.array(z.string().min(1).max(2_048)).min(1).max(8),
  })
  .strict();
export type BrowserPageLocator = z.infer<typeof browserPageLocatorSchema>;

export const browserTabDescriptorSchema = z
  .object({
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    threadId: z.string().min(1).max(256).nullable(),
    projectId: z.string().min(1).max(256).nullable(),
    url: z.string().max(16_384),
    title: z.string().max(2_048).nullable(),
    active: z.boolean(),
    navigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserTabDescriptor = z.infer<typeof browserTabDescriptorSchema>;

export const browserTabTargetSchema = browserTabDescriptorSchema.pick({
  clientId: true,
  windowId: true,
  tabId: true,
  navigationEpoch: true,
});
export type BrowserTabTarget = z.infer<typeof browserTabTargetSchema>;

const locatorTargetSchema = z
  .object({ target: z.literal("locator"), locator: browserPageLocatorSchema })
  .strict();
const pointTargetSchema = z
  .object({
    target: z.literal("point"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })
  .strict();
const browserPointerTargetSchema = z.discriminatedUnion("target", [
  locatorTargetSchema,
  pointTargetSchema,
]);

export const browserControlActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("snapshot"),
      mode: z.enum(["dom", "interactive"]),
      maxNodes: z.number().int().min(1).max(2_000).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("click"), target: browserPointerTargetSchema })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      locator: browserPageLocatorSchema,
      text: z.string().max(65_536),
      clear: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.string().min(1).max(64),
      code: z.string().min(1).max(64).optional(),
      modifiers: z
        .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
        .max(4)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scroll"),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      deltaX: z.number().finite().optional(),
      deltaY: z.number().finite().optional(),
      behavior: z.enum(["auto", "smooth"]).optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.x !== undefined ||
        value.y !== undefined ||
        value.deltaX !== undefined ||
        value.deltaY !== undefined,
      "scroll requires an absolute position or delta",
    ),
  z
    .object({
      kind: z.literal("navigate"),
      url: z.string().min(1).max(16_384),
    })
    .strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      format: z.enum(["png", "jpeg"]).optional(),
      quality: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("script"),
      world: z.enum(["isolated", "main"]).optional(),
      source: z
        .string()
        .min(1)
        .refine(
          (value) =>
            new TextEncoder().encode(value).byteLength <=
            BROWSER_CONTROL_MAX_SCRIPT_SOURCE_BYTES,
          "Browser script source exceeds the byte limit",
        ),
      input: jsonValueSchema.refine(
        (value) => jsonByteLength(value) <= BROWSER_CONTROL_MAX_INPUT_BYTES,
        "Browser script input exceeds the byte limit",
      ),
      timeoutMs: z
        .number()
        .int()
        .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
        .max(BROWSER_CONTROL_MAX_TIMEOUT_MS),
    })
    .strict(),
]);
export type BrowserControlAction = z.infer<typeof browserControlActionSchema>;

export const browserClientStateMessageSchema = z
  .object({
    type: z.literal("browser-client-state"),
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    tabs: z
      .array(
        browserTabDescriptorSchema.omit({ clientId: true, windowId: true }),
      )
      .max(128),
  })
  .strict();
export type BrowserClientStateMessage = z.infer<
  typeof browserClientStateMessageSchema
>;

export const browserControlRequestMessageSchema = z
  .object({
    type: z.literal("browser-control-request"),
    requestId: z.string().min(1).max(128),
    target: browserTabTargetSchema,
    action: browserControlActionSchema,
  })
  .strict();
export type BrowserControlRequestMessage = z.infer<
  typeof browserControlRequestMessageSchema
>;

export const browserControlCancelMessageSchema = z
  .object({
    type: z.literal("browser-control-cancel"),
    requestId: z.string().min(1).max(128),
    reason: z.enum(["cancelled", "timeout", "client-disconnected"]),
  })
  .strict();
export type BrowserControlCancelMessage = z.infer<
  typeof browserControlCancelMessageSchema
>;

export const browserControlResponseMessageSchema = z
  .object({
    type: z.literal("browser-control-response"),
    requestId: z.string().min(1).max(128),
    target: browserTabTargetSchema,
    ok: z.boolean(),
    value: jsonValueSchema.optional(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2_048),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ok === (value.value === undefined) ||
      value.ok === (value.error !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "successful responses require value; failures require error",
      });
    }
    if (jsonByteLength(value) > BROWSER_CONTROL_MAX_RESULT_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Browser response is too large",
      });
    }
  });
export type BrowserControlResponseMessage = z.infer<
  typeof browserControlResponseMessageSchema
>;
