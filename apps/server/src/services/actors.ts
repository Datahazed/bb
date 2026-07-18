import { hostname, userInfo } from "node:os";
import { upsertCollaborator, type DbConnection } from "@bb/db";
import {
  CLAIMED_IDENTITY_HEADER,
  decodeClaimedIdentityHeader,
  normalizeHandle,
  type ClaimedIdentity,
} from "@bb/domain";
import type { Context } from "hono";

export const REQUEST_ACTOR_CONTEXT_KEY = "bbRequestActor";
export const COLLABORATOR_WRITE_DEBOUNCE_MS = 60_000;

interface ClaimedIdentityHeaderReader {
  header(name: string): string | undefined;
}

interface CollaboratorWrite {
  displayName: string;
  imageUrl: string | null;
  writtenAt: number;
}

export interface ActorService {
  resolveRequest(reader: ClaimedIdentityHeaderReader): ClaimedIdentity;
}

interface CreateActorServiceArgs {
  db: DbConnection;
  defaultActor: ClaimedIdentity;
  now(): number;
}

declare module "hono" {
  interface ContextVariableMap {
    [REQUEST_ACTOR_CONTEXT_KEY]: ClaimedIdentity | undefined;
  }
}

export function createLocalOperatorIdentity(): ClaimedIdentity {
  let username = "";
  try {
    username = userInfo().username.trim();
  } catch {
    // Some restricted runtimes cannot resolve the current OS user.
  }
  const normalizedUsername = normalizeHandle(username);
  const localHostname = hostname().trim();

  return {
    handle: normalizedUsername || "local",
    displayName: username || localHostname || "local",
    imageUrl: null,
    clientId: "local",
  };
}

export function resolveRequestActor(
  reader: ClaimedIdentityHeaderReader,
  defaultActor: ClaimedIdentity,
): ClaimedIdentity {
  return (
    decodeClaimedIdentityHeader(reader.header(CLAIMED_IDENTITY_HEADER)) ??
    defaultActor
  );
}

export function createActorService(args: CreateActorServiceArgs): ActorService {
  const recentWrites = new Map<string, CollaboratorWrite>();

  return {
    resolveRequest(reader): ClaimedIdentity {
      const actor = resolveRequestActor(reader, args.defaultActor);
      const now = args.now();
      const previousWrite = recentWrites.get(actor.handle);
      if (
        previousWrite !== undefined &&
        previousWrite.displayName === actor.displayName &&
        previousWrite.imageUrl === actor.imageUrl &&
        now - previousWrite.writtenAt < COLLABORATOR_WRITE_DEBOUNCE_MS
      ) {
        return actor;
      }

      upsertCollaborator(
        args.db,
        {
          handle: actor.handle,
          displayName: actor.displayName,
          imageUrl: actor.imageUrl,
        },
        now,
      );
      recentWrites.set(actor.handle, {
        displayName: actor.displayName,
        imageUrl: actor.imageUrl,
        writtenAt: now,
      });

      return actor;
    },
  };
}

export function setRequestActor(
  context: Context,
  actor: ClaimedIdentity,
): void {
  context.set(REQUEST_ACTOR_CONTEXT_KEY, actor);
}

export function getRequestActor(context: Context): ClaimedIdentity {
  const actor = context.get(REQUEST_ACTOR_CONTEXT_KEY);
  if (actor === undefined) {
    throw new Error("Request actor has not been resolved");
  }
  return actor;
}
