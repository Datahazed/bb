import { describe, expect, it } from "vitest";
import type { ClaimedIdentity } from "@bb/domain";
import {
  getSocketActor,
  registerSocketActor,
  releaseSocketActor,
} from "../../src/ws/socket-actors.js";

const actor: ClaimedIdentity = {
  handle: "sawyer",
  displayName: "Sawyer",
  imageUrl: null,
  clientId: "browser-1",
};

describe("socket actors", () => {
  it("registers and releases a socket actor", () => {
    const socket = {};

    expect(getSocketActor(socket)).toBeNull();
    registerSocketActor(socket, actor);
    expect(getSocketActor(socket)).toBe(actor);
    releaseSocketActor(socket);
    expect(getSocketActor(socket)).toBeNull();
  });
});
