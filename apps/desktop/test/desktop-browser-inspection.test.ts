import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserInspectionPageResultV2 } from "@bb/desktop-contract";
import {
  createDesktopBrowserInspectionCancelSource,
  createDesktopBrowserInspectionControllerSource,
  startDesktopBrowserInspection,
  startDesktopBrowserInspectionV2,
  type DesktopBrowserInspectionWebContents,
} from "../src/desktop-browser-inspection.js";

const pageResult: BbDesktopBrowserInspectionPageResultV2 = {
  version: 2,
  kind: "region",
  page: {
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 800, height: 600 },
    scroll: { x: 10, y: 20 },
  },
  rect: { x: 10, y: 20, width: 200, height: 100 },
  deviceScaleFactor: 2,
  element: null,
  region: {
    commonAncestor: null,
    targets: [],
    groups: [],
    omittedTargetCount: 0,
    omittedGroupCount: 0,
    scanTruncated: false,
  },
};

class FakeInspectionWebContents
  extends EventEmitter
  implements DesktopBrowserInspectionWebContents
{
  public readonly order: string[] = [];
  public resolveController: ((value: unknown) => void) | null = null;
  public url = "https://example.com/";

  capturePage() {
    this.order.push("capture");
    return Promise.resolve({
      getSize: () => ({ width: 1600, height: 1200 }),
      isEmpty: () => false,
      toPNG: () => Buffer.from("png-bytes"),
    });
  }

  executeJavaScript(source: string): Promise<unknown> {
    if (source.includes('"kind":"region"')) {
      this.order.push("controller");
      return new Promise((resolve) => {
        this.resolveController = resolve;
      });
    }
    this.order.push("cancel");
    return Promise.resolve(undefined);
  }

  getURL(): string {
    return this.url;
  }

  getZoomFactor(): number {
    return 1.25;
  }

  isDestroyed(): boolean {
    return false;
  }
}

function inspectionRequest() {
  return {
    tabId: "browser:a",
    kind: "region" as const,
    requestId: "inspection-1",
  };
}

describe("desktop Browser inspection session", () => {
  it("projects deterministic V2 regions to the frozen V1 elements shape", async () => {
    const webContents = new FakeInspectionWebContents();
    const v2Region = {
      ...pageResult,
      region: {
        ...pageResult.region,
        commonAncestor: {
          kind: "element" as const,
          absoluteLocator: { selectors: ["#list"] },
        },
        targets: [
          {
            absoluteLocator: { selectors: ["#list > button:nth-of-type(1)"] },
            relativeLocator: { selectors: [":scope > button:nth-of-type(1)"] },
            text: "Invite member",
            rect: { x: 10, y: 20, width: 100, height: 30 },
          },
        ],
      },
    };
    const session = startDesktopBrowserInspection({
      request: inspectionRequest(),
      webContents,
    });
    webContents.resolveController?.(v2Region);

    await expect(session.promise).resolves.toMatchObject({
      version: 1,
      region: {
        elements: [
          {
            selector: "#list > button:nth-of-type(1)",
            tag: "button",
            text: "Invite member",
          },
        ],
      },
    });
  });

  it("captures only after bounded page data and records exact scale metadata", async () => {
    const webContents = new FakeInspectionWebContents();
    const session = startDesktopBrowserInspectionV2({
      request: inspectionRequest(),
      webContents,
    });
    webContents.resolveController?.(pageResult);

    await expect(session.promise).resolves.toMatchObject({
      kind: "region",
      screenshot: {
        pixelSize: { width: 1600, height: 1200 },
        deviceScaleFactor: 2,
        pageZoom: 1.25,
        cssToImageScale: { x: 2, y: 2 },
      },
    });
    expect(webContents.order).toEqual(["controller", "capture", "cancel"]);
    expect(webContents.listenerCount("did-start-navigation")).toBe(0);
    expect(webContents.listenerCount("destroyed")).toBe(0);
  });

  it("settles null and disposes once on navigation cancellation", async () => {
    const webContents = new FakeInspectionWebContents();
    const session = startDesktopBrowserInspectionV2({
      request: inspectionRequest(),
      webContents,
    });

    webContents.emit("did-start-navigation");
    webContents.emit("did-start-navigation");

    await expect(session.promise).resolves.toBeNull();
    expect(webContents.order).toEqual(["controller", "cancel", "cancel"]);
    expect(webContents.listenerCount("did-start-navigation")).toBe(0);
  });

  it("uses static functions with only the random id and fixed mode as input", () => {
    const controller = createDesktopBrowserInspectionControllerSource({
      requestId: "request-id",
      kind: "element",
    });
    const cancel = createDesktopBrowserInspectionCancelSource("request-id");

    expect(controller).toContain('"requestId":"request-id"');
    expect(controller).toContain('"kind":"element"');
    expect(cancel).toContain('"request-id"');
    expect(controller).not.toContain("https://example.com");
    expect(controller).not.toContain("instruction");
  });

  it("enforces the main-process deadline", async () => {
    vi.useFakeTimers();
    try {
      const webContents = new FakeInspectionWebContents();
      const session = startDesktopBrowserInspectionV2({
        request: inspectionRequest(),
        webContents,
        deadlineMs: 20,
      });
      await vi.advanceTimersByTimeAsync(20);
      await expect(session.promise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
