/**
 * Surviving engine-facing types from the dead daemon session transport (P1c).
 * The durable-queue/session/enrollment halves (session open/close, command
 * batch fetch, event spool envelopes, online host-RPC WS messages, internal
 * route schemas, the daemon HTTP client) died with `apps/host-daemon`; what
 * remains are the runtime shapes the in-process engine still speaks
 * (`apps/server/src/engine/ports.ts`) until Phase 4 rehomes them.
 */
import {
  ENVIRONMENT_CHANGE_KINDS,
  jsonValueSchema,
  pendingInteractionStatusSchema,
  appDataPathSchema,
  applicationIdSchema,
  terminalColsSchema,
  terminalDataBase64Schema,
  terminalRowsSchema,
} from "@bb/domain";
import { z } from "zod";
import { workspaceContextSchema } from "./commands.js";

export const hostDaemonActiveThreadSchema = z.object({
  threadId: z.string().min(1),
});
export type HostDaemonActiveThread = z.infer<
  typeof hostDaemonActiveThreadSchema
>;

export const hostDaemonLoadedEnvironmentSchema = z.object({
  environmentId: z.string().min(1),
});
export type HostDaemonLoadedEnvironment = z.infer<
  typeof hostDaemonLoadedEnvironmentSchema
>;

export const hostDaemonTrackedThreadTargetSchema = z.object({
  environmentId: z.string().min(1),
  threadId: z.string().min(1),
});
export type HostDaemonTrackedThreadTarget = z.infer<
  typeof hostDaemonTrackedThreadTargetSchema
>;

export const hostDaemonTrackedApplicationDataTargetSchema = z.object({
  applicationId: applicationIdSchema,
  appDataPath: z.string().min(1),
});
export type HostDaemonTrackedApplicationDataTarget = z.infer<
  typeof hostDaemonTrackedApplicationDataTargetSchema
>;

export const hostDaemonEnvironmentChangeSchema = z
  .enum(ENVIRONMENT_CHANGE_KINDS)
  .extract([
    "work-status-changed",
    "git-refs-changed",
    "thread-storage-changed",
  ]);
export type HostDaemonEnvironmentChange = z.infer<
  typeof hostDaemonEnvironmentChangeSchema
>;

export const hostDaemonEnvironmentChangePayloadSchema = z.object({
  environmentId: z.string().min(1),
  change: hostDaemonEnvironmentChangeSchema,
});
export type HostDaemonEnvironmentChangePayload = z.infer<
  typeof hostDaemonEnvironmentChangePayloadSchema
>;

const hostDaemonAppDataChangePayloadBaseSchema = z
  .object({
    applicationId: applicationIdSchema,
    path: appDataPathSchema,
    value: jsonValueSchema.nullable(),
    deleted: z.boolean(),
    version: z.string().min(1).nullable(),
  })
  .strict();
type HostDaemonAppDataChangePayloadBase = z.infer<
  typeof hostDaemonAppDataChangePayloadBaseSchema
>;

function validateHostDaemonAppDataChangePayload(
  payload: HostDaemonAppDataChangePayloadBase,
  context: z.RefinementCtx,
): void {
  if (payload.deleted && payload.version !== null) {
    context.addIssue({
      code: "custom",
      path: ["version"],
      message: "version must be null for deleted app data changes",
    });
  }
  if (!payload.deleted && payload.version === null) {
    context.addIssue({
      code: "custom",
      path: ["version"],
      message: "version is required for non-deleted app data changes",
    });
  }
}

export const hostDaemonAppDataChangePayloadSchema =
  hostDaemonAppDataChangePayloadBaseSchema.superRefine(
    validateHostDaemonAppDataChangePayload,
  );
export type HostDaemonAppDataChangePayload = z.infer<
  typeof hostDaemonAppDataChangePayloadSchema
>;

export const hostDaemonAppDataResyncPayloadSchema = z
  .object({
    applicationId: applicationIdSchema,
  })
  .strict();
export type HostDaemonAppDataResyncPayload = z.infer<
  typeof hostDaemonAppDataResyncPayloadSchema
>;

const terminalIdSchema = z.string().min(1);
const terminalRequestIdSchema = z.string().min(1);
const terminalCloseReasonSchema = z.enum([
  "user",
  "process-exit",
  "daemon-disconnect",
  "environment-destroyed",
  "thread-archived",
  "thread-deleted",
  "open-timeout",
]);

export const hostDaemonTerminalOutputChunkSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    dataBase64: terminalDataBase64Schema,
  })
  .strict();

const hostDaemonTerminalOpenMessageSchema = z
  .object({
    type: z.literal("terminal.open"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    threadId: z.string().min(1),
    environmentId: z.string().min(1),
    workspaceContext: workspaceContextSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();

const hostDaemonTerminalAttachMessageSchema = z
  .object({
    type: z.literal("terminal.attach"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    sinceSeq: z.number().int().nonnegative(),
  })
  .strict();

const hostDaemonTerminalInputMessageSchema = z
  .object({
    type: z.literal("terminal.input"),
    terminalId: terminalIdSchema,
    dataBase64: terminalDataBase64Schema,
  })
  .strict();

const hostDaemonTerminalResizeMessageSchema = z
  .object({
    type: z.literal("terminal.resize"),
    terminalId: terminalIdSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();

const hostDaemonTerminalCloseMessageSchema = z
  .object({
    type: z.literal("terminal.close"),
    terminalId: terminalIdSchema,
    reason: terminalCloseReasonSchema,
  })
  .strict();

/**
 * The server→engine terminal operations (the surviving half of the old
 * server→daemon WS message union; the session-control and online host-RPC
 * members died with the transport).
 */
export const hostDaemonServerWsMessageSchema = z.discriminatedUnion("type", [
  hostDaemonTerminalOpenMessageSchema,
  hostDaemonTerminalAttachMessageSchema,
  hostDaemonTerminalInputMessageSchema,
  hostDaemonTerminalResizeMessageSchema,
  hostDaemonTerminalCloseMessageSchema,
]);
export type HostDaemonServerWsMessage = z.infer<
  typeof hostDaemonServerWsMessageSchema
>;

const hostDaemonEnvironmentChangeMessageSchema =
  hostDaemonEnvironmentChangePayloadSchema
    .extend({
      type: z.literal("environment-change"),
    })
    .strict();

const hostDaemonApplicationStorageChangedMessageSchema = z
  .object({
    type: z.literal("application-storage-changed"),
  })
  .strict();

/**
 * Raw host observation that an app's served `public/` files changed on disk.
 * The engine reports the fact; the server decides how to surface it (it
 * broadcasts a per-app `content-changed` realtime message so open app
 * surfaces live-reload).
 */
const hostDaemonApplicationContentChangedMessageSchema = z
  .object({
    type: z.literal("application-content-changed"),
    applicationId: applicationIdSchema,
  })
  .strict();

const hostDaemonTerminalOpenedMessageSchema = z
  .object({
    type: z.literal("terminal.opened"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    shell: z.string().min(1),
    title: z.string().min(1),
    initialCwd: z.string().min(1),
    currentCwd: z.string().min(1).nullable(),
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();

const hostDaemonTerminalOutputMessageSchema = z
  .object({
    type: z.literal("terminal.output"),
    terminalId: terminalIdSchema,
    chunk: hostDaemonTerminalOutputChunkSchema,
  })
  .strict();

const hostDaemonTerminalReplayMessageSchema = z
  .object({
    type: z.literal("terminal.replay"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    chunks: z.array(hostDaemonTerminalOutputChunkSchema),
    nextSeq: z.number().int().nonnegative(),
  })
  .strict();

const hostDaemonTerminalExitedMessageSchema = z
  .object({
    type: z.literal("terminal.exited"),
    terminalId: terminalIdSchema,
    exitCode: z.number().int().nullable(),
    closeReason: terminalCloseReasonSchema,
  })
  .strict();

const hostDaemonTerminalErrorMessageSchema = z
  .object({
    type: z.literal("terminal.error"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

/**
 * The engine→server runtime emissions (the surviving half of the old
 * daemon→server WS message union; heartbeat and host-RPC responses died with
 * the transport).
 */
export const hostDaemonDaemonWsMessageSchema = z.union([
  hostDaemonEnvironmentChangeMessageSchema,
  hostDaemonApplicationStorageChangedMessageSchema,
  hostDaemonApplicationContentChangedMessageSchema,
  hostDaemonTerminalOpenedMessageSchema,
  hostDaemonTerminalOutputMessageSchema,
  hostDaemonTerminalReplayMessageSchema,
  hostDaemonTerminalExitedMessageSchema,
  hostDaemonTerminalErrorMessageSchema,
]);
export type HostDaemonDaemonWsMessage = z.infer<
  typeof hostDaemonDaemonWsMessageSchema
>;

export const hostDaemonInteractiveRequestResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({
      outcome: z.literal("created"),
      interactionId: z.string().min(1),
      status: pendingInteractionStatusSchema,
    }),
    z.object({
      outcome: z.literal("existing"),
      interactionId: z.string().min(1),
      status: pendingInteractionStatusSchema,
    }),
    z.object({
      outcome: z.literal("rejected"),
      reason: z.string().min(1),
    }),
  ],
);
export type HostDaemonInteractiveRequestResponse = z.infer<
  typeof hostDaemonInteractiveRequestResponseSchema
>;
