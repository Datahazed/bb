import { describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  getErrorCode,
  isExpectedOnlineRpcFailureError,
} from "./command-dispatch-support.js";

describe("command dispatch support", () => {
  it("classifies ACP model-list authentication errors", () => {
    expect(getErrorCode(new Error("ACP agent is not authenticated."))).toBe(
      "auth_required",
    );
    expect(
      getErrorCode(
        new Error(
          "Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.",
        ),
      ),
    ).toBe("auth_required");
  });

  it("classifies oversized file reads as expected RPC failures", () => {
    expect(
      isExpectedOnlineRpcFailureError(
        new CommandDispatchError("file_too_large", "File exceeds the limit"),
      ),
    ).toBe(true);
  });
});
