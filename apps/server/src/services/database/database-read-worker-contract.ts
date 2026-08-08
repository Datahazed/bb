import type {
  ListThreadsForProjectsOptions,
  ListThreadsOptions,
  SlowDbQueryLogFields,
} from "@bb/db";
import { threadChildOriginSchema, threadOriginKindSchema } from "@bb/domain";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { z } from "zod";

const listThreadsOptionsShape = {
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
} satisfies Record<keyof ListThreadsOptions, z.ZodType>;

const listThreadsOptionsSchema = z
  .object(listThreadsOptionsShape)
  .strict() satisfies z.ZodType<ListThreadsOptions>;

const listThreadsForProjectsOptionsShape = {
  archived: z.boolean().optional(),
  projectIds: z.array(z.string()),
} satisfies Record<keyof ListThreadsForProjectsOptions, z.ZodType>;

const listThreadsForProjectsOptionsSchema = z
  .object(listThreadsForProjectsOptionsShape)
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
    slowQueryThresholdMs: z.number().nonnegative(),
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
        operation: z.literal("listProjectsWithThreads"),
        options: z
          .object({
            includePersonal: z.boolean(),
          })
          .strict(),
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
        operation: z.literal("sidebarBootstrap"),
      })
      .strict(),
  ],
);

export type DatabaseReadWorkerRequest = z.infer<
  typeof databaseReadWorkerRequestSchema
>;

export const databaseReadWorkerRequestIdSchema = z
  .object({
    id: z.number().int().nonnegative(),
  })
  .passthrough();

const workerErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

const databaseReadWorkerResultSchema = z.discriminatedUnion("operation", [
  z
    .object({
      droppedEntryCount: z.number().int().nonnegative(),
      entries: z.custom<ThreadListEntry[]>(
        (value): value is ThreadListEntry[] => Array.isArray(value),
      ),
      operation: z.literal("listThreadEntries"),
    })
    .strict(),
  z
    .object({
      droppedEntryCount: z.number().int().nonnegative(),
      entries: z.custom<ThreadListEntry[]>(
        (value): value is ThreadListEntry[] => Array.isArray(value),
      ),
      operation: z.literal("listThreadEntriesForProjects"),
    })
    .strict(),
  z
    .object({
      droppedEntryCount: z.number().int().nonnegative(),
      operation: z.literal("listProjectsWithThreads"),
      projects: z.custom<ProjectWithThreadsResponse[]>(
        (value): value is ProjectWithThreadsResponse[] => Array.isArray(value),
      ),
    })
    .strict(),
  z
    .object({
      droppedEntryCount: z.number().int().nonnegative(),
      operation: z.literal("sidebarBootstrap"),
      response: z.custom<SidebarBootstrapResponse>(
        (value) => typeof value === "object" && value !== null,
      ),
    })
    .strict(),
]);

export type DatabaseReadWorkerResult = z.infer<
  typeof databaseReadWorkerResultSchema
>;

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
      result: databaseReadWorkerResultSchema,
    })
    .strict(),
]);

export type DatabaseReadWorkerMessage = z.infer<
  typeof databaseReadWorkerMessageSchema
>;
