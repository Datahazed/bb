import type { CustomProviderModel } from "@bb/config/bb-app-managed-config";
import type { DbConnection } from "@bb/db";
import type { FeatureFlags } from "@bb/domain";
import type { Logger } from "@bb/logger";
import type { EngineCommandDispatcher } from "./services/engine/engine-dispatch.js";
import type { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import type { EnvironmentLifecycle } from "./services/lifecycle/environment-lifecycle.js";
import type { ProjectLifecycle } from "./services/lifecycle/project-lifecycle.js";
import type { ThreadRuntimeLifecycle } from "./services/lifecycle/thread-runtime-lifecycle.js";
import type { AppVersionService } from "./services/system/app-version.js";
import type { BbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import type { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import type { LifecycleDedupers } from "./lifecycle-dedupers.js";
import type { NotificationHub } from "./ws/hub.js";

export type ServerLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

export interface ServerRuntimeConfig {
  appVersion: string;
  builtinSkillsRootPath: string;
  customModels: CustomProviderModel[];
  dataDir: string;
  featureFlags: FeatureFlags;
  inferenceModel: string;
  isDevelopment: boolean;
  openAiApiKey: string;
  serverPort: number;
  threadStorageRootPath: string;
  transcriptionModel: string;
  appUrl?: string;
  devAppPort?: number;
}

export interface AppDeps {
  config: ServerRuntimeConfig;
  db: DbConnection;
  /** The in-process dispatcher — the only runtime path for engine commands. */
  engineDispatch: EngineCommandDispatcher;
  environmentLifecycle: EnvironmentLifecycle;
  hub: NotificationHub;
  lifecycleDedupers: LifecycleDedupers;
  logger: ServerLogger;
  pendingInteractions: PendingInteractionLifecycle;
  projectLifecycle: ProjectLifecycle;
  terminalSessions: TerminalSessionLifecycle;
  threadLifecycle: ThreadRuntimeLifecycle;
}

export interface ServerAppDeps extends AppDeps {
  appVersion: AppVersionService;
  bbAppManagedConfig: BbAppManagedConfigReloader;
}

export type LifecycleDeps = Pick<
  AppDeps,
  "config" | "db" | "engineDispatch" | "hub" | "lifecycleDedupers"
>;

export type WorkSessionDeps = LifecycleDeps;

export type LoggedWorkSessionDeps = WorkSessionDeps & Pick<AppDeps, "logger">;

export type PendingInteractionWorkSessionDeps = WorkSessionDeps &
  Pick<
    AppDeps,
    "environmentLifecycle" | "pendingInteractions" | "threadLifecycle"
  >;

export type LoggedPendingInteractionWorkSessionDeps =
  PendingInteractionWorkSessionDeps & Pick<AppDeps, "logger">;
