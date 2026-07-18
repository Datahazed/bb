import { describe, expect, it } from "vitest";
import { listCollaborators } from "@bb/db";
import {
  CLAIMED_IDENTITY_HEADER,
  encodeClaimedIdentityHeader,
} from "@bb/domain";
import { createLocalOperatorIdentity } from "../../src/services/actors.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public request actors", () => {
  it("records the valid claimed identity resolved for an API request", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/does-not-exist", {
        headers: {
          [CLAIMED_IDENTITY_HEADER]: encodeClaimedIdentityHeader({
            handle: "Sawyer",
            displayName: "Sawyer Hood",
            imageUrl: null,
            clientId: "browser-1",
          }),
        },
      });

      expect(response.status).toBe(404);
      expect(listCollaborators(harness.db)).toEqual([
        {
          handle: "sawyer",
          displayName: "Sawyer Hood",
          imageUrl: null,
          firstSeenAt: expect.any(Number),
          lastSeenAt: expect.any(Number),
        },
      ]);
    });
  });

  it("records the local operator when the claimed identity is malformed", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/does-not-exist", {
        headers: {
          [CLAIMED_IDENTITY_HEADER]: "malformed",
        },
      });

      expect(response.status).toBe(404);
      const localOperator = createLocalOperatorIdentity();
      expect(listCollaborators(harness.db)).toEqual([
        {
          handle: localOperator.handle,
          displayName: localOperator.displayName,
          imageUrl: null,
          firstSeenAt: expect.any(Number),
          lastSeenAt: expect.any(Number),
        },
      ]);
    });
  });

  it("collapses equivalent normalized handles into one collaborator", async () => {
    await withTestHarness(async (harness) => {
      for (const handle of ["Sawyer ", "sawyer"]) {
        await harness.app.request("/api/v1/does-not-exist", {
          headers: {
            [CLAIMED_IDENTITY_HEADER]: encodeClaimedIdentityHeader({
              handle,
              displayName: "Sawyer",
              imageUrl: null,
              clientId: "browser-1",
            }),
          },
        });
      }

      expect(listCollaborators(harness.db)).toHaveLength(1);
      expect(listCollaborators(harness.db)[0]?.handle).toBe("sawyer");
    });
  });
});
