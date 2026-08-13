// @vitest-environment jsdom
// Frontend tests for the inline-vis messageDirective slot.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
};

describe("inline-vis messageDirective registration", () => {
  it("registers the inline-vis directive", () => {
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]!.id).toBe("inline-vis");
  });
});

describe("InlineVisDirective", () => {
  it("requires a file attribute without calling rpc", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: {},
        source: "::inline-vis{}",
        message,
        openWorkspaceFile: null,
      },
      { rpc: {} },
    );

    await slot.findByRole("alert");
    expect(slot.getByText(/requires a file attribute/i)).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("uses the sidebar worktree route with an opaque-origin script sandbox", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "charts/demo file.html" },
        source: '::inline-vis{file="charts/demo file.html"}',
        message,
        openWorkspaceFile,
      },
      {
        rpc: {
          prepareHtmlPreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "charts/demo file.html",
            });
            return { file: "charts/demo file.html" };
          },
        },
      },
    );

    await slot.findByRole("status", {
      name: "Loading visualization charts/demo file.html",
    });

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      expect(el).toBeTruthy();
      return el as HTMLIFrameElement;
    });

    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("src")).toBe(
      "/api/v1/threads/thr_1/worktree/files/charts/demo%20file.html",
    );
    expect(iframe.getAttribute("srcdoc")).toBeNull();
    expect(iframe.style.height).toBe("224px");
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open charts/demo file.html in sidebar",
      }),
    );
    expect(openWorkspaceFile).toHaveBeenCalledWith("charts/demo file.html");
    expect(slot.rpcCalls).toEqual([
      {
        method: "prepareHtmlPreview",
        input: { threadId: "thr_1", file: "charts/demo file.html" },
      },
    ]);
  });

  it("uses an optional bounded height attribute", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", height: "480" },
        source: '::inline-vis{file="demo.html" height="480"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          prepareHtmlPreview: () => ({ file: "demo.html" }),
        },
      },
    );

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      expect(el).toBeTruthy();
      return el as HTMLIFrameElement;
    });
    expect(iframe.style.height).toBe("480px");
  });

  it("renders a complete fixed skeleton with shimmer-only motion", async () => {
    let resolvePreview = (_result: { file: string }) => {};
    const pendingPreview = new Promise<{ file: string }>((resolve) => {
      resolvePreview = resolve;
    });
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", height: "480" },
        source: '::inline-vis{file="demo.html" height="480"}',
        message,
        openWorkspaceFile,
      },
      {
        rpc: {
          prepareHtmlPreview: () => pendingPreview,
        },
      },
    );

    const loadingSkeleton = await slot.findByRole("status", {
      name: "Loading visualization demo.html",
    });
    expect(loadingSkeleton.style.height).toBe("480px");
    const skeletonSteps = Array.from(
      loadingSkeleton.querySelectorAll("[data-inline-vis-skeleton-step]"),
    );
    expect(
      skeletonSteps.map((step) =>
        step.getAttribute("data-inline-vis-skeleton-step"),
      ),
    ).toEqual([
      "region-1",
      "region-2",
      "region-3",
      "region-4",
      "region-5",
      "region-6",
    ]);
    for (const step of skeletonSteps) {
      expect(
        Array.from(step.classList).some((className) =>
          className.startsWith("delay-"),
        ),
      ).toBe(false);
      expect(step.classList.contains("animate-in")).toBe(false);
      expect(step.classList.contains("fade-in-0")).toBe(false);
      expect(step.classList.contains("slide-in-from-bottom-1")).toBe(false);
      expect(step.classList.contains("fill-mode-backwards")).toBe(false);
    }
    const shimmerElements = Array.from(
      loadingSkeleton.querySelectorAll("[data-inline-vis-skeleton-shimmer]"),
    );
    expect(shimmerElements).toHaveLength(6);
    for (const shimmerElement of shimmerElements) {
      expect(shimmerElement.classList.contains("animate-shine-icon")).toBe(
        true,
      );
    }
    expect(loadingSkeleton.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(
      loadingSkeleton.querySelector("[data-inline-vis-skeleton-canvas]"),
    ).not.toBeNull();
    expect(
      loadingSkeleton.querySelector("[data-inline-vis-skeleton-plot]"),
    ).toBeNull();
    expect(
      skeletonSteps.some((step) =>
        step.getAttribute("data-inline-vis-skeleton-step")?.includes("bar"),
      ),
    ).toBe(false);
    expect(
      loadingSkeleton.querySelector(".min-h-0.w-full.flex-1.animate-pulse"),
    ).toBeNull();
    const loadingCard = loadingSkeleton.parentElement;
    const actionSpacer = loadingCard?.firstElementChild?.lastElementChild;
    expect(actionSpacer?.getAttribute("aria-hidden")).toBe("true");
    expect(actionSpacer?.classList.contains("size-5")).toBe(true);

    resolvePreview({ file: "demo.html" });

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      if (!(el instanceof HTMLIFrameElement)) {
        throw new Error("Expected the inline visualization iframe to render");
      }
      return el;
    });
    expect(iframe.style.height).toBe("480px");
    expect(
      slot.queryByRole("status", {
        name: "Loading visualization demo.html",
      }),
    ).toBeNull();
  });

  it("rejects an invalid height without calling rpc", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", height: "100vh" },
        source: '::inline-vis{file="demo.html" height="100vh"}',
        message,
        openWorkspaceFile: null,
      },
      { rpc: {} },
    );

    expect((await slot.findByRole("alert")).textContent).toMatch(
      /whole number from 120 to 1200 pixels/i,
    );
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("shows an error when rpc fails", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "missing.html" },
        source: '::inline-vis{file="missing.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          prepareHtmlPreview: () => {
            throw new Error("HTML file not found: missing.html");
          },
        },
      },
    );

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/HTML file not found: missing\.html/);
    expect(slot.container.querySelector("iframe")).toBeNull();
  });
});
