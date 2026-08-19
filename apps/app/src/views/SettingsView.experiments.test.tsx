// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  onNewOnboardingEnabledChange?: (enabled: boolean) => void;
  onPersistedQueryCacheEnabledChange?: (enabled: boolean) => void;
  onProviderSessionReapingEnabledChange?: (enabled: boolean) => void;
}) {
  return render(
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={false}
      disabled={false}
      editMessagesEnabled={false}
      newOnboardingEnabled={false}
      persistedQueryCacheEnabled={false}
      providerSessionReapingEnabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
      onEditMessagesEnabledChange={vi.fn()}
      onNewOnboardingEnabledChange={
        overrides?.onNewOnboardingEnabledChange ?? vi.fn()
      }
      onPersistedQueryCacheEnabledChange={
        overrides?.onPersistedQueryCacheEnabledChange ?? vi.fn()
      }
      onProviderSessionReapingEnabledChange={
        overrides?.onProviderSessionReapingEnabledChange ?? vi.fn()
      }
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it("reports new onboarding changes", () => {
    const onChange = vi.fn();
    renderSection({ onNewOnboardingEnabledChange: onChange });
    fireEvent.click(screen.getByLabelText("New onboarding"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports persisted app cache changes", () => {
    const onChange = vi.fn();
    renderSection({ onPersistedQueryCacheEnabledChange: onChange });
    fireEvent.click(screen.getByLabelText("Persisted app cache"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports idle provider session release changes", () => {
    const onChange = vi.fn();
    renderSection({ onProviderSessionReapingEnabledChange: onChange });
    fireEvent.click(screen.getByLabelText("Idle provider session release"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
