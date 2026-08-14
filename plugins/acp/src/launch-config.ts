import {
  acpNativeReasoningSchema,
  acpPermissionCliSchema,
  acpReasoningCliSchema,
  providerNativeSkillRootsSchema,
} from "@bb/domain";
import { z } from "zod";

export const acpLaunchConfigSchema = z
  .object({
    displayName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string().min(1), z.string()),
    cwd: z.string().min(1).optional(),
    modelCli: z
      .object({
        listArgs: z.array(z.string()),
        selectFlag: z.string().min(1).optional(),
        primaryModels: z.array(z.string()),
      })
      .strict()
      .transform((value) => (value.listArgs.length > 0 ? value : undefined))
      .optional(),
    reasoningCli: acpReasoningCliSchema.optional(),
    nativeReasoning: acpNativeReasoningSchema.optional(),
    nativeSkillRoots: providerNativeSkillRootsSchema.optional(),
    permissionCli: acpPermissionCliSchema.optional(),
  })
  .strict();

export type AcpLaunchConfig = z.infer<typeof acpLaunchConfigSchema>;

export function normalizeAcpLaunchConfig(
  config: AcpLaunchConfig,
): AcpLaunchConfig {
  const permissionCliHasMode =
    config.permissionCli?.full !== undefined ||
    config.permissionCli?.workspaceWrite !== undefined ||
    config.permissionCli?.readonly !== undefined;
  return {
    displayName: config.displayName,
    command: config.command,
    args: config.args,
    env: config.env,
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(config.modelCli !== undefined ? { modelCli: config.modelCli } : {}),
    ...(config.reasoningCli !== undefined
      ? { reasoningCli: config.reasoningCli }
      : {}),
    ...(config.nativeReasoning !== undefined
      ? { nativeReasoning: config.nativeReasoning }
      : {}),
    ...(config.nativeSkillRoots !== undefined
      ? { nativeSkillRoots: config.nativeSkillRoots }
      : {}),
    ...(config.permissionCli !== undefined && permissionCliHasMode
      ? { permissionCli: config.permissionCli }
      : {}),
  };
}
