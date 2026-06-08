/**
 * Environment intents for thread provisioning. Plain types: the queue-era
 * zod persistence schemas died with the `thread_operations` table — the
 * intent now lives only inside the in-memory provision task.
 */
import type { BaseBranchSpec, UnmanagedBranchSpec } from "@bb/server-contract";

export interface DirectUnmanagedEnvironmentIntent {
  type: "direct-unmanaged";
  hostId: string;
  path: string;
  /** Pre-thread checkout requested for the unmanaged workspace, if any. */
  branch?: UnmanagedBranchSpec;
}

export interface CheckoutUnmanagedEnvironmentIntent {
  type: "checkout-unmanaged";
  branch: UnmanagedBranchSpec;
  environmentId: string;
  hostId: string;
  path: string;
}

export interface DirectManagedEnvironmentIntent {
  type: "direct-managed";
  baseBranch: BaseBranchSpec;
  hostId: string;
  sourcePath: string;
  workspaceProvisionType: "managed-worktree";
}

export interface DirectPersonalEnvironmentIntent {
  type: "direct-personal";
  hostId: string;
  workspaceProvisionType: "personal";
}

export interface ReuseEnvironmentIntent {
  type: "reuse";
  environmentId: string;
}

export type ThreadProvisionEnvironmentIntent =
  | DirectUnmanagedEnvironmentIntent
  | CheckoutUnmanagedEnvironmentIntent
  | DirectManagedEnvironmentIntent
  | DirectPersonalEnvironmentIntent
  | ReuseEnvironmentIntent;
