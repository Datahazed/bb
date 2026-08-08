import type {
  ListThreadsForProjectsOptions,
  ListThreadsOptions,
  SlowDbQueryLogFields,
} from "@bb/db";
import {
  threadListEntrySchema,
  threadChildOriginSchema,
  threadOriginKindSchema,
} from "@bb/domain";
import { z } from "zod";

const listThreadsOptionsSchema = z
  .object({
    archived: z.boolean().optional(),
    childOrigin: threadChildOriginSchema.optional(),
    hasParent: z.boolean().optional(),
    includeHidden: z.boolean().optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    originKind: threadOriginKindSchema.optional(),
    originPluginId: z.string().optional(),
    parentThreadId: z.string().optional(),
    projectId: z.string().optional(),
    sectionId: z.string().optional(),
    sourceThreadId: z.string().optional(),
    unsectioned: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ListThreadsOptions>;

const listThreadsForProjectsOptionsSchema = z
  .object({
    archived: z.boolean().optional(),
    projectIds: z.array(z.string()),
  })
  .strict() satisfies z.ZodType<ListThreadsForProjectsOptions>;

const slowDbQueryLogFieldsSchema = z.object({
  bindingArgumentCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  operation: z.enum(["all", "get", "run"]),
  sql: z.string(),
  thresholdMs: z.number().nonnegative(),
}) satisfies z.ZodType<SlowDbQueryLogFields>;

export const databaseReadWorkerDataSchema = z
  .object({
    databasePath: z.string().min(1),
  })
  .strict();

export type DatabaseReadWorkerData = z.infer<
  typeof databaseReadWorkerDataSchema
>;

export const databaseReadWorkerRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        id: z.number().int().nonnegative(),
        daemonSessions: z.array(
          z
            .object({
              hostId: z.string(),
              sessionId: z.string(),
            })
            .strict(),
        ),
        operation: z.literal("listThreadEntries"),
        options: listThreadsOptionsSchema,
      })
      .strict(),
    z
      .object({
        id: z.number().int().nonnegative(),
        daemonSessions: z.array(
          z
            .object({
              hostId: z.string(),
              sessionId: z.string(),
            })
            .strict(),
        ),
        operation: z.literal("listThreadEntriesForProjects"),
        options: listThreadsForProjectsOptionsSchema,
      })
      .strict(),
  ],
);

export type DatabaseReadWorkerRequest = z.infer<
  typeof databaseReadWorkerRequestSchema
>;

const workerErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

export const databaseReadWorkerMessageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
    })
    .strict(),
  z
    .object({
      fields: slowDbQueryLogFieldsSchema,
      kind: z.literal("log"),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      error: workerErrorSchema,
      id: z.number().int().nonnegative(),
      kind: z.literal("error"),
    })
    .strict(),
  z
    .object({
      id: z.number().int().nonnegative(),
      kind: z.literal("result"),
      entries: z.array(threadListEntrySchema),
    })
    .strict(),
]);

export type DatabaseReadWorkerMessage = z.infer<
  typeof databaseReadWorkerMessageSchema
>;
