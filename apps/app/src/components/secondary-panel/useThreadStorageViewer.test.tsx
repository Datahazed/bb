// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadStorageViewer } from "./useThreadStorageViewer";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      storageFiles: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadStorageViewer", () => {
  it("defers the storage listing until its panel is enabled", async () => {
    vi.mocked(sdk.threads.storageFiles).mockResolvedValue({
      files: [],
      storageRootPath: "/tmp/thread-storage/thread-1",
      truncated: false,
    });
    const { wrapper } = createQueryClientTestHarness();
    const result = renderHook(
      ({ fileListEnabled }: { fileListEnabled?: boolean }) =>
        useThreadStorageViewer({
          activePath: null,
          ...(fileListEnabled !== undefined ? { fileListEnabled } : {}),
          filePreviewEnabled: false,
          threadId: "thread-1",
        }),
      { initialProps: {}, wrapper },
    );

    expect(sdk.threads.storageFiles).not.toHaveBeenCalled();

    result.rerender({ fileListEnabled: true });
    await waitFor(() => {
      expect(sdk.threads.storageFiles).toHaveBeenCalledTimes(1);
    });
  });
});
