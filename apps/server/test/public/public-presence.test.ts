import { presenceSnapshotResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { registerSocketActor } from "../../src/ws/socket-actors.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /api/v1/presence", () => {
  it("returns the current hub-derived viewer snapshot", async () => {
    await withTestHarness(async (harness) => {
      const socket = createMockHubSocket();
      registerSocketActor(socket, {
        handle: "sawyer",
        displayName: "Sawyer",
        imageUrl: null,
        clientId: "browser-1",
      });
      harness.hub.subscribe(socket, {
        kind: "thread-detail",
        threadId: "thread-1",
      });

      const response = await harness.app.request("/api/v1/presence");
      expect(response.status).toBe(200);
      expect(
        presenceSnapshotResponseSchema.parse(await readJson(response)),
      ).toEqual({
        threads: {
          "thread-1": [
            {
              handle: "sawyer",
              displayName: "Sawyer",
              imageUrl: null,
              typing: false,
            },
          ],
        },
      });
    });
  });
});
