import { describe, expect, it } from "vitest";
import {
  headersForLoopbackRequest,
  TUNNEL_ORIGIN_HEADER,
} from "../src/headers.js";

describe("headersForLoopbackRequest", () => {
  it("strips a client-supplied tunnel marker and stamps the trusted marker", () => {
    const headers = headersForLoopbackRequest(
      [
        ["X-BB-Via-Tunnel", "client-controlled"],
        ["x-bb-via-tunnel", "0"],
        ["content-type", "application/json"],
      ],
      {
        publicOrigin: "https://owner.getbb.app",
        loopbackOrigin: "http://127.0.0.1:38886",
        markTunnelOrigin: true,
      },
    );

    expect(headers).toEqual({
      "content-type": "application/json",
      [TUNNEL_ORIGIN_HEADER]: "1",
    });
  });

  it("stamps both ordinary HTTP requests and websocket upgrade headers", () => {
    expect(
      headersForLoopbackRequest([], {
        publicOrigin: "https://owner.getbb.app",
        loopbackOrigin: "http://127.0.0.1:38886",
        markTunnelOrigin: true,
      }),
    ).toEqual({ [TUNNEL_ORIGIN_HEADER]: "1" });
  });
});
