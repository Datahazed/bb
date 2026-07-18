import { z } from "zod";

export const memberSchema = z
  .object({
    userId: z.string().min(1),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    imageUrl: z.string().nullable(),
    addedByUserId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type Member = z.infer<typeof memberSchema>;

export const memberListResponseSchema = z
  .object({ members: z.array(memberSchema) })
  .strict();
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

export const addMemberRequestSchema = z
  .object({ handle: z.string().trim().min(1).max(64) })
  .strict();
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

export const removeMemberRequestSchema = addMemberRequestSchema;
export type RemoveMemberRequest = z.infer<typeof removeMemberRequestSchema>;
