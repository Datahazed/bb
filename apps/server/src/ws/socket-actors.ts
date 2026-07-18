import type { ClaimedIdentity } from "@bb/domain";

const socketActors = new WeakMap<object, ClaimedIdentity>();

export function registerSocketActor(
  socket: object,
  actor: ClaimedIdentity,
): void {
  socketActors.set(socket, actor);
}

export function releaseSocketActor(socket: object): void {
  socketActors.delete(socket);
}

export function getSocketActor(socket: object): ClaimedIdentity | null {
  return socketActors.get(socket) ?? null;
}
