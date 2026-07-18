import { getPluginKvValue } from "@bb/db";
import { normalizeHandle } from "@bb/domain";
import {
  memberListResponseSchema,
  memberSchema,
  publicApiRoutes,
  typedRoutes,
  type Member,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";

const CONNECT_PLUGIN_ID = "connect";
const CONNECT_CREDENTIAL_KEY = "credential";
const TUNNEL_ORIGIN_HEADER = "x-bb-via-tunnel";

const connectCredentialSchema = z
  .object({
    serverUrl: z.string().url(),
    handle: z.string().min(1),
    credential: z.string().min(1),
  })
  .strict();

const accountServersResponseSchema = z
  .object({
    servers: z.array(
      z.object({
        id: z.string().min(1),
        handle: z.string().min(1),
      }),
    ),
  })
  .strict();

const workerMemberSchema = z
  .object({
    userId: z.string().min(1),
    handle: z.string().min(1),
    name: z.string().min(1),
    image: z.string().nullable(),
    addedByUserId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

interface MemberProxyTarget {
  credential: string;
  memberApiUrl: string;
}

function assertOwnerConsoleRequest(request: Request): void {
  if (request.headers.has(TUNNEL_ORIGIN_HEADER)) {
    throw new ApiError(
      403,
      "member_management_tunnel_forbidden",
      "Member management is available only from the owner's local console",
    );
  }
}

function readConnectCredential(deps: AppDeps) {
  const stored = getPluginKvValue(
    deps.db,
    CONNECT_PLUGIN_ID,
    CONNECT_CREDENTIAL_KEY,
  );
  if (stored === undefined) {
    throw new ApiError(
      404,
      "connect_not_enrolled",
      "This bb is not enrolled in Connect; pair it before managing members",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    throw new ApiError(
      404,
      "connect_not_enrolled",
      "This bb has no valid Connect enrollment",
    );
  }
  const parsed = connectCredentialSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      404,
      "connect_not_enrolled",
      "This bb has no valid Connect enrollment",
    );
  }
  return parsed.data;
}

async function jsonFromWorker(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      502,
      "connect_invalid_response",
      "Connect returned an invalid response",
    );
  }
}

function workerErrorCode(raw: unknown): string | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "error" in raw &&
    typeof raw.error === "string"
  ) {
    return raw.error;
  }
  return null;
}

async function throwWorkerError(
  response: Response,
  handle?: string,
): Promise<never> {
  const raw = await jsonFromWorker(response);
  const code = workerErrorCode(raw);
  if (response.status === 403) {
    throw new ApiError(
      403,
      "member_management_forbidden",
      "Connect rejected member management for this server",
    );
  }
  if (response.status === 404 && code === "unknown_handle") {
    throw new ApiError(
      404,
      "unknown_handle",
      `No Connect account has the handle '${handle ?? ""}'`,
    );
  }
  if (response.status === 404) {
    throw new ApiError(404, "member_not_found", "Member not found");
  }
  if (response.status === 409 && code === "already_member") {
    throw new ApiError(
      409,
      "already_member",
      `The handle '${handle ?? ""}' is already a member`,
    );
  }
  throw new ApiError(
    response.status === 400
      ? 400
      : response.status === 401
        ? 401
        : response.status === 405
          ? 405
          : 502,
    code ?? "connect_request_failed",
    `Connect member request failed (${response.status})`,
  );
}

async function fetchWorker(
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new ApiError(
      502,
      "connect_unreachable",
      `Connect is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function resolveMemberProxyTarget(
  deps: AppDeps,
): Promise<MemberProxyTarget> {
  const enrollment = readConnectCredential(deps);
  const serverUrl = enrollment.serverUrl.replace(/\/+$/u, "");
  const response = await fetchWorker(`${serverUrl}/api/connect/servers`, {
    headers: { "x-bb-connect-machine": enrollment.credential },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        403,
        "connect_enrollment_rejected",
        "Connect rejected this bb's enrollment credential",
      );
    }
    await throwWorkerError(response);
  }
  const parsed = accountServersResponseSchema.safeParse(
    await jsonFromWorker(response),
  );
  if (!parsed.success) {
    throw new ApiError(
      502,
      "connect_invalid_response",
      "Connect returned an invalid server identity response",
    );
  }
  const ownServer = parsed.data.servers.find(
    (server) => server.handle === enrollment.handle,
  );
  if (!ownServer) {
    throw new ApiError(
      404,
      "connect_not_enrolled",
      "This bb's Connect enrollment no longer identifies a server",
    );
  }
  return {
    credential: enrollment.credential,
    memberApiUrl: `${serverUrl}/api/servers/${encodeURIComponent(ownServer.id)}/members`,
  };
}

function memberFromWorker(raw: unknown): Member {
  const member = workerMemberSchema.safeParse(raw);
  if (!member.success) {
    throw new ApiError(
      502,
      "connect_invalid_response",
      "Connect returned an invalid member",
    );
  }
  return memberSchema.parse({
    userId: member.data.userId,
    handle: member.data.handle,
    displayName: member.data.name,
    imageUrl: member.data.image,
    addedByUserId: member.data.addedByUserId,
    createdAt: member.data.createdAt,
  });
}

async function listMembers(target: MemberProxyTarget): Promise<Member[]> {
  const response = await fetchWorker(target.memberApiUrl, {
    headers: { authorization: `Bearer ${target.credential}` },
  });
  if (!response.ok) await throwWorkerError(response);
  const raw = await jsonFromWorker(response);
  if (!Array.isArray(raw)) {
    throw new ApiError(
      502,
      "connect_invalid_response",
      "Connect returned an invalid member list",
    );
  }
  return raw.map(memberFromWorker);
}

export function registerMemberRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get(publicApiRoutes.members.list, async (context) => {
    assertOwnerConsoleRequest(context.req.raw);
    const members = await listMembers(await resolveMemberProxyTarget(deps));
    return context.json(memberListResponseSchema.parse({ members }));
  });

  post(publicApiRoutes.members.add, async (context, input) => {
    assertOwnerConsoleRequest(context.req.raw);
    const target = await resolveMemberProxyTarget(deps);
    const response = await fetchWorker(target.memberApiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ handle: normalizeHandle(input.handle) }),
    });
    if (!response.ok) await throwWorkerError(response, input.handle);
    return context.json(memberFromWorker(await jsonFromWorker(response)), 201);
  });

  del(publicApiRoutes.members.remove, async (context, input) => {
    assertOwnerConsoleRequest(context.req.raw);
    const target = await resolveMemberProxyTarget(deps);
    const normalizedHandle = normalizeHandle(input.handle);
    const member = (await listMembers(target)).find(
      (candidate) => normalizeHandle(candidate.handle) === normalizedHandle,
    );
    if (!member) {
      throw new ApiError(
        404,
        "unknown_handle",
        `The handle '${input.handle}' is not a member`,
      );
    }
    const response = await fetchWorker(
      `${target.memberApiUrl}/${encodeURIComponent(member.userId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${target.credential}` },
      },
    );
    if (!response.ok) await throwWorkerError(response, input.handle);
    return context.json({ ok: true });
  });
}
