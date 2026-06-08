import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";
import { runtimeErrorLogFields } from "./error-log-fields.js";

export interface ScheduleDetachedWorkArgs {
  config: Pick<ServerRuntimeConfig, "isDevelopment">;
  context?: Record<string, boolean | number | string | null | undefined>;
  logger: Pick<ServerLogger, "warn">;
  name: string;
  work: () => Promise<void>;
}

/**
 * Runs follow-up work off the caller's critical path (next macrotask),
 * logging failures instead of propagating them. Used where settlement or a
 * request handler must respond before dependent work (which may itself
 * dispatch and wait on engine commands) is allowed to start — running it
 * inline could deadlock the engine router's serialized report chain.
 */
export function scheduleDetachedWork(args: ScheduleDetachedWorkArgs): void {
  setImmediate(() => {
    void args.work().catch((error) => {
      args.logger.warn(
        {
          ...args.context,
          ...runtimeErrorLogFields(args.config, error),
        },
        `${args.name} failed`,
      );
    });
  });
}
