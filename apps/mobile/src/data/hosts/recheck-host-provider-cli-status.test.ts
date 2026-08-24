import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract/local";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { hostProviderCliStatusQueryKey } from "@/lib/query/query-keys";
import { recheckHostProviderCliStatus } from "./recheck-provider-cli-status";

function status(displayName: string): ProviderCliStatus {
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

describe("recheckHostProviderCliStatus", () => {
  it("re-probes past the server memo and writes the answer into the status query", async () => {
    const queryClient = new QueryClient();
    const stale: ProviderCliStatusResponse = { codex: status("Codex") };
    const fresh: ProviderCliStatusResponse = {
      codex: status("Codex"),
      pi: status("Pi"),
    };
    queryClient.setQueryData(hostProviderCliStatusQueryKey("host_1"), stale);
    const providerCliStatus = vi.fn(async () => fresh);

    await recheckHostProviderCliStatus(
      { sdk: { hosts: { providerCliStatus } } },
      queryClient,
      "host_1",
    );

    // A plain refetch would be answered from the server's memo; force is what
    // makes this a real check.
    expect(providerCliStatus).toHaveBeenCalledWith({
      hostId: "host_1",
      force: true,
      signal: expect.any(AbortSignal),
    });
    expect(
      queryClient.getQueryData(hostProviderCliStatusQueryKey("host_1")),
    ).toEqual(fresh);
  });

  it("resolves when the host is unreachable so a fleet-wide check finishes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const providerCliStatus = vi.fn(
      async (): Promise<ProviderCliStatusResponse> => {
        throw new Error("host_unavailable");
      },
    );

    await expect(
      recheckHostProviderCliStatus(
        { sdk: { hosts: { providerCliStatus } } },
        queryClient,
        "host_1",
      ),
    ).resolves.toBeUndefined();
    expect(
      queryClient.getQueryState(hostProviderCliStatusQueryKey("host_1"))
        ?.status,
    ).toBe("error");
  });
});
