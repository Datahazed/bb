import { z } from "zod";

export const BB_DESKTOP_STARTUP_ERROR_ACTION_CHANNEL =
  "bb-desktop:startup-error:action";

/** Recovery buttons the startup error view can offer. */
export const STARTUP_ERROR_ACTIONS = ["retry", "use-this-mac"] as const;

export type StartupErrorAction = (typeof STARTUP_ERROR_ACTIONS)[number];

export const startupErrorActionRequestSchema = z
  .object({
    action: z.enum(STARTUP_ERROR_ACTIONS),
  })
  .strict();
export type StartupErrorActionRequest = z.infer<
  typeof startupErrorActionRequestSchema
>;
