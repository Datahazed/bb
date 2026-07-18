import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  getCollaborator,
  migrate,
  type DbConnection,
} from "@bb/db";
import {
  CLAIMED_IDENTITY_HEADER,
  encodeClaimedIdentityHeader,
  type ClaimedIdentity,
} from "@bb/domain";
import {
  createActorService,
  resolveRequestActor,
} from "../../src/services/actors.js";

const defaultActor: ClaimedIdentity = {
  handle: "local",
  displayName: "Local Operator",
  imageUrl: null,
  clientId: "local",
};

function headerReader(value: string | undefined) {
  return {
    header(name: string): string | undefined {
      return name === CLAIMED_IDENTITY_HEADER ? value : undefined;
    },
  };
}

describe("request actors", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("resolves and normalizes a valid claimed identity header", () => {
    const encoded = encodeClaimedIdentityHeader({
      handle: " Sawyer ",
      displayName: "Sawyer",
      imageUrl: "https://example.test/avatar.png",
      clientId: "browser-1",
    });

    expect(resolveRequestActor(headerReader(encoded), defaultActor)).toEqual({
      handle: "sawyer",
      displayName: "Sawyer",
      imageUrl: "https://example.test/avatar.png",
      clientId: "browser-1",
    });
  });

  it("falls back to the local operator for a malformed header", () => {
    expect(
      resolveRequestActor(headerReader("not-valid-encoded-json"), defaultActor),
    ).toBe(defaultActor);
  });

  it("skips unchanged collaborator writes within the debounce window", () => {
    let now = 1_000;
    const actorService = createActorService({
      db,
      defaultActor,
      now: () => now,
    });
    const encoded = encodeClaimedIdentityHeader({
      handle: "Sawyer",
      displayName: "Sawyer",
      imageUrl: null,
      clientId: "browser-1",
    });

    actorService.resolveRequest(headerReader(encoded));
    now = 2_000;
    actorService.resolveRequest(headerReader(encoded));

    expect(getCollaborator(db, "sawyer")?.lastSeenAt).toBe(1_000);

    now = 61_000;
    actorService.resolveRequest(headerReader(encoded));

    expect(getCollaborator(db, "sawyer")?.lastSeenAt).toBe(61_000);
  });
});
