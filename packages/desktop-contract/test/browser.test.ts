import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  BB_DESKTOP_BROWSER_INSPECTION_MAX_DOM_LENGTH,
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserInspectionPageResultSchema,
  bbDesktopBrowserInspectionRequestSchema,
  bbDesktopBrowserInspectionResultSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserStateSchema,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewportBounds,
} from "../src/index.js";

interface BrowserBoundsClampTestCase {
  bounds: BbDesktopBrowserViewBounds;
  expected: BbDesktopBrowserViewBounds;
  label: string;
  viewport: BbDesktopBrowserViewportBounds;
}

const browserBoundsClampTestCases: BrowserBoundsClampTestCase[] = [
  {
    label: "anchors the left edge and trims overflow at the right and bottom",
    bounds: { x: 180, y: 48, width: 400, height: 420 },
    viewport: { width: 500, height: 360 },
    expected: { x: 180, y: 48, width: 320, height: 312 },
  },
  {
    label: "clamps negative origins to the host content edge",
    bounds: { x: -24, y: -10, width: 200, height: 120 },
    viewport: { width: 500, height: 360 },
    expected: { x: 0, y: 0, width: 176, height: 110 },
  },
  {
    label: "collapses bounds that start outside the host content area",
    bounds: { x: 640, y: 400, width: 120, height: 90 },
    viewport: { width: 500, height: 360 },
    expected: { x: 500, y: 360, width: 0, height: 0 },
  },
  {
    label: "leaves bounds that already fit the viewport untouched",
    bounds: { x: 100, y: 50, width: 300, height: 250 },
    viewport: { width: 500, height: 360 },
    expected: { x: 100, y: 50, width: 300, height: 250 },
  },
];

describe("desktop browser bounds containment", () => {
  it.each(browserBoundsClampTestCases)("$label", (testCase) => {
    expect(
      clampBbDesktopBrowserViewBounds({
        bounds: testCase.bounds,
        viewport: testCase.viewport,
      }),
    ).toEqual(testCase.expected);
  });
});

describe("desktop browser IPC schemas", () => {
  it("accepts a well-formed attach request and rejects bad shapes", () => {
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0, y: 0, width: -1, height: 600 },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed state push and rejects non-integer bounds", () => {
    expect(
      bbDesktopBrowserStateSchema.safeParse({
        tabId: "browser:abc",
        url: "https://example.com",
        title: "Example",
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0.5, y: 0, width: 800, height: 600 },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized URLs beyond the length cap", () => {
    const longUrl = `https://example.com/${"a".repeat(
      BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
    )}`;
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: longUrl,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: true,
      }).success,
    ).toBe(false);
  });
});

const elementPageResult = {
  version: 1,
  kind: "element",
  page: {
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 100 },
  },
  rect: { x: 20, y: 30, width: 100, height: 40 },
  deviceScaleFactor: 2,
  element: {
    selector: "main > button#save",
    tag: "button",
    id: "save",
    classNames: ["primary"],
    rect: { x: 20, y: 30, width: 100, height: 40 },
    dom: '<button id="save">Save</button>',
    text: "Save",
    styles: { display: "block", color: "rgb(0, 0, 0)" },
    accessibility: {
      source: "dom-hint",
      roleHint: "button",
      nameHint: "Save",
      attributes: { "aria-label": "Save" },
    },
    reactComponentStack: ["SaveButton", "Toolbar"],
  },
  region: null,
} as const;

const regionPageResult = {
  version: 1,
  kind: "region",
  page: {
    url: "https://example.com/members",
    title: "Members",
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 100 },
  },
  rect: { x: 20, y: 30, width: 400, height: 140 },
  deviceScaleFactor: 2,
  element: null,
  region: {
    commonAncestor: {
      kind: "element",
      absoluteLocator: { selectors: ["table#members > tbody"] },
    },
    targets: [
      {
        absoluteLocator: {
          selectors: ["table#members > tbody > tr:nth-of-type(2) > td"],
        },
        relativeLocator: { selectors: ["tr:nth-of-type(2) > td"] },
        text: "Ben",
        rect: { x: 20, y: 30, width: 180, height: 40 },
        accessibility: {
          source: "dom-hint",
          roleHint: null,
          nameHint: null,
          attributes: { "aria-current": "true" },
        },
        react: {
          componentStack: ["MemberCell", "MembersTable"],
          source: {
            fileName: "/src/MembersTable.tsx",
            lineNumber: 24,
            columnNumber: 9,
          },
        },
      },
    ],
    groups: [
      {
        absoluteLocator: {
          selectors: [
            "table#members > tbody > tr:nth-of-type(2), table#members > tbody > tr:nth-of-type(3)",
          ],
        },
        relativeLocator: {
          selectors: ["tr:nth-of-type(2), tr:nth-of-type(3)"],
        },
        count: 2,
        rect: { x: 20, y: 30, width: 400, height: 90 },
      },
    ],
    omittedTargetCount: 0,
    omittedGroupCount: 0,
  },
} as const;

describe("experimental desktop browser inspection schemas", () => {
  it("keeps inspection on a separate strict identity-scoped request", () => {
    const request = {
      tabId: "browser:a",
      kind: "element",
      requestId: "inspection-1",
      identity: { threadId: "thr_1", projectId: "prj_1" },
    };
    expect(bbDesktopBrowserInspectionRequestSchema.parse(request)).toEqual(
      request,
    );
    expect(
      bbDesktopBrowserInspectionRequestSchema.safeParse({
        ...request,
        instruction: "page-controlled source must never enter execution",
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionRequestSchema.parse({
        ...request,
        kind: "auto",
      }).kind,
    ).toBe("auto");
  });

  it("accepts a bounded element result and rejects mismatched or oversized branches", () => {
    expect(
      bbDesktopBrowserInspectionPageResultSchema.parse(elementPageResult),
    ).toEqual(elementPageResult);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...elementPageResult,
        kind: "region",
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...elementPageResult,
        element: {
          ...elementPageResult.element,
          dom: "x".repeat(BB_DESKTOP_BROWSER_INSPECTION_MAX_DOM_LENGTH + 1),
        },
      }).success,
    ).toBe(false);
  });

  it("accepts exact region locators and rejects the removed sampled-elements shape", () => {
    expect(
      bbDesktopBrowserInspectionPageResultSchema.parse(regionPageResult),
    ).toEqual(regionPageResult);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...regionPageResult,
        region: { elements: [] },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...regionPageResult,
        region: {
          ...regionPageResult.region,
          targets: [
            {
              ...regionPageResult.region.targets[0],
              absoluteLocator: { selectors: [] },
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...regionPageResult,
        region: {
          ...regionPageResult.region,
          groups: [{ ...regionPageResult.region.groups[0], count: 0 }],
        },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...regionPageResult,
        region: {
          ...regionPageResult.region,
          commonAncestor: null,
        },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionPageResultSchema.safeParse({
        ...regionPageResult,
        region: {
          ...regionPageResult.region,
          targets: [
            {
              ...regionPageResult.region.targets[0],
              accessibility: {
                source: "dom-hint",
                roleHint: null,
                nameHint: null,
                attributes: {},
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("requires PNG data and positive screenshot scale metadata", () => {
    const { deviceScaleFactor, ...capture } = elementPageResult;
    const result = {
      ...capture,
      screenshot: {
        dataUrl: "data:image/png;base64,aGVsbG8=",
        pixelSize: { width: 1600, height: 1200 },
        deviceScaleFactor,
        pageZoom: 1.25,
        cssToImageScale: { x: 2, y: 2 },
      },
    };
    expect(bbDesktopBrowserInspectionResultSchema.parse(result)).toEqual(
      result,
    );
    expect(
      bbDesktopBrowserInspectionResultSchema.safeParse({
        ...result,
        screenshot: {
          ...result.screenshot,
          dataUrl: "data:image/jpeg;base64,eA==",
        },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserInspectionResultSchema.safeParse({
        ...result,
        screenshot: {
          ...result.screenshot,
          cssToImageScale: { x: 0, y: 2 },
        },
      }).success,
    ).toBe(false);
  });
});
