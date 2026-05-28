// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AppDetail } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AppTabContent } from "./AppTabContent";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getThreadApp: vi.fn(),
    getThreadAppMarkdownPreview: vi.fn(),
  };
});

const HTML_APP: AppDetail = {
  id: "status",
  name: "Status",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
};

const MARKDOWN_APP: AppDetail = {
  id: "readme",
  name: "Readme",
  entry: { path: "docs/index.md", kind: "md" },
  capabilities: [],
  icon: { kind: "builtin", name: "GridView" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppTabContent", () => {
  it("renders HTML apps in the injected app iframe route", async () => {
    vi.mocked(api.getThreadApp).mockResolvedValue(HTML_APP);
    const { wrapper } = createQueryClientTestHarness();

    render(<AppTabContent threadId="thr_1" appId="status" />, { wrapper });

    const frame = await screen.findByTitle("Status");
    expect(frame.getAttribute("src")).toBe(
      "/api/v1/threads/thr_1/apps/status/",
    );
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(api.getThreadAppMarkdownPreview).not.toHaveBeenCalled();
  });

  it("renders markdown apps through the static markdown preview path", async () => {
    vi.mocked(api.getThreadApp).mockResolvedValue(MARKDOWN_APP);
    vi.mocked(api.getThreadAppMarkdownPreview).mockResolvedValue({
      kind: "text",
      path: "docs/index.md",
      name: "index.md",
      url: "/api/v1/threads/thr_1/apps/readme/docs/index.md",
      mimeType: "text/markdown",
      content: "# App Notes\n\nStatic content.",
    });
    const { wrapper } = createQueryClientTestHarness();

    render(<AppTabContent threadId="thr_1" appId="readme" />, { wrapper });

    expect(await screen.findByText("App Notes")).toBeTruthy();
    expect(screen.getByText("Static content.")).toBeTruthy();
    expect(api.getThreadAppMarkdownPreview).toHaveBeenCalledWith(
      "thr_1",
      "readme",
      "docs/index.md",
      expect.any(AbortSignal),
    );
  });
});
