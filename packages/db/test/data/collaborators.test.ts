import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  getCollaborator,
  listCollaborators,
  migrate,
  upsertCollaborator,
  type DbConnection,
} from "../../src/index.js";

describe("collaborators data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("inserts a collaborator with matching first and last seen timestamps", () => {
    const collaborator = upsertCollaborator(
      db,
      {
        handle: "sawyer",
        displayName: "Sawyer",
        imageUrl: null,
      },
      1_000,
    );

    expect(collaborator).toEqual({
      handle: "sawyer",
      displayName: "Sawyer",
      imageUrl: null,
      firstSeenAt: 1_000,
      lastSeenAt: 1_000,
    });
    expect(getCollaborator(db, "sawyer")).toEqual(collaborator);
  });

  it("updates display fields and last seen while preserving first seen", () => {
    upsertCollaborator(
      db,
      {
        handle: "sawyer",
        displayName: "Sawyer",
        imageUrl: null,
      },
      1_000,
    );

    const updated = upsertCollaborator(
      db,
      {
        handle: "sawyer",
        displayName: "Sawyer Hood",
        imageUrl: "https://example.test/sawyer.png",
      },
      2_000,
    );

    expect(updated).toEqual({
      handle: "sawyer",
      displayName: "Sawyer Hood",
      imageUrl: "https://example.test/sawyer.png",
      firstSeenAt: 1_000,
      lastSeenAt: 2_000,
    });
    expect(listCollaborators(db)).toEqual([updated]);
  });
});
