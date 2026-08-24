import type { HostProviderCliStatusResponse } from "@bb/server-contract";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { hostProviderCliStatusQueryKey } from "../queries/query-keys";
import { SESSION_STATIC_QUERY_POLICY } from "../queries/query-policies";
import { recheckHostProviderCliStatus } from "./provider-cli-status-cache-owner";

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { providerCliStatus: vi.fn() } },
}));

function status(displayName: string): HostProviderCliStatusResponse[string] {
  return {
    displayName,
    executableName: displayName.toLowerCase(),
    executablePath: `/usr/local/bin/${displayName.toLowerCase()}`,
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
  };
}

afterEach(() => {
  vi.mocked(sdk.hosts.providerCliStatus).mockReset();
});

describe("recheckHostProviderCliStatus", () => {
  it("still sends force when a plain fetch for the host is in flight", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = hostProviderCliStatusQueryKey("host_1");
    const memoized: HostProviderCliStatusResponse = { codex: status("Codex") };
    const probed: HostProviderCliStatusResponse = {
      codex: status("Codex"),
      pi: status("Pi"),
    };
    let answerPlainFetch: (
      value: HostProviderCliStatusResponse,
    ) => void = () => {};
    vi.mocked(sdk.hosts.providerCliStatus).mockImplementation((args) =>
      args.force === true
        ? Promise.resolve(probed)
        : new Promise((resolve) => {
            answerPlainFetch = resolve;
          }),
    );

    // useUpdateInventory's observer: its plain fetch starts on subscribe and
    // is still pending (the server pays an expired discovery probe before
    // answering from its status memo) when the on-open check reaches this
    // host.
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: ({ signal }) =>
        sdk.hosts.providerCliStatus({ hostId: "host_1", signal }),
      ...SESSION_STATIC_QUERY_POLICY,
    });
    const unsubscribe = observer.subscribe(() => {});
    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe("fetching");

    const recheck = recheckHostProviderCliStatus({
      queryClient,
      hostId: "host_1",
    });
    answerPlainFetch(memoized);
    await recheck;

    const calls = vi.mocked(sdk.hosts.providerCliStatus).mock.calls;
    expect(calls).toHaveLength(2);
    // The plain request was abandoned, not joined.
    expect(calls[0]?.[0].signal?.aborted).toBe(true);
    expect(calls[1]?.[0]).toEqual({
      hostId: "host_1",
      force: true,
      signal: expect.any(AbortSignal),
    });
    expect(queryClient.getQueryData(queryKey)).toEqual(probed);
    unsubscribe();
  });
});
