/**
 * Shared plumbing for the Phase 2 lifecycle modules
 * (`thread-runtime-lifecycle.ts`, `environment-lifecycle.ts`,
 * `project-lifecycle.ts`, `boot-reconciliation.ts`).
 *
 * Lifecycle state lives in memory (task maps with explicit ownership, plan
 * Decision 1/11); the database stays authoritative for thread/environment
 * status, `stopRequestedAt`, `cleanupRequestedAt`/`cleanupMode`, events, and
 * `client_turn_requests`. A crash drops the in-memory tasks; boot
 * reconciliation interrupts everything cleanly on the next start.
 */
import type { DbNotifier, DbTransaction } from "@bb/db";
import type { AppDeps } from "../../types.js";
import type { EngineDispatchBuffer } from "../engine/engine-dispatch.js";

/**
 * The full dependency slice the lifecycle modules own at construction. They
 * are built once at boot (and once per test harness) and live on `AppDeps`.
 */
export type LifecycleServiceDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "engineDispatch"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "pendingInteractions"
  | "terminalSessions"
>;

/**
 * In-transaction context threaded through lifecycle settlement helpers:
 * notifications buffer until commit, engine dispatches stage until commit
 * (a rolled-back transaction discards both).
 */
export interface LifecycleTransactionContext {
  db: DbTransaction;
  engineDispatches: EngineDispatchBuffer;
  hub: DbNotifier;
}
