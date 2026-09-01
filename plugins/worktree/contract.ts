import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const baseBranchSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("default") }).strict(),
]);

export type BaseBranchSpec = z.infer<typeof baseBranchSpecSchema>;

export const worktreeHostContract = defineRpcContract({
  create: {
    input: z
      .object({
        threadId: z.string().min(1),
        sourcePath: z.string().min(1),
        baseBranch: baseBranchSpecSchema,
        setupScript: z.string().min(1),
      })
      .strict(),
    output: z.object({ path: z.string().min(1) }).strict(),
  },
  teardown: {
    input: z
      .object({
        path: z.string().min(1),
        teardownScript: z.string().min(1),
      })
      .strict(),
    output: z.null(),
  },
});
