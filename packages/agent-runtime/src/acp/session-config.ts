/**
 * Internal configuration shapes used by the canonical ACP driver.
 *
 * These schemas describe profile-derived launch, model, and session settings.
 */

import {
  acpPermissionCliSchema as acpBridgePermissionCliSchema,
  acpNativeReasoningSchema as acpBridgeNativeReasoningSchema,
  acpReasoningCliSchema as acpBridgeReasoningCliSchema,
  dynamicToolSchema,
  permissionEscalationSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import { z } from "zod";
import {} from "./wire.js";

// ---------------------------------------------------------------------------
// Runtime → bridge commands
// ---------------------------------------------------------------------------

const acpBridgeAgentCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
});
export type AcpBridgeAgentCommand = z.infer<typeof acpBridgeAgentCommandSchema>;

/**
 * Id of the synthetic "Agent default" model the driver serves when the agent's
 * model list cannot be read. Never forwarded to the agent.
 */
export const ACP_DEFAULT_MODEL_ID = "acp-default";

export type AcpBridgeReasoningCli = z.infer<typeof acpBridgeReasoningCliSchema>;

export type AcpBridgeNativeReasoning = z.infer<
  typeof acpBridgeNativeReasoningSchema
>;

export type AcpBridgePermissionCli = z.infer<
  typeof acpBridgePermissionCliSchema
>;

export const acpBridgeModelListParamsSchema = z.object({
  /**
   * Command whose stdout lists one `id - Display Name` line per model. The
   * bridge groups the ids into model families with reasoning-effort variants
   * (see `model-catalog.ts`), falling back to the synthetic "Agent
   * default" entry when the command fails or lists nothing. Optional so a
   * minimal `model/list` (e.g. the packaged-driver smoke test, which has no
   * agent binary) still gets a valid synthetic response instead of hanging.
   */
  listCommand: acpBridgeAgentCommandSchema.optional(),
  /**
   * ACP-native model discovery command. Used only when `listCommand` is
   * absent: the driver starts a throwaway session and reads the model select
   * from the `session/new` result's config state.
   */
  agent: acpBridgeAgentCommandSchema.optional(),
  /**
   * Family ids served in the picker's default list; the rest become
   * selected-only "more models". No matches (or an empty list) serves
   * everything as primary.
   */
  primaryModels: z.array(z.string()).default([]),
  reasoningCli: acpBridgeReasoningCliSchema.optional(),
  nativeReasoning: acpBridgeNativeReasoningSchema.optional(),
});

/**
 * Session-level model pin. CLI-style agents resolve (model, reasoningLevel,
 * serviceTier) to a raw model id and launch with `<selectFlag> <resolved-id>`.
 * ACP-native agents receive `{ modelId }` after `session/new` — via their
 * "model"-category config option (`session/set_config_option`) when they
 * advertise one, otherwise via legacy `session/set_model`; if they expose a
 * `thought_level` config option, the driver applies `reasoningLevel` via
 * `session/set_config_option`. Absent when the thread has no model preference.
 */
const acpBridgeCliModelSelectionSchema = z.object({
  listCommand: acpBridgeAgentCommandSchema,
  selectFlag: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: reasoningLevelSchema.optional(),
  serviceTier: serviceTierSchema.optional(),
});

const acpBridgeNativeModelSelectionSchema = z.object({
  modelId: z.string().min(1),
  reasoningLevel: reasoningLevelSchema.optional(),
});

const acpBridgeModelSelectionSchema = z.union([
  acpBridgeCliModelSelectionSchema,
  acpBridgeNativeModelSelectionSchema,
]);
export type AcpBridgeModelSelection = z.infer<
  typeof acpBridgeModelSelectionSchema
>;

const acpBridgeSessionParamsSchema = z.object({
  threadId: z.string().min(1),
  cwd: z.string().min(1),
  agent: acpBridgeAgentCommandSchema,
  modelSelection: acpBridgeModelSelectionSchema.optional(),
  /**
   * Launch-time reasoning level for agents that take reasoning as a global CLI
   * flag rather than an ACP `thought_level` config option.
   */
  launchReasoningLevel: reasoningLevelSchema.optional(),
  reasoningCli: acpBridgeReasoningCliSchema.optional(),
  nativeReasoning: acpBridgeNativeReasoningSchema.optional(),
  /**
   * Launch-time permission flags for agents whose own prompt policy must be
   * selected by CLI args rather than by ACP permission responses.
   */
  permissionCli: acpBridgePermissionCliSchema.optional(),
  permissionMode: z.enum(["accept-edits", "full"]),
  permissionEscalation: permissionEscalationSchema.nullable(),
  /** Roots (workspace plus configured extras) where client fs writes are allowed. */
  workspaceWriteRoots: z.array(z.string()),
  envVars: z.record(z.string(), z.string()).optional(),
  /** Server-owned instructions; prepended to the session's first prompt. */
  instructions: z.string().optional(),
  dynamicTools: z.array(dynamicToolSchema).optional(),
});

const acpBridgeThreadStartParamsSchema = acpBridgeSessionParamsSchema;
export type AcpBridgeThreadStartParams = z.infer<
  typeof acpBridgeThreadStartParamsSchema
>;
