import type { StartupErrorAction } from "./startup-error-ipc.js";

export interface RemoteServerStartupError {
  actions: StartupErrorAction[];
  details: string;
  logs: string;
  title: string;
}

export interface LoadRemoteServerPageArgs {
  /** Shows the shared startup error screen. */
  loadStartupError(args: RemoteServerStartupError): Promise<void>;
  /** Loads a page into the application windows. */
  loadUrl(args: { url: string }): Promise<void>;
  logWarning(message: string): void;
  serverUrl: string;
}

/**
 * Load a remote bb server and keep an unreachable host recoverable.
 *
 * `BrowserWindow.loadURL` rejects with `ERR_FAILED` when the host sleeps, the
 * tunnel is down, or no bb server listens there. That rejection used to unwind
 * to the top-level startup handler, which printed the Electron stack on a
 * screen with no controls. The stack stays in the log now, and the user gets
 * the server address plus a way out.
 */
export async function loadRemoteServerPage(
  args: LoadRemoteServerPageArgs,
): Promise<boolean> {
  try {
    await args.loadUrl({ url: args.serverUrl });
    return true;
  } catch (error) {
    args.logWarning(
      `[desktop] could not load the bb server at ${args.serverUrl}: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`,
    );
    await args.loadStartupError({
      actions: ["retry", "use-this-mac"],
      details:
        `bb could not reach the server at ${args.serverUrl}. ` +
        "The host is off the network, or it does not run a bb server.",
      logs: "",
      title: "Could not reach this bb server",
    });
    return false;
  }
}
