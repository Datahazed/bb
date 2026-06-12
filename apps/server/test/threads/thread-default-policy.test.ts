import { type ProjectExecutionDefaults, type Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  resolveCreateThreadExecutionDefaults,
  resolveThreadDefaultPermissionMode,
  resolveThreadExecutionPermissionMode,
  resolveWorkflowsEnabledPolicy,
} from "../../src/services/threads/thread-default-policy.js";

type PolicyTestThread = Pick<Thread, "providerId">;

function makeThread(
  overrides: Partial<PolicyTestThread> = {},
): PolicyTestThread {
  return {
    providerId: "codex",
    ...overrides,
  };
}

function makeDefaults(
  overrides: Partial<ProjectExecutionDefaults> = {},
): ProjectExecutionDefaults {
  return {
    model: "gpt-5",
    permissionMode: "full",
    providerId: "codex",
    reasoningLevel: "medium",
    serviceTier: "default",
    ...overrides,
  };
}

describe("resolveWorkflowsEnabledPolicy", () => {
  it("enables workflows for claude-code sessions only", () => {
    expect(resolveWorkflowsEnabledPolicy("claude-code")).toBe(true);
    expect(resolveWorkflowsEnabledPolicy("codex")).toBe(false);
    expect(resolveWorkflowsEnabledPolicy("pi")).toBe(false);
  });
});

describe("resolveCreateThreadExecutionDefaults", () => {
  it("uses the server-owned Codex defaults when provider and stored defaults are omitted", () => {
    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults: null,
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: {
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      },
    });
  });

  it("discards stored defaults when the resolved provider changes", () => {
    expect(
      resolveCreateThreadExecutionDefaults({
        requestedProviderId: "pi",
        storedDefaults: makeDefaults({
          providerId: "codex",
          model: "gpt-5.5",
        }),
      }),
    ).toEqual({
      providerId: "pi",
      executionDefaults: null,
    });
  });

  it("reuses matching stored defaults", () => {
    const storedDefaults = makeDefaults({
      model: "gpt-5.1",
      permissionMode: "readonly",
    });

    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults,
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: storedDefaults,
    });
  });
});

describe("resolveThreadDefaultPermissionMode", () => {
  it("uses the full permission default for non-agent providers", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          providerId: "custom-provider",
        }),
      }),
    ).toBe("full");
  });

  it("uses full for Pi threads", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          providerId: "pi",
        }),
      }),
    ).toBe("full");
  });

  it("uses full for Codex threads", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          providerId: "codex",
        }),
      }),
    ).toBe("full");
  });
});

describe("resolveThreadExecutionPermissionMode", () => {
  it("prefers requested permission modes over every fallback", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        requestedPermissionMode: "readonly",
        lastExecutionPermissionMode: "workspace-write",
        projectExecutionPermissionMode: "full",
        thread: makeThread(),
      }),
    ).toBe("readonly");
  });

  it("uses the last execution permission mode before project or policy defaults", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        lastExecutionPermissionMode: "readonly",
        projectExecutionPermissionMode: "full",
        thread: makeThread(),
      }),
    ).toBe("readonly");
  });

  it("uses project permission defaults before provider policy defaults", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        projectExecutionPermissionMode: "readonly",
        thread: makeThread(),
      }),
    ).toBe("readonly");
  });
});
