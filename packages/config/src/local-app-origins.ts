/**
 * Builds the CORS allowlist of origins the BB app frontend may be served
 * from, enforced by the server's app-wide CORS middleware (which also covers
 * the local-API routes the frontend reaches at root paths) so that
 * cross-origin webpages can't drive the API from the user's browser.
 *
 * Both `127.0.0.1` and `localhost` variants are emitted because browsers
 * treat them as distinct origins for CORS purposes.
 */
export interface BuildLocalAppOriginsArgs {
  /** Port the BB server binds on (also the prod-style frontend origin when the
   * server serves the bundle directly). */
  serverPort: number;
  /** Vite dev-server port for `apps/app`. Omitted in production launchers. */
  devAppPort?: number;
  /** Public app URL when the frontend is served from a non-localhost origin
   * (e.g. a cloud-hosted deployment). Optional; an empty/invalid string is
   * silently skipped. */
  appUrl?: string;
}

const LOCAL_HOSTS = ["127.0.0.1", "localhost"] as const;

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

export function buildLocalAppOrigins(
  args: BuildLocalAppOriginsArgs,
): string[] {
  const origins: string[] = [];
  const ports = [args.serverPort];
  if (args.devAppPort !== undefined && isValidPort(args.devAppPort)) {
    ports.push(args.devAppPort);
  }
  for (const host of LOCAL_HOSTS) {
    for (const port of ports) {
      origins.push(`http://${host}:${port}`);
    }
  }
  if (args.appUrl) {
    try {
      origins.push(new URL(args.appUrl).origin);
    } catch {
      // Caller's config may pass an empty / invalid value; skip silently
      // rather than refuse to start.
    }
  }
  return origins;
}
