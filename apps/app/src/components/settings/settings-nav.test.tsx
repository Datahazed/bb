// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSettingsNavState } from "./settings-nav";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSystemConfig: vi.fn(),
  };
});

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
}));

function systemConfig(pluginsEnabled: boolean): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: {
      ...defaultExperiments,
      plugins: pluginsEnabled,
    },
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

function wrapperFor(path: string) {
  const { wrapper: QueryWrapper } = createQueryClientTestHarness();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryWrapper>
    );
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useSettingsNavState", () => {
  it("resolves Codex and Claude Code as separate provider pages", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(false));

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers/claude-code"),
    });

    await waitFor(() => {
      expect(result.current.activeProviderId).toBe("claude-code");
    });
    expect(result.current.activeSection).toBeNull();
    expect(
      result.current.providerEntries.map((provider) => provider.id),
    ).toEqual(["codex", "claude-code"]);
  });

  it("shows the Machines section", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(false));

    const result = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/machines"),
    });
    await waitFor(() => {
      expect(
        result.result.current.sections.map((section) => section.id),
      ).toContain("machines");
    });
  });

  it("resolves archived threads as a settings section", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(false));

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/archived"),
    });

    await waitFor(() => {
      expect(result.current.activeSection).toBe("archived");
    });
    expect(result.current.sections.map((section) => section.id)).toContain(
      "archived",
    );
  });

  it("keeps plugin configuration out of global Settings", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings"),
    });

    await waitFor(() => {
      expect(
        result.current.sections.map((section) => section.id),
      ).not.toContain("plugins");
    });
  });
});
