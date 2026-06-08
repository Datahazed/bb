import { z } from "zod";

/**
 * Stage progression of an in-memory thread provision task. The queue-era
 * operation tables (and their requested/queued state ladder) are gone; these
 * stage values survive because the provision pipeline still tracks where a
 * thread is between metadata inference and workspace readiness.
 */
export const threadProvisioningStageValues = [
  "metadata-pending",
  "environment-pending",
  "environment-attached",
  "environment-provisioning",
  "workspace-ready",
] as const;
export const threadProvisioningStageSchema = z.enum(
  threadProvisioningStageValues,
);
export type ThreadProvisioningStage = z.infer<
  typeof threadProvisioningStageSchema
>;

export interface ThreadProvisioningState {
  environmentId: string | null;
  provisionEventSequence: number | null;
  provisioningId: string;
  stage: ThreadProvisioningStage;
  workspaceReadyEventSequence: number | null;
}
