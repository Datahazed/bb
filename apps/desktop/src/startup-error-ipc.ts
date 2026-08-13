import { z } from "zod";

export const BB_DESKTOP_STARTUP_ERROR_ACTION_CHANNEL =
  "bb-desktop:startup-error:action";

/** Recovery buttons the startup error view can offer. */
export const STARTUP_ERROR_ACTIONS = ["retry", "use-this-mac"] as const;

export type StartupErrorAction = (typeof STARTUP_ERROR_ACTIONS)[number];

export const startupErrorActionRequestSchema = z
  .object({
    action: z.enum(STARTUP_ERROR_ACTIONS),
    /**
     * The token the current error view rendered. The app window's preload also
     * runs on the loaded server page, and that page can host the same button
     * markup, so the main process trusts the token rather than the markup.
     */
    token: z.string().min(1),
  })
  .strict();
export type StartupErrorActionRequest = z.infer<
  typeof startupErrorActionRequestSchema
>;

export interface AcceptStartupErrorActionArgs {
  /** Token the visible error view rendered, or null when no view offers one. */
  currentToken: string | null;
  payload: unknown;
  /** Whether the message came from one of the app's own windows. */
  senderIsApplicationWindow: boolean;
}

/**
 * Decide whether a recovery click may act, and name the action it asks for.
 *
 * The window preload also runs on the loaded server page, and that page can host
 * the same button markup, so markup alone proves nothing. Only the current error
 * view carries the token, and every other load clears it.
 */
export function acceptStartupErrorAction(
  args: AcceptStartupErrorActionArgs,
): StartupErrorAction | null {
  if (!args.senderIsApplicationWindow || args.currentToken === null) {
    return null;
  }
  const parsed = startupErrorActionRequestSchema.safeParse(args.payload);
  if (!parsed.success || parsed.data.token !== args.currentToken) {
    return null;
  }
  return parsed.data.action;
}
