import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Host } from "@bb/domain";
import { resolveHostsQueryMount, selectPrimaryHost } from "./host-queries";
import { hostsQueryKey } from "./query-keys";

function host(overrides: Partial<Host> & Pick<Host, "id">): Host {
  return {
    name: overrides.id,
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("selectPrimaryHost", () => {
  it("returns the server-resolved primary even when another host connected first", () => {
    const hosts = [host({ id: "host_a" }), host({ id: "host_b" })];
    expect(selectPrimaryHost(hosts, "host_b")?.id).toBe("host_b");
  });

  it("does not promote another machine when the server primary is not in the list", () => {
    const hosts = [host({ id: "host_a" })];
    expect(selectPrimaryHost(hosts, "host_gone")).toBeNull();
  });

  it("falls back to the connected-first heuristic only without a server value", () => {
    const hosts = [
      host({ id: "host_stale", status: "disconnected" }),
      host({ id: "host_live" }),
    ];
    expect(selectPrimaryHost(hosts, null)?.id).toBe("host_live");
    expect(selectPrimaryHost([hosts[0]], null)?.id).toBe("host_stale");
  });

  it("returns null for an empty or missing host list", () => {
    expect(selectPrimaryHost(undefined, "host_a")).toBeNull();
    expect(selectPrimaryHost([], null)).toBeNull();
  });
});

describe("resolveHostsQueryMount", () => {
  it("enables a cached host list while bootstrap is still in flight and does not refetch", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(hostsQueryKey(), [host({ id: "host-1" })]);
    expect(
      resolveHostsQueryMount({
        bootstrapSettled: false,
        environmentId: "env-1",
        queryClient,
      }),
    ).toEqual({ enabled: true, refetchOnMount: false });
  });

  it("does not start a hosts read until bootstrap when the cache is empty", () => {
    expect(
      resolveHostsQueryMount({
        bootstrapSettled: false,
        environmentId: "env-1",
        queryClient: new QueryClient(),
      }),
    ).toEqual({ enabled: false, refetchOnMount: false });
  });
});
