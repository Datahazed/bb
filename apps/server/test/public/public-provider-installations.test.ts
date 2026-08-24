import type {
  HostDaemonOnlineRpcRequestMessage,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { DEFAULT_BB_REQUEST_TIMEOUT_MS } from "@bb/sdk";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { describe, expect, it, vi } from "vitest";
import { COMMAND_TIMEOUT_MS } from "../../src/constants.js";
import { ApiError } from "../../src/errors.js";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import {
  type HostRpcHandlerResult,
  registerHostRpcResponder,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedSession } from "../helpers/seed.js";
import { type TestAppHarness, withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1";

function registerInstallationProviders(
  harness: TestAppHarness,
  providerIds: readonly string[],
): void {
  const bridgeArtifact = harness.deps.pluginHostArtifacts.get("provider-acp");
  if (bridgeArtifact === undefined) {
    throw new Error("Expected the test ACP provider bridge artifact");
  }
  for (const providerId of providerIds) {
    const pluginId = `provider-${providerId}`;
    harness.deps.providerRegistry.register({
      ...buildPluginProviderRegistration({
        available: true,
        pluginId,
        declaration: validatePluginProviderDeclaration({
          id: providerId,
          displayName: providerId,
          maintenance: { health: false, usage: false, installation: true },
          capabilities: {
            supportsServiceTier: false,
            supportsNativeUserQuestion: false,
            fork: "none",
            supportsManualCompaction: false,
            supportsThreadArchive: false,
            supportsThreadRename: false,
            permissionModes: ["full"],
            reasoningLevels: ["medium"],
          },
          composerActions: [],
        }),
        readSettings: () => ({}),
      }),
      pluginId,
      iconNames: new Set<string>(),
    });
    harness.deps.pluginHostArtifacts.set(pluginId, bridgeArtifact);
  }
}

function installationStatus(providerId: string) {
  const executableName =
    providerId === "claude-code"
      ? "claude"
      : providerId === "acp-cursor"
        ? "cursor-agent"
        : providerId === "pi"
          ? "pi"
          : "codex";
  return {
    executableName,
    executablePath: `/usr/local/bin/${executableName}`,
    installed: true,
    installSource: "external" as const,
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "update" as const,
      label: "Update" as const,
      command: `${executableName} update`,
    },
    needsUpdate: true,
    versionUnsupported: false,
  };
}

function handleProviderInstallationRpc(
  request: HostDaemonOnlineRpcRequestMessage,
) {
  const { command } = request;
  if (command.type === "provider.health") {
    return {
      ok: true as const,
      result: {
        supported: true as const,
        health: {
          status: "not_installed" as const,
          statusMessage: null,
          accountEmail: null,
          planLabel: null,
          installedVersion: null,
          minimumSupportedVersion: null,
          canInstall: false,
          canUpdate: false,
          loginCommand: null,
        },
      },
    };
  }
  if (command.type === "provider.installation.status") {
    return {
      ok: true as const,
      result: installationStatus(command.providerId),
    };
  }
  if (command.type === "provider.installation.run") {
    return {
      ok: true as const,
      result: {
        events: [
          {
            type: "completed" as const,
            provider: command.providerId,
            exitCode: 0,
            signal: null,
            success: true,
          },
        ],
      },
    };
  }
  throw new Error(`Unexpected host RPC ${command.type}`);
}

describe("public provider installation routes", () => {
  it("lists installation-capable registered providers in registry order", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-status-host",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as ProviderCliStatusResponse;
      expect(Object.keys(body)).toEqual([
        "codex",
        "claude-code",
        "pi",
        "acp-cursor",
      ]);
      expect(Object.values(body).map((status) => status.displayName)).toEqual([
        "Codex",
        "Claude Code",
        "Pi",
        "Cursor",
      ]);
      expect(
        responder.requests
          .filter((request) => request.command.type === "provider.health")
          .map((request) =>
            request.command.type === "provider.health"
              ? request.command.providerId
              : null,
          ),
      ).toEqual([]);
      expect(
        responder.requests
          .filter(
            (request) =>
              request.command.type === "provider.installation.status",
          )
          .map((request) =>
            request.command.type === "provider.installation.status"
              ? request.command.providerId
              : null,
          ),
      ).toEqual(["codex", "claude-code", "pi", "acp-cursor"]);
    });
  });

  it("preserves healthy providers in registry order when one status request fails", async () => {
    await withTestHarness(async (harness) => {
      const warn = vi.fn();
      harness.deps.logger = { ...harness.deps.logger, warn };
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-partial-status-host",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (
            request.command.type === "provider.installation.status" &&
            request.command.providerId === "claude-code"
          ) {
            return {
              ok: false,
              errorCode: "provider_status_failed",
              errorMessage: "provider status failed",
            };
          }
          return handleProviderInstallationRpc(request);
        },
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as ProviderCliStatusResponse;
      expect(Object.keys(body)).toEqual(["codex", "pi", "acp-cursor"]);
      expect(Object.values(body).map((status) => status.displayName)).toEqual([
        "Codex",
        "Pi",
        "Cursor",
      ]);
      expect(warn).toHaveBeenCalledWith(
        {
          failure: "status_request_failed",
          hostId: host.id,
          providerId: "claude-code",
        },
        "Failed to load provider installation status; omitting provider",
      );
    });
  });

  it("serves repeat status reads from the memo until force re-probes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-memo-host",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });
      const statusRequests = () =>
        responder.requests.filter(
          (request) => request.command.type === "provider.installation.status",
        );

      const first = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      const second = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      expect(first.status).toBe(200);
      expect(await readJson(second)).toEqual(await readJson(first));
      // Four installation-capable providers, probed once each.
      expect(statusRequests()).toHaveLength(4);

      const forced = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status?force=true`,
      );
      expect(forced.status).toBe(200);
      expect(statusRequests()).toHaveLength(8);

      const explicitlyUnforced = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status?force=false`,
      );
      expect(explicitlyUnforced.status).toBe(200);
      expect(statusRequests()).toHaveLength(8);
    });
  });

  it("re-probes status after a provider CLI install", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-memo-install-host",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });
      const statusRequests = () =>
        responder.requests.filter(
          (request) => request.command.type === "provider.installation.status",
        );

      await harness.app.request(`${API}/hosts/${host.id}/provider-clis/status`);
      expect(statusRequests()).toHaveLength(4);

      const install = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "codex", actionKind: "install" }),
        },
      );
      expect(install.status).toBe(200);

      // The app's post-install invalidation sends no force; the route's own
      // clear is what makes the CLI it just installed show up.
      await harness.app.request(`${API}/hosts/${host.id}/provider-clis/status`);
      expect(statusRequests()).toHaveLength(8);
    });
  });

  it("re-probes status after an install that finished while a status probe was in flight", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-memo-inflight-install-host",
      });
      // The first claude-code status probe answers only when the test says
      // so; every later one reports the post-update version.
      let resolvePreInstallStatus: (
        result: HostRpcHandlerResult,
      ) => void = () => {};
      let markPreInstallProbeStarted: () => void = () => {};
      const preInstallProbeStarted = new Promise<void>((resolve) => {
        markPreInstallProbeStarted = resolve;
      });
      let claudeStatusProbes = 0;
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (
            request.command.type === "provider.installation.status" &&
            request.command.providerId === "claude-code"
          ) {
            claudeStatusProbes += 1;
            if (claudeStatusProbes === 1) {
              markPreInstallProbeStarted();
              return new Promise<HostRpcHandlerResult>((resolve) => {
                resolvePreInstallStatus = resolve;
              });
            }
            return {
              ok: true,
              result: {
                ...installationStatus("claude-code"),
                currentVersion: "1.1.0",
                installAction: null,
                needsUpdate: false,
              },
            };
          }
          return handleProviderInstallationRpc(request);
        },
      });

      const preInstallRead = harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      await preInstallProbeStarted;

      const install = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "claude-code",
            actionKind: "update",
          }),
        },
      );
      expect(install.status).toBe(200);

      // The probe that was running throughout the update settles after the
      // route's memo clear, with the pre-update version. Its own reader gets
      // that answer; the memo must not keep it.
      resolvePreInstallStatus({
        ok: true,
        result: installationStatus("claude-code"),
      });
      const preInstallBody = (await readJson(
        await preInstallRead,
      )) as ProviderCliStatusResponse;
      expect(preInstallBody["claude-code"]?.currentVersion).toBe("1.0.0");

      // The app's post-install read carries no force.
      const postInstall = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      const postInstallBody = (await readJson(
        postInstall,
      )) as ProviderCliStatusResponse;
      expect(postInstallBody["claude-code"]).toMatchObject({
        currentVersion: "1.1.0",
        needsUpdate: false,
      });
      expect(
        responder.requests.filter(
          (request) =>
            request.command.type === "provider.installation.status" &&
            request.command.providerId === "claude-code",
        ),
      ).toHaveLength(2);
    });
  });

  it("does not memoize a failed status probe", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-memo-failure-host",
      });
      let failClaude = true;
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (
            failClaude &&
            request.command.type === "provider.installation.status" &&
            request.command.providerId === "claude-code"
          ) {
            return {
              ok: false,
              errorCode: "provider_status_failed",
              errorMessage: "provider status failed",
            };
          }
          return handleProviderInstallationRpc(request);
        },
      });

      const failed = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      const failedBody = (await readJson(failed)) as ProviderCliStatusResponse;
      expect(Object.keys(failedBody)).toEqual(["codex", "pi", "acp-cursor"]);

      failClaude = false;
      const recovered = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      const recoveredBody = (await readJson(
        recovered,
      )) as ProviderCliStatusResponse;
      expect(Object.keys(recoveredBody)).toEqual([
        "codex",
        "claude-code",
        "pi",
        "acp-cursor",
      ]);
      // Only the failed provider was asked again; the others were memoized.
      expect(
        responder.requests
          .filter(
            (request) =>
              request.command.type === "provider.installation.status",
          )
          .map((request) =>
            request.command.type === "provider.installation.status"
              ? request.command.providerId
              : null,
          ),
      ).toEqual(["codex", "claude-code", "pi", "acp-cursor", "claude-code"]);
    });
  });

  it("re-probes status after the daemon reconnects", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-memo-reconnect-host",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });
      await harness.app.request(`${API}/hosts/${host.id}/provider-clis/status`);

      // A reconnected daemon may run a different CLI: its first status read
      // must not be answered from the previous session's memo.
      harness.hub.unregisterDaemon(session.id);
      const nextSession = seedSession(harness.deps, host.id);
      const nextResponder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: nextSession.id,
        handle: handleProviderInstallationRpc,
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );
      expect(response.status).toBe(200);
      expect(
        nextResponder.requests.filter(
          (request) => request.command.type === "provider.installation.status",
        ),
      ).toHaveLength(4);
    });
  });

  it("preserves the host unavailable route error when the target host is offline", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-offline-host",
      });
      harness.hub.unregisterDaemon(session.id);

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );

      expect(response.status).toBe(502);
      expect(await readJson(response)).toMatchObject({
        code: "host_unavailable",
      });
    });
  });

  it("finishes stalled provider aggregation before the SDK request timeout", async () => {
    await withTestHarness(async (harness) => {
      registerInstallationProviders(
        harness,
        Array.from(
          { length: 7 },
          (_, index) => `stalled-installation-${index + 1}`,
        ),
      );
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-deadline-host",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });
      const requestHostOnlineRpc = harness.hub.requestHostOnlineRpc.bind(
        harness.hub,
      );
      const statusTimeouts: number[] = [];
      vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
        async (args) => {
          if (args.message.command.type !== "provider.installation.status") {
            return requestHostOnlineRpc(args);
          }
          statusTimeouts.push(args.timeoutMs);
          return new Promise((_, reject) => {
            setTimeout(
              () =>
                reject(
                  new ApiError(
                    504,
                    "command_timeout",
                    "Timed out waiting for command result",
                  ),
                ),
              args.timeoutMs,
            );
          });
        },
      );

      vi.useFakeTimers();
      try {
        const startedAt = Date.now();
        let resolvedAt: number | null = null;
        const responsePromise = Promise.resolve(
          harness.app.request(`${API}/hosts/${host.id}/provider-clis/status`),
        ).then((response) => {
          resolvedAt = Date.now();
          return response;
        });

        await vi.advanceTimersByTimeAsync(150_000);
        const response = await responsePromise;

        expect(response.status).toBe(200);
        expect(await readJson(response)).toEqual({});
        expect(resolvedAt).not.toBeNull();
        expect(resolvedAt! - startedAt).toBeLessThan(
          DEFAULT_BB_REQUEST_TIMEOUT_MS,
        );
        expect(statusTimeouts).toHaveLength(9);
        expect(
          statusTimeouts.some((timeout) => timeout < COMMAND_TIMEOUT_MS),
        ).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("forgets memoized host probes after a provider CLI install", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-memo-clear-host",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });
      const { installedProviderProbe, providerModelList } =
        harness.deps.lifecycleDedupers;
      const models = { models: [], selectedOnlyModels: [] };
      await providerModelList.run("models", async () => models);
      await installedProviderProbe.run("installed", async () => false);

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "claude-code",
            actionKind: "install",
          }),
        },
      );
      expect(response.status).toBe(200);

      // A read after the install must probe the host again: the CLI it just
      // installed is exactly what a memoized answer would misreport.
      const modelProbe = vi.fn(async () => models);
      const installedProbe = vi.fn(async () => true);
      await providerModelList.run("models", modelProbe);
      await installedProviderProbe.run("installed", installedProbe);
      expect(modelProbe).toHaveBeenCalledOnce();
      expect(installedProbe).toHaveBeenCalledOnce();
    });
  });

  it("dispatches install/update by registered provider id", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-run-host",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "claude-code",
            actionKind: "update",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(
        '"type":"completed","provider":"claude-code"',
      );
      expect(responder.requests.at(-1)?.command).toMatchObject({
        type: "provider.installation.run",
        providerId: "claude-code",
        action: "update",
      });

      const unsupported = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // A provider id nothing registered.
          body: JSON.stringify({
            provider: "no-such-provider",
            actionKind: "install",
          }),
        },
      );
      expect(unsupported.status).toBe(404);
      expect(await readJson(unsupported)).toMatchObject({
        code: "provider_installation_unavailable",
      });
    });
  });
});
