// bb demo server — a mock bb server for App Store review.
//
// WHY THIS EXISTS
//
// A bb server's public API is unauthenticated and permits command execution
// and file reads (see the warning in apps/server/src/start-server.ts). So the
// obvious way to give an App Review reviewer something to connect to — put a
// real bb server on the internet and paste the URL into the review notes —
// publishes a shell. The connect path is authenticated, but its pairing codes
// are single-use and expire in ten minutes (CONNECT_CODE_TTL_MS), which no
// reviewer can work with.
//
// This worker answers the subset of the bb server API that the mobile app
// touches on its launch path, from fixed fixtures. It runs no commands, reads
// no files, and holds no credentials, so it is safe to expose. A reviewer adds
// it as a Direct URL server and sees a working app.
//
// WHAT IT IS NOT
//
// It is not a bb server and must never be presented as one to users. It exists
// for review and for demos. Every route that is not part of the demo path
// answers 501 with a clear message, so an unimplemented corner reads as "not
// available in the demo" rather than as a broken app.
//
// ISOLATION
//
// POST /demo mints a random Durable Object id and returns a Direct URL whose
// path carries that id. The mobile SDK preserves a Direct URL path prefix for
// both HTTP and WebSocket traffic, so one unguessable credential selects one
// world without treating a shared network address as identity. State is
// in-memory only and is dropped when the object goes idle.

import { DEMO_SERVER_URL_HEADER, DemoStateDO } from "./demo-state.js";

interface DemoStateStub {
  fetch(request: Request): Promise<Response>;
}

interface DemoStateNamespace {
  newUniqueId(): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DemoStateStub;
}

export interface Env {
  DEMO_STATE: DemoStateNamespace;
}

export { DemoStateDO };

const DEMO_PATH = "/demo";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function requestOriginIsSupported(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

function hasJsonContentType(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
}

function mintSession(request: Request, env: Env): Response {
  if (!hasJsonContentType(request)) {
    return error(
      415,
      "unsupported_media_type",
      "Demo session requests require Content-Type: application/json.",
    );
  }
  const id = env.DEMO_STATE.newUniqueId();
  const url = new URL(request.url);
  return json({ serverUrl: `${url.origin}${DEMO_PATH}/${id.toString()}` }, 201);
}

interface DemoSessionRoute {
  id: DurableObjectId;
  serverUrl: string;
  upstreamUrl: URL;
}

function demoSessionRoute(request: Request, env: Env): DemoSessionRoute | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${DEMO_PATH}/`)) return null;
  const [rawId, ...remaining] = url.pathname
    .slice(`${DEMO_PATH}/`.length)
    .split("/");
  if (!rawId) return null;

  let id: DurableObjectId;
  try {
    id = env.DEMO_STATE.idFromString(rawId);
  } catch {
    return null;
  }

  const upstreamUrl = new URL(url);
  upstreamUrl.pathname = `/${remaining.join("/")}`;
  return {
    id,
    serverUrl: `${url.origin}${DEMO_PATH}/${rawId}`,
    upstreamUrl,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!requestOriginIsSupported(request)) {
      return error(
        403,
        "unsupported_origin",
        "This browser origin cannot access the bb demo server.",
      );
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === DEMO_PATH) {
      return mintSession(request, env);
    }

    const route = demoSessionRoute(request, env);
    if (route === null) {
      return error(
        401,
        "demo_session_required",
        `Mint a private demo Direct URL with POST ${DEMO_PATH}.`,
      );
    }

    const upstreamRequest = new Request(route.upstreamUrl, request);
    upstreamRequest.headers.set(DEMO_SERVER_URL_HEADER, route.serverUrl);
    return env.DEMO_STATE.get(route.id).fetch(upstreamRequest);
  },
};
