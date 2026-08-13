import { describe, expect, it } from "vitest";
import { acceptStartupErrorAction } from "../src/startup-error-ipc.js";

const VIEW_TOKEN = "e0f1c2d3-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

// The window preload runs on the loaded server page too, so a hostile or
// compromised bb server can host the same buttons and click them itself. Only
// the token separates a real recovery click from that forgery.
describe("accepting a startup error recovery click", () => {
  it("accepts the action the visible error view offered", () => {
    expect(
      acceptStartupErrorAction({
        currentToken: VIEW_TOKEN,
        payload: { action: "use-this-mac", token: VIEW_TOKEN },
        senderIsApplicationWindow: true,
      }),
    ).toBe("use-this-mac");
  });

  it("rejects a token the error view never rendered", () => {
    expect(
      acceptStartupErrorAction({
        currentToken: VIEW_TOKEN,
        payload: { action: "use-this-mac", token: "guessed" },
        senderIsApplicationWindow: true,
      }),
    ).toBeNull();
  });

  it("rejects every click while no error view offers recovery", () => {
    expect(
      acceptStartupErrorAction({
        currentToken: null,
        payload: { action: "retry", token: VIEW_TOKEN },
        senderIsApplicationWindow: true,
      }),
    ).toBeNull();
  });

  it("rejects a sender that is not an application window", () => {
    expect(
      acceptStartupErrorAction({
        currentToken: VIEW_TOKEN,
        payload: { action: "retry", token: VIEW_TOKEN },
        senderIsApplicationWindow: false,
      }),
    ).toBeNull();
  });

  it.each([
    {
      label: "an unknown action",
      payload: { action: "quit", token: VIEW_TOKEN },
    },
    { label: "no token", payload: { action: "retry" } },
    { label: "an empty token", payload: { action: "retry", token: "" } },
    {
      label: "an extra field",
      payload: { action: "retry", token: VIEW_TOKEN, url: "http://evil" },
    },
    { label: "no object", payload: "retry" },
  ])("rejects a payload with $label", (testCase) => {
    expect(
      acceptStartupErrorAction({
        currentToken: VIEW_TOKEN,
        payload: testCase.payload,
        senderIsApplicationWindow: true,
      }),
    ).toBeNull();
  });
});
