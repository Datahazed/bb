import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  auditLog,
  profile,
  schema,
  server,
  serverMember,
  user,
  type ConnectDb,
} from "@bb/connect-db";
import { parseCookie, verifySessionCookie } from "./session.js";
import type { Env } from "./tunnel-do.js";

const SESSION_COOKIE = "__Secure-better-auth.session_token";
const MEMBER_ADMISSION_AUDIT_WINDOW_MS = 15 * 60 * 1000;

interface AdmissionAuditState {
  lastWrittenAt: number;
  pending: Promise<void> | null;
}

// Per-isolate debounce. A pending write is shared too, so the burst of requests
// from one page load cannot race into a row per asset. Isolate restarts may
// duplicate the entry, which is intentionally acceptable for this audit log.
const memberAdmissionAuditState = new Map<string, AdmissionAuditState>();

export interface ServerMembersRoute {
  serverId: string;
  memberUserId: string | null;
}

export interface ServerMemberListing {
  userId: string;
  handle: string;
  name: string;
  image: string | null;
  addedByUserId: string;
  createdAt: number;
}

type AddServerMemberResult =
  | { ok: true; member: ServerMemberListing }
  | {
      ok: false;
      reason: "already-member" | "cannot-add-owner" | "unknown-handle";
    };

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique constraint/iu.test(error.message);
}

/** Affected-row count from either better-sqlite3 or D1. */
function affectedRows(result: unknown): number {
  if (typeof result === "object" && result !== null) {
    if ("changes" in result && typeof result.changes === "number") {
      return result.changes;
    }
    if (
      "meta" in result &&
      typeof result.meta === "object" &&
      result.meta !== null &&
      "changes" in result.meta &&
      typeof result.meta.changes === "number"
    ) {
      return result.meta.changes;
    }
  }
  throw new Error("server member mutation did not report affected rows");
}

async function appendAuditLog(
  db: ConnectDb,
  values: {
    userId: string;
    action: "member-added" | "member-admitted" | "member-removed";
    detail: Record<string, string>;
    createdAt: Date;
  },
): Promise<void> {
  await db
    .insert(auditLog)
    .values({
      id: crypto.randomUUID(),
      userId: values.userId,
      action: values.action,
      detail: JSON.stringify(values.detail),
      createdAt: values.createdAt,
    })
    .run();
}

/** Parse the owner member-management API path before host routing. */
export function matchServerMembersRoute(
  pathname: string,
): ServerMembersRoute | null {
  const match = pathname.match(
    /^\/api\/servers\/([^/]+)\/members(?:\/([^/]+))?$/u,
  );
  if (!match) return null;
  try {
    return {
      serverId: decodeURIComponent(match[1]),
      memberUserId: match[2] ? decodeURIComponent(match[2]) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Verify membership and durably record a debounced admission before returning
 * true. A failed audit write rejects the request instead of admitting access
 * without the system's only verified access record.
 */
export async function admitServerMember(
  db: ConnectDb,
  serverId: string,
  memberUserId: string,
  subdomain: string,
  now: number = Date.now(),
): Promise<boolean> {
  const membership = await db
    .select({ userId: serverMember.userId })
    .from(serverMember)
    .where(
      and(
        eq(serverMember.serverId, serverId),
        eq(serverMember.userId, memberUserId),
      ),
    )
    .get();
  if (!membership) return false;

  const key = `${serverId}:${memberUserId}`;
  const current = memberAdmissionAuditState.get(key);
  if (current?.pending) {
    await current.pending;
    return true;
  }
  if (
    current &&
    now - current.lastWrittenAt < MEMBER_ADMISSION_AUDIT_WINDOW_MS
  ) {
    return true;
  }

  const pending = appendAuditLog(db, {
    userId: memberUserId,
    action: "member-admitted",
    detail: { serverId, subdomain },
    createdAt: new Date(now),
  });
  memberAdmissionAuditState.set(key, {
    lastWrittenAt: current?.lastWrittenAt ?? Number.NEGATIVE_INFINITY,
    pending,
  });
  try {
    await pending;
    memberAdmissionAuditState.set(key, { lastWrittenAt: now, pending: null });
  } catch (error) {
    memberAdmissionAuditState.delete(key);
    throw error;
  }
  return true;
}

/** Owner-facing member projection, ordered by admission time then handle. */
export async function listServerMembers(
  db: ConnectDb,
  serverId: string,
): Promise<ServerMemberListing[]> {
  const rows = await db
    .select({
      userId: serverMember.userId,
      handle: profile.handle,
      name: user.name,
      image: user.image,
      addedByUserId: serverMember.addedByUserId,
      createdAt: serverMember.createdAt,
    })
    .from(serverMember)
    .innerJoin(profile, eq(profile.userId, serverMember.userId))
    .innerJoin(user, eq(user.id, serverMember.userId))
    .where(eq(serverMember.serverId, serverId))
    .orderBy(asc(serverMember.createdAt), asc(profile.handle))
    .all();
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.getTime(),
  }));
}

export async function addServerMember(
  db: ConnectDb,
  serverId: string,
  ownerUserId: string,
  rawHandle: string,
  now: Date = new Date(),
): Promise<AddServerMemberResult> {
  const handle = rawHandle.trim().toLowerCase();
  const target = await db
    .select({
      userId: profile.userId,
      handle: profile.handle,
      name: user.name,
      image: user.image,
    })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(eq(profile.handle, handle))
    .get();
  if (!target) return { ok: false, reason: "unknown-handle" };
  if (target.userId === ownerUserId) {
    return { ok: false, reason: "cannot-add-owner" };
  }

  try {
    await db
      .insert(serverMember)
      .values({
        serverId,
        userId: target.userId,
        addedByUserId: ownerUserId,
        createdAt: now,
      })
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, reason: "already-member" };
    }
    throw error;
  }

  await appendAuditLog(db, {
    userId: ownerUserId,
    action: "member-added",
    detail: { serverId, memberUserId: target.userId },
    createdAt: now,
  });
  return {
    ok: true,
    member: {
      userId: target.userId,
      handle: target.handle,
      name: target.name,
      image: target.image,
      addedByUserId: ownerUserId,
      createdAt: now.getTime(),
    },
  };
}

export async function removeServerMember(
  db: ConnectDb,
  serverId: string,
  ownerUserId: string,
  memberUserId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db
    .delete(serverMember)
    .where(
      and(
        eq(serverMember.serverId, serverId),
        eq(serverMember.userId, memberUserId),
      ),
    )
    .run();
  if (affectedRows(result) === 0) return false;

  await appendAuditLog(db, {
    userId: ownerUserId,
    action: "member-removed",
    detail: { serverId, memberUserId },
    createdAt: now,
  });
  return true;
}

async function resolveOwnerSessionUserId(
  request: Request,
  secret: string,
  db: ConnectDb,
): Promise<string | null> {
  const cookie = parseCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!cookie) return null;
  return verifySessionCookie(cookie, secret, db);
}

/** Testable owner-session member API using either D1 or in-memory SQLite. */
export async function handleServerMembersWithDb(
  request: Request,
  secret: string,
  db: ConnectDb,
  route: ServerMembersRoute,
): Promise<Response> {
  const isCollectionMethod =
    route.memberUserId === null &&
    (request.method === "GET" || request.method === "POST");
  const isItemMethod =
    route.memberUserId !== null && request.method === "DELETE";
  if (!isCollectionMethod && !isItemMethod) {
    const allow = route.memberUserId === null ? "GET, POST" : "DELETE";
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow,
      },
    });
  }

  const sessionUserId = await resolveOwnerSessionUserId(request, secret, db);
  if (!sessionUserId) return jsonError("forbidden", 403);
  const ownedServer = await db
    .select({ id: server.id })
    .from(server)
    .where(and(eq(server.id, route.serverId), eq(server.userId, sessionUserId)))
    .get();
  if (!ownedServer) return jsonError("forbidden", 403);

  if (request.method === "GET") {
    return Response.json(await listServerMembers(db, route.serverId));
  }

  if (request.method === "POST") {
    const body: unknown = await request.json().catch(() => null);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("handle" in body) ||
      typeof body.handle !== "string"
    ) {
      return jsonError("invalid_request", 400);
    }
    const result = await addServerMember(
      db,
      route.serverId,
      sessionUserId,
      body.handle,
    );
    if (!result.ok) {
      if (result.reason === "unknown-handle") {
        return jsonError("unknown_handle", 404);
      }
      if (result.reason === "already-member") {
        return jsonError("already_member", 409);
      }
      return jsonError("cannot_add_owner", 400);
    }
    return Response.json(result.member, { status: 201 });
  }

  const removed = await removeServerMember(
    db,
    route.serverId,
    sessionUserId,
    route.memberUserId!,
  );
  return removed
    ? new Response(null, { status: 204 })
    : jsonError("not_found", 404);
}

export async function handleServerMembers(
  request: Request,
  env: Env,
  route: ServerMembersRoute,
): Promise<Response> {
  const db = drizzle(env.DB, { schema });
  return handleServerMembersWithDb(request, env.BETTER_AUTH_SECRET, db, route);
}
