// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearClaimedIdentity,
  getClaimedIdentity,
  isRemoteAppContext,
  resetClaimedIdentityStoreForTest,
  setClaimedDisplayName,
} from "./claimed-identity-store";

afterEach(() => {
  localStorage.clear();
  resetClaimedIdentityStoreForTest();
});

describe("claimed identity store", () => {
  // jsdom serves the suite from localhost, which is exactly the context that
  // must never claim an identity — desktop/localhost run as the local operator.
  it("treats the localhost origin as non-remote and suppresses any identity", () => {
    expect(isRemoteAppContext()).toBe(false);
    setClaimedDisplayName("Alice Chen");
    expect(getClaimedIdentity()).toBeNull();
  });

  it("normalizes the display name into the stored handle", () => {
    const identity = setClaimedDisplayName("  Alice Chen  ");
    expect(identity).not.toBeNull();
    expect(identity?.displayName).toBe("Alice Chen");
    expect(identity?.handle).toBe("alice chen");
    expect(identity?.imageUrl).toBeNull();
    expect(identity?.clientId.length).toBeGreaterThan(0);
  });

  it("rejects names that normalize to nothing", () => {
    expect(setClaimedDisplayName("   ")).toBeNull();
  });

  it("keeps the same clientId across identity changes", () => {
    const first = setClaimedDisplayName("Alice");
    const second = setClaimedDisplayName("Alice Cooper");
    expect(second?.clientId).toBe(first?.clientId);
  });

  it("persists the identity to storage and reloads it", () => {
    setClaimedDisplayName("Alice");
    resetClaimedIdentityStoreForTest();
    // Storage round-trip: stored value survives a module-state reset. The
    // localhost gate still hides it from getClaimedIdentity, so assert the raw
    // persisted record instead.
    const raw = localStorage.getItem("bb.claimedIdentity");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).toMatchObject({
      handle: "alice",
      displayName: "Alice",
      imageUrl: null,
    });
  });

  it("clears the stored identity", () => {
    setClaimedDisplayName("Alice");
    clearClaimedIdentity();
    expect(localStorage.getItem("bb.claimedIdentity")).toBeNull();
  });
});
