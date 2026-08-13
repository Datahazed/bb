import { describe, expect, it } from "vitest";
import { createProviderForId } from "./provider-registry.js";

const canonicalProviderIds = [
  "pi",
  "claude-code",
  "acp-cursor",
  "acp-custom",
] as const;

describe("provider registry", () => {
  it("creates the remaining Codex legacy adapter", () => {
    const provider = createProviderForId("codex");
    expect(provider.id).toBe("codex");
    expect(provider.process.command).toBe("codex");
    expect(provider.process.args).toMatchObject(["app-server"]);
  });

  it.each(canonicalProviderIds)(
    "does not expose canonical provider %s through the legacy registry",
    (providerId) => {
      expect(() => createProviderForId(providerId)).toThrow(
        `Provider "${providerId}" uses the canonical driver and has no legacy adapter.`,
      );
    },
  );

  it("rejects an ACP launch spec for a non-ACP provider", () => {
    expect(() =>
      createProviderForId("codex", {
        additionalWorkspaceWriteRoots: [],
        acpLaunchSpec: {
          displayName: "Wrong provider",
          command: "agent",
          args: [],
          env: {},
        },
      }),
    ).toThrow('ACP launch spec supplied for non-ACP provider "codex".');
  });

  it("rejects unsupported adapters", () => {
    expect(() => createProviderForId("pi-mono")).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });
});
