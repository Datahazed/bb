import type { StartupErrorAction } from "./startup-error-ipc.js";

const ELECTRON_LOAD_ERROR_CODE = /\bERR_[A-Z_]+ \(-?\d+\)/u;

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

export interface DescribedServerUrl {
  /** True when the saved URL carries a credential or a query value. */
  hasSecret: boolean;
  /** How to name this server on screen and in the log. */
  label: string;
}

/**
 * Name a saved target without repeating anything secret.
 *
 * `normalizeCustomServerUrl()` keeps user information and the query string, so a
 * saved target can hold a password or a token. Neither belongs on a screen the
 * user photographs for a bug report, or in a log they attach to one. The load
 * request keeps the complete URL; only this text drops the secret parts.
 */
export function describeServerUrl(serverUrl: string): DescribedServerUrl {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    // Not parseable, so nothing about it is known to be safe to print.
    return { hasSecret: true, label: "the saved bb server" };
  }
  const hasSecret =
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0;
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return { hasSecret, label: `the server at ${parsed.toString()}` };
}

/**
 * Describe a failed load for the log.
 *
 * The Electron message repeats the URL it tried, so when that URL holds a secret
 * only the error code is safe to keep. Every other failure logs the full stack,
 * which is where an Electron internal frame belongs.
 */
function formatLoadFailure(args: {
  error: unknown;
  hasSecret: boolean;
}): string {
  if (!args.hasSecret) {
    return args.error instanceof Error
      ? (args.error.stack ?? args.error.message)
      : String(args.error);
  }
  const message =
    args.error instanceof Error ? args.error.message : String(args.error);
  return ELECTRON_LOAD_ERROR_CODE.exec(message)?.[0] ?? "the page load failed";
}

/**
 * Load a remote bb server and keep an unreachable host recoverable.
 *
 * `BrowserWindow.loadURL` rejects with `ERR_FAILED` when the host sleeps, the
 * tunnel is down, or no bb server listens there. That rejection used to unwind
 * to the top-level startup handler, which printed the Electron stack on a
 * screen with no controls. The detail stays in the log now, and the user gets
 * the server name plus a way out.
 */
export async function loadRemoteServerPage(
  args: LoadRemoteServerPageArgs,
): Promise<boolean> {
  try {
    await args.loadUrl({ url: args.serverUrl });
    return true;
  } catch (error) {
    const described = describeServerUrl(args.serverUrl);
    args.logWarning(
      `[desktop] could not load ${described.label}: ${formatLoadFailure({
        error,
        hasSecret: described.hasSecret,
      })}`,
    );
    await args.loadStartupError({
      actions: ["retry", "use-this-mac"],
      details:
        `bb could not reach ${described.label}. ` +
        "The host is off the network, or it does not run a bb server.",
      logs: "",
      title: "Could not reach this bb server",
    });
    return false;
  }
}
