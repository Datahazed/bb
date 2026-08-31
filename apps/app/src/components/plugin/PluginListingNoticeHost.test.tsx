// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginListingNoticeHost } from "./PluginListingNoticeHost";
import { appToast } from "@/components/ui/app-toast";
import {
  useConsumePluginListingNotice,
  usePluginListings,
} from "@/hooks/queries/plugin-settings-queries";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginListings: vi.fn(),
  useConsumePluginListingNotice: vi.fn(),
}));

describe("PluginListingNoticeHost", () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useConsumePluginListingNotice).mockReturnValue({
      mutate,
    } as never);
  });

  it("surfaces and consumes a persisted notice exactly once across refetch renders", () => {
    const result = {
      data: {
        records: [],
        notices: [
          {
            id: "pln_1",
            kind: "published",
            pluginId: "usage",
            pluginName: "Usage",
            createdAt: 1,
          },
        ],
      },
    } as never;
    vi.mocked(usePluginListings).mockReturnValue(result);
    const view = render(<PluginListingNoticeHost />);

    expect(appToast.success).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("pln_1");
    view.rerender(<PluginListingNoticeHost />);
    expect(appToast.success).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
