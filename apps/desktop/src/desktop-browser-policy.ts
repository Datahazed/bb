// Pure navigation/popup policy for the in-app browser view. Kept free of any
// `electron` import so it can be unit tested under vitest's node environment.

import { BB_PROD_HOST_DAEMON_PORT } from "@bb/config/runtime";

/**
 * Only `http`/`https` top-level navigations are allowed in the browser view.
 * Everything else (`file:`, `javascript:`, custom schemes, `about:` beyond
 * blank) is treated as hostile and blocked.
 */
export function isAllowedBrowserUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export interface WindowOpenDecision {
  /** The URL to open as a new in-panel tab, or null to deny entirely. */
  openTabUrl: string | null;
}

/**
 * Decide what to do with a `window.open`/`target=_blank` request. The native OS
 * popup is always denied by the caller; an allowed http(s) URL is surfaced so
 * the renderer can open it as a new in-panel browser tab.
 */
export function resolveWindowOpenAction(url: string): WindowOpenDecision {
  return { openTabUrl: isAllowedPublicBrowserPopupUrl(url) ? url : null };
}

// --- Loopback / LAN request firewall ---
//
// Untrusted browsed pages must never be able to reach bb's own loopback
// services (server `/ws`, host-daemon local API) or other hosts on the user's
// LAN. CORS only filters responses; it does not stop the request from being
// sent and acted on. So we block at the network layer (see the
// `session.webRequest` wiring in desktop-browser-view) using these predicates,
// which classify the request's URL host as loopback / link-local / private.
//
// A loopback page may still reach other loopback ports, because that is how
// ordinary local development works (a dev server on one port, its API or
// WebSocket backend on another) and every real browser allows it. The ports bb
// itself serves are the ones held back, named by `reservedLoopbackPorts`.
//
// Residual: this classifies the URL host, not the DNS-resolved address, so a
// public name that resolves to a private IP (DNS rebinding) is not caught here.
// That is a deeper, separate mitigation and out of scope for v1.

/**
 * The loopback ports bb serves, or `pending` while a local runtime is up whose
 * host-daemon port bb has not read yet. Cross-port loopback stays closed until
 * bb can name every port of its own, so a slow — or permanently failing —
 * system-config fetch never opens a window onto the daemon.
 */
export type ReservedLoopbackPorts =
  | { kind: "known"; ports: readonly number[] }
  | { kind: "pending" };

export interface ShouldBlockBrowserRequestArgs {
  url: string;
  method: string;
  resourceType: string;
  isMainFrame: boolean;
  targetWebContentsId: number | null;
  entryWebContentsId: number | null;
  currentMainFrameLocalOriginKey: string | null;
  requestingFrameOriginKey: string | null;
  /**
   * Loopback ports bb's own services occupy, or `pending` while bb cannot yet
   * name them all.
   */
  reservedLoopbackPorts: ReservedLoopbackPorts;
}

interface ParsedBrowserRequestUrl {
  protocol: string;
  host: string;
  originHost: string;
  port: string;
}

function parseIpv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) {
    return null;
  }
  const octets = [match[1], match[2], match[3], match[4]].map((part) =>
    Number(part),
  );
  return octets.some((octet) => octet > 255) ? null : octets;
}

function isLoopbackIpv4(octets: readonly number[]): boolean {
  return octets[0] === 127; // 127.0.0.0/8 loopback
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 198 && b === 18) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 19) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

function expandIpv6(host: string): number[] | null {
  let work = host;
  // Fold a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  const dotIndex = work.indexOf(".");
  if (dotIndex !== -1) {
    const lastColon = work.lastIndexOf(":", dotIndex);
    if (lastColon === -1) {
      return null;
    }
    const v4 = parseIpv4Octets(work.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    work = `${work.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const sides = work.split("::");
  if (sides.length > 2) {
    return null;
  }
  const toGroups = (part: string): string[] =>
    part.length === 0 ? [] : part.split(":");
  const head = toGroups(sides[0]);
  let groups: string[];
  if (sides.length === 2) {
    const tail = toGroups(sides[1]);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) {
      return null;
    }
    groups = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) {
    return null;
  }
  const hextets: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    hextets.push(parseInt(group, 16));
  }
  return hextets;
}

function isLoopbackIpv6Literal(host: string): boolean {
  const hextets = expandIpv6(host);
  if (hextets === null) {
    return false;
  }
  const leadingZeros = hextets.slice(0, 7).every((value) => value === 0);
  return leadingZeros && hextets[7] === 1; // ::1 loopback
}

function isPrivateIpv6Literal(host: string): boolean {
  const hextets = expandIpv6(host);
  if (hextets === null) {
    return true; // unparseable IPv6 literal -> block to be safe
  }
  if (hextets.every((value) => value === 0)) return true; // :: unspecified
  if (isLoopbackIpv6Literal(host)) return false; // ::1 is handled as loopback
  if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((hextets[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (hextets[0] === 0x2001 && hextets[1] === 0x0db8) return true; // docs
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
  const firstFiveZero = hextets.slice(0, 5).every((value) => value === 0);
  if (firstFiveZero && (hextets[5] === 0xffff || hextets[5] === 0)) {
    const mappedOctets = [
      hextets[6] >> 8,
      hextets[6] & 0xff,
      hextets[7] >> 8,
      hextets[7] & 0xff,
    ];
    return isLoopbackIpv4(mappedOctets) || isPrivateIpv4(mappedOctets);
  }
  return false;
}

function normalizeBrowserRequestHost(rawHost: string): string | null {
  let host = rawHost.trim().toLowerCase();
  if (host.length === 0) {
    return null;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const zoneIndex = host.indexOf("%");
  if (zoneIndex !== -1) {
    host = host.slice(0, zoneIndex);
  }
  while (host.endsWith(".") && host.length > 1) {
    host = host.slice(0, -1);
  }
  return host.length === 0 ? null : host;
}

function normalizeBrowserOriginHost(rawHost: string): string | null {
  let host = rawHost.trim().toLowerCase();
  if (host.length === 0) {
    return null;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const zoneIndex = host.indexOf("%");
  if (zoneIndex !== -1) {
    host = host.slice(0, zoneIndex);
  }
  return host.length === 0 ? null : host;
}

function isLocalhostName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

function isMdnsName(host: string): boolean {
  return host === "local" || host.endsWith(".local");
}

function parseBrowserRequestUrl(url: string): ParsedBrowserRequestUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = normalizeBrowserRequestHost(parsed.hostname);
  const originHost = normalizeBrowserOriginHost(parsed.hostname);
  if (host === null || originHost === null) {
    return null;
  }
  return { protocol: parsed.protocol, host, originHost, port: parsed.port };
}

function isGuardedRequestProtocol(protocol: string): boolean {
  return (
    protocol === "http:" ||
    protocol === "https:" ||
    protocol === "ws:" ||
    protocol === "wss:"
  );
}

function requestUrlTargetsLoopbackOrPrivate(url: string): boolean {
  const parsed = parseBrowserRequestUrl(url);
  if (parsed === null || !isGuardedRequestProtocol(parsed.protocol)) {
    return false;
  }
  return (
    isLoopbackBrowserRequestHost(parsed.host) ||
    isPrivateBrowserRequestHost(parsed.host)
  );
}

function browserRequestHasEntryAttribution(
  args: ShouldBlockBrowserRequestArgs,
): boolean {
  return (
    args.targetWebContentsId !== null &&
    args.entryWebContentsId !== null &&
    args.targetWebContentsId === args.entryWebContentsId
  );
}

function isReadOnlyMainFrameRequestMethod(method: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  return normalizedMethod === "GET" || normalizedMethod === "HEAD";
}

/**
 * The port a guarded request actually reaches. `URL` leaves `port` empty for a
 * scheme's default port, so a bare `http://127.0.0.1/` must still compare as
 * port 80. Every caller has already narrowed the protocol to `http(s)`/`ws(s)`.
 */
function effectiveRequestPort(parsed: ParsedBrowserRequestUrl): number {
  if (parsed.port.length > 0) {
    return Number(parsed.port);
  }
  return parsed.protocol === "https:" || parsed.protocol === "wss:" ? 443 : 80;
}

function localRequestProtocolClass(protocol: string): string | null {
  if (protocol === "http:" || protocol === "ws:") {
    return "local";
  }
  if (protocol === "https:" || protocol === "wss:") {
    return "secure-local";
  }
  return null;
}

function isAllowedPublicBrowserPopupUrl(url: string): boolean {
  const parsed = parseBrowserRequestUrl(url);
  return (
    parsed !== null &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    !isLoopbackBrowserRequestHost(parsed.host) &&
    !isPrivateBrowserRequestHost(parsed.host)
  );
}

/**
 * Whether a request host (URL hostname, no port) is a loopback host. Loopback
 * top-level navigation is allowed, but non-main-frame requests are guarded so
 * browsed pages cannot invisibly reach local services.
 */
export function isLoopbackBrowserRequestHost(rawHost: string): boolean {
  const host = normalizeBrowserRequestHost(rawHost);
  if (host === null) {
    return false;
  }
  if (isLocalhostName(host)) {
    return true;
  }
  const ipv4 = parseIpv4Octets(host);
  if (ipv4 !== null) {
    return isLoopbackIpv4(ipv4);
  }
  return host.includes(":") && isLoopbackIpv6Literal(host);
}

/**
 * Whether a request host targets private/LAN, link-local, mDNS, CGNAT,
 * multicast/reserved, unspecified, or otherwise ambiguous local address space.
 * Loopback hosts are intentionally classified separately.
 */
export function isPrivateBrowserRequestHost(rawHost: string): boolean {
  const host = normalizeBrowserRequestHost(rawHost);
  if (host === null) {
    return true;
  }
  if (isLocalhostName(host)) {
    return false;
  }
  if (isMdnsName(host)) {
    return true;
  }
  const ipv4 = parseIpv4Octets(host);
  if (ipv4 !== null) {
    return !isLoopbackIpv4(ipv4) && isPrivateIpv4(ipv4);
  }
  if (host.includes(":")) {
    return isPrivateIpv6Literal(host);
  }
  return false;
}

/**
 * Whether a request host (URL hostname, no port) must be blocked by the legacy
 * coarse firewall because it targets loopback, private/LAN, or related local
 * address space. Public names and addresses return false.
 */
export function isBlockedBrowserRequestHost(rawHost: string): boolean {
  return (
    isLoopbackBrowserRequestHost(rawHost) ||
    isPrivateBrowserRequestHost(rawHost)
  );
}

/**
 * Returns the comparable local origin key for loopback `http(s)`/`ws(s)` URLs.
 * `http` and `ws` share one transport class; `https` and `wss` share another.
 */
export function localRequestOriginKey(url: string): string | null {
  const parsed = parseBrowserRequestUrl(url);
  if (parsed === null || !isLoopbackBrowserRequestHost(parsed.host)) {
    return null;
  }
  const protocolClass = localRequestProtocolClass(parsed.protocol);
  if (protocolClass === null) {
    return null;
  }
  return `${protocolClass}|${parsed.originHost}|${parsed.port}`;
}

/**
 * The loopback port a bb service URL occupies, or null when the URL is not a
 * loopback `http(s)` URL. The caller collects these into the reserved-port list
 * the request firewall keeps unreachable from browsed pages.
 */
export function loopbackServicePort(url: string): number | null {
  const parsed = parseBrowserRequestUrl(url);
  if (
    parsed === null ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !isLoopbackBrowserRequestHost(parsed.host)
  ) {
    return null;
  }
  return effectiveRequestPort(parsed);
}

export interface ResolveReservedLoopbackPortsArgs {
  /** The loopback bb server URL this app starts or attaches to. */
  builtinServerUrl: string;
  /** The attached runtime's server URL, or null when none is attached. */
  localServerUrl: string | null;
  /**
   * URL the bb app window itself loads, or null before the first load. In dev
   * that is a loopback Vite server bb owns, which is otherwise unnamed here.
   */
  appWindowUrl: string | null;
  /**
   * Host-daemon port an attached loopback server reports, or null before the
   * first system-config fetch lands and after the config sync stops.
   */
  localHostDaemonPort: number | null;
  /**
   * Raw `BB_HOST_DAEMON_PORT`. It is set for every dev instance and for a
   * configured production deployment, so reading it names the daemon port
   * before any fetch and keeps the pending window shut.
   */
  configuredHostDaemonPort: string | undefined;
  /** Whether a local bb runtime is attached or spawned right now. */
  hasLocalRuntime: boolean;
}

function parsePortValue(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const port = Number(value.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

/**
 * The loopback ports bb itself serves, which browsed pages must never reach:
 * the bb server, the host daemon, and in dev the Vite server that hosts the bb
 * app window.
 *
 * The packaged host-daemon port is always reserved, because
 * `localHostDaemonPort` only arrives with the first system-config fetch and a
 * browsed page must not reach the daemon during that window. The cost is that
 * a user's own service on a reserved port is unreachable from the in-app
 * browser; that is the right trade, because a browsed page reaching bb is far
 * worse than a browsed page missing one port.
 */
export function resolveReservedLoopbackPorts(
  args: ResolveReservedLoopbackPortsArgs,
): ReservedLoopbackPorts {
  const configuredHostDaemonPort = parsePortValue(
    args.configuredHostDaemonPort,
  );
  // A local runtime whose daemon port is neither configured nor fetched yet
  // sits on a port bb cannot name. Stay closed rather than guess.
  if (
    args.hasLocalRuntime &&
    args.localHostDaemonPort === null &&
    configuredHostDaemonPort === null
  ) {
    return { kind: "pending" };
  }
  const ports = new Set<number>([BB_PROD_HOST_DAEMON_PORT]);
  for (const url of [
    args.builtinServerUrl,
    args.localServerUrl,
    args.appWindowUrl,
  ]) {
    const port = url === null ? null : loopbackServicePort(url);
    if (port !== null) {
      ports.add(port);
    }
  }
  for (const port of [configuredHostDaemonPort, args.localHostDaemonPort]) {
    if (port !== null) {
      ports.add(port);
    }
  }
  return { kind: "known", ports: [...ports] };
}

export interface ResolveRequestingFrameLocalOriginKeyArgs {
  /** The requesting frame's reported origin (`details.frame?.origin`). */
  origin: string | undefined;
  /** The requesting frame's committed URL (`details.frame?.url`). */
  url: string | undefined;
  /** Whether the requesting frame is the top frame (`frame.parent === null`). */
  isTopFrame: boolean;
}

/**
 * Resolves the comparable local-origin key for the frame that initiated a
 * request. Prefers the frame's reported `origin`; for a **top** frame whose
 * origin is not yet populated — Electron reports an empty origin for a
 * document's initial subresource requests, before it has run script and
 * committed its origin (which blanks SPA dev servers like Vite) — it falls
 * back to the frame's committed `url`. The URL fallback is restricted to the
 * top frame so a sub-iframe presenting an empty origin can never be mistaken
 * for the trusted main frame.
 */
export function resolveRequestingFrameLocalOriginKey(
  args: ResolveRequestingFrameLocalOriginKeyArgs,
): string | null {
  const fromOrigin =
    args.origin === undefined ? null : localRequestOriginKey(args.origin);
  if (fromOrigin !== null) {
    return fromOrigin;
  }
  if (args.isTopFrame && args.url !== undefined) {
    return localRequestOriginKey(args.url);
  }
  return null;
}

/**
 * Whether a network request URL must be blocked by the current coarse
 * loopback/LAN firewall. Only `http(s)`/`ws(s)` carry a remote host worth
 * guarding; `data:`/`blob:`/`about:` have none and are allowed (`webSecurity`
 * guards `file:`). Exported for unit testing and current native wiring.
 */
export function isBlockedBrowserRequestUrl(url: string): boolean {
  return requestUrlTargetsLoopbackOrPrivate(url);
}

/**
 * Pure same-origin loopback/private request decision. The caller is responsible
 * for resolving Electron's `webContentsId` to exactly one live browser entry
 * before passing the entry id and local-origin state here.
 */
export function shouldBlockBrowserRequest(
  args: ShouldBlockBrowserRequestArgs,
): boolean {
  const isMainFrameRequest =
    args.isMainFrame || args.resourceType === "mainFrame";
  if (isMainFrameRequest) {
    if (!isAllowedBrowserUrl(args.url)) {
      return true;
    }
    const parsed = parseBrowserRequestUrl(args.url);
    if (parsed !== null && isPrivateBrowserRequestHost(parsed.host)) {
      return true;
    }
    if (
      !isReadOnlyMainFrameRequestMethod(args.method) &&
      parsed !== null &&
      isLoopbackBrowserRequestHost(parsed.host)
    ) {
      return true;
    }
    return false;
  }
  const parsed = parseBrowserRequestUrl(args.url);
  if (parsed === null || !isGuardedRequestProtocol(parsed.protocol)) {
    return false;
  }
  if (isPrivateBrowserRequestHost(parsed.host)) {
    return true;
  }
  if (!isLoopbackBrowserRequestHost(parsed.host)) {
    return false;
  }
  if (!browserRequestHasEntryAttribution(args)) {
    return true;
  }
  const targetOriginKey = localRequestOriginKey(args.url);
  if (targetOriginKey === null) {
    return true;
  }
  if (
    args.currentMainFrameLocalOriginKey === null ||
    args.requestingFrameOriginKey === null ||
    args.requestingFrameOriginKey !== args.currentMainFrameLocalOriginKey
  ) {
    return true;
  }
  if (targetOriginKey === args.currentMainFrameLocalOriginKey) {
    return false;
  }
  // A committed loopback page reaching a second loopback port is ordinary local
  // development, so it is allowed here as it is in Chrome and Safari. bb's own
  // loopback services stay unreachable, which is what this firewall protects.
  if (args.reservedLoopbackPorts.kind === "pending") {
    return true;
  }
  return args.reservedLoopbackPorts.ports.includes(
    effectiveRequestPort(parsed),
  );
}

// --- Popup-tab rate limiting ---

export interface PopupRateDecision {
  allowed: boolean;
  timestamps: number[];
}

export interface EvaluatePopupRateArgs {
  timestamps: readonly number[];
  now: number;
  windowMs: number;
  maxInWindow: number;
}

/**
 * Sliding-window rate gate for popup → in-panel-tab creation, so a hostile page
 * cannot spam tabs. Returns the (pruned) timestamp list the caller should
 * persist, plus whether this popup is allowed. Pure; exported for unit testing.
 */
export function evaluatePopupRate({
  timestamps,
  now,
  windowMs,
  maxInWindow,
}: EvaluatePopupRateArgs): PopupRateDecision {
  const recent = timestamps.filter((stamp) => now - stamp < windowMs);
  if (recent.length >= maxInWindow) {
    return { allowed: false, timestamps: recent };
  }
  return { allowed: true, timestamps: [...recent, now] };
}
