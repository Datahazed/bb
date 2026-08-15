// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopBrowserInspectionCancelSource,
  createDesktopBrowserInspectionControllerSource,
} from "../src/desktop-browser-inspection.js";

beforeEach(() => {
  // Corpus assertions exercise deterministic capture semantics. The region
  // suite separately advances this clock to verify the production deadline.
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty("cursor");
  document.designMode = "off";
  vi.restoreAllMocks();
});

function startElementInspection(target: Element): Promise<unknown> {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 20, 200, 100),
  });
  return window.eval(
    createDesktopBrowserInspectionControllerSource({
      requestId: "redaction-test",
      kind: "element",
    }),
  ) as Promise<unknown>;
}

function startAutoInspection(target: Element): Promise<unknown> {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => [target]),
  });
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 20, 200, 100),
  });
  return window.eval(
    createDesktopBrowserInspectionControllerSource({
      requestId: "auto-test",
      kind: "auto",
    }),
  ) as Promise<unknown>;
}

describe("desktop Browser page controller", () => {
  it("selects the pointed element when auto mode ends as a click", async () => {
    const target = document.body.appendChild(document.createElement("button"));
    target.id = "save";
    target.textContent = "Save";
    const resultPromise = startAutoInspection(target);

    document.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 30,
        clientY: 40,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 30,
        clientY: 40,
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      kind: "element",
      rect: { x: 10, y: 20, width: 200, height: 100 },
      element: { selector: "button#save" },
      region: null,
    });
  });

  it("selects a marked region when auto mode ends as a drag", async () => {
    const target = document.body.appendChild(document.createElement("button"));
    const resultPromise = startAutoInspection(target);

    document.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 20,
        clientY: 30,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: 180,
        clientY: 160,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 180,
        clientY: 160,
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      kind: "region",
      rect: { x: 20, y: 30, width: 160, height: 130 },
      element: null,
      region: {
        commonAncestor: expect.any(Object),
        targets: expect.any(Array),
        groups: expect.any(Array),
        omittedTargetCount: 0,
        omittedGroupCount: 0,
      },
    });
  });

  it("captures the exact common ancestor and deepest targets in document order", async () => {
    document.body.innerHTML = `
      <section id="actions">
        <article><button id="first">First</button></article>
        <article><button id="second">Second</button></article>
      </section>`;
    const section = document.querySelector("section");
    const articles = [...document.querySelectorAll("article")];
    const buttons = [...document.querySelectorAll("button")];
    expect(section).not.toBeNull();
    if (section === null) throw new Error("Expected section fixture");
    for (const element of [section, ...articles, ...buttons]) {
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => new DOMRect(10, 10, 180, 120),
      });
    }
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [
        buttons[1],
        articles[1],
        buttons[0],
        articles[0],
        section,
      ]),
    });
    const resultPromise = window.eval(
      createDesktopBrowserInspectionControllerSource({
        requestId: "ordered-region-test",
        kind: "region",
      }),
    ) as Promise<unknown>;

    document.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 200,
        clientY: 150,
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      kind: "region",
      region: {
        commonAncestor: {
          kind: "element",
          absoluteLocator: { selectors: ["section#actions"] },
        },
        targets: [{ text: "First" }, { text: "Second" }],
        omittedTargetCount: 0,
      },
    });
    expect(document.elementsFromPoint).not.toHaveBeenCalled();
  });

  it("redacts form state, secret-bearing URLs, editable content, and sensitive attributes", async () => {
    document.body.innerHTML = `
      <form id="account" action="https://example.com/reset?token=action-secret" data-token="top-secret" data-safe="kept" style="background:url(https://example.com/style-secret)">
        <a href="https://example.com/reset?token=href-secret">Reset</a>
        <img src="https://example.com/image?signature=src-secret" srcset="https://example.com/image?signature=srcset-secret 2x">
        <button formaction="https://example.com/reset?token=formaction-secret">Submit</button>
        <input type="password" value="password-secret">
        <input type="text" value="text-secret" checked>
        <input type="hidden" value="hidden-secret">
        <textarea value="attribute-secret">textarea-secret</textarea>
        <select><option selected>Selected choice</option></select>
        <div contenteditable="true">editable-secret</div>
        <iframe srcdoc="<p>frame-secret</p>"></iframe>
      </form>`;
    const target = document.querySelector("form");
    expect(target).not.toBeNull();
    if (target === null) throw new Error("Expected form fixture");
    const resultPromise = startElementInspection(target);

    document.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const result = (await resultPromise) as {
      element: { dom: string; text: string };
    };

    expect(result.element.dom).toContain('data-safe="kept"');
    expect(result.element.dom).not.toMatch(
      /action-secret|formaction-secret|href-secret|password-secret|src-secret|srcset-secret|style-secret|text-secret|hidden-secret|textarea-secret|attribute-secret|editable-secret|frame-secret|top-secret/u,
    );
    expect(result.element.dom).not.toMatch(
      /\s(action|formaction|href|src|srcset|style|value|checked|selected|srcdoc|data-token)=/u,
    );
    expect(result.element.text).not.toMatch(/textarea-secret|editable-secret/u);

    await window.eval(
      createDesktopBrowserInspectionCancelSource("redaction-test"),
    );
    expect(
      document.querySelector("[data-bb-page-inspection-overlay]"),
    ).toBeNull();
  });

  it("redacts a selected child whose editable state is inherited", async () => {
    document.body.innerHTML = `
      <div contenteditable="true">
        <span id="selected">inherited-editable-secret</span>
      </div>`;
    const target = document.querySelector("#selected");
    expect(target).not.toBeNull();
    if (target === null) throw new Error("Expected editable child fixture");
    const resultPromise = startElementInspection(target);

    document.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      element: { dom: '<span id="selected"></span>', text: "" },
    });
  });

  it("redacts page text while document design mode is active", async () => {
    document.body.innerHTML = `<section id="selected">design-mode-secret</section>`;
    document.designMode = "on";
    const target = document.querySelector("#selected");
    expect(target).not.toBeNull();
    if (target === null) throw new Error("Expected design-mode fixture");
    const resultPromise = startElementInspection(target);

    document.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      element: { dom: '<section id="selected"></section>', text: "" },
    });
  });

  it("bounds source traversal without deep-cloning a large selected subtree", async () => {
    const target = document.body.appendChild(document.createElement("main"));
    for (let index = 0; index < 1_000; index += 1) {
      const child = target.appendChild(document.createElement("div"));
      child.textContent = `row-${index}`;
    }
    Object.defineProperty(target, "cloneNode", {
      configurable: true,
      value: () => {
        throw new Error("unbounded cloneNode must not run");
      },
    });
    const resultPromise = startElementInspection(target);

    document.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const result = (await resultPromise) as { element: { dom: string } };
    const parsed = new DOMParser().parseFromString(
      result.element.dom,
      "text/html",
    );

    expect(parsed.querySelectorAll("main *").length).toBeLessThan(200);
    expect(result.element.dom).toContain("row-0");
    expect(result.element.dom).not.toContain("row-999");
  });

  it("coalesces hover hit-testing to one animation frame", async () => {
    const target = document.body.appendChild(document.createElement("button"));
    const elementFromPoint = vi.fn(() => target);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(10, 20, 200, 100),
    });
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const resultPromise = window.eval(
      createDesktopBrowserInspectionControllerSource({
        requestId: "raf-test",
        kind: "element",
      }),
    ) as Promise<unknown>;

    for (const clientX of [20, 30, 40]) {
      document.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX,
          clientY: 30,
        }),
      );
    }
    expect(elementFromPoint).not.toHaveBeenCalled();
    expect(frame).not.toBeNull();
    frame!(0);
    expect(elementFromPoint).toHaveBeenCalledTimes(1);
    expect(elementFromPoint).toHaveBeenCalledWith(40, 30);

    await window.eval(createDesktopBrowserInspectionCancelSource("raf-test"));
    await expect(resultPromise).resolves.toBeNull();
  });

  it("cancels idempotently and settles null", async () => {
    const target = document.body.appendChild(document.createElement("button"));
    const resultPromise = startElementInspection(target);
    const cancelSource =
      createDesktopBrowserInspectionCancelSource("redaction-test");

    await window.eval(cancelSource);
    await window.eval(cancelSource);

    await expect(resultPromise).resolves.toBeNull();
    expect(
      document.querySelector("[data-bb-page-inspection-overlay]"),
    ).toBeNull();
  });

  it("restores the page's existing root cursor after selection", async () => {
    document.documentElement.style.setProperty("cursor", "wait", "important");
    const target = document.body.appendChild(document.createElement("button"));
    const resultPromise = startElementInspection(target);

    expect(document.documentElement.style.getPropertyValue("cursor")).toBe(
      "crosshair",
    );
    await window.eval(
      createDesktopBrowserInspectionCancelSource("redaction-test"),
    );
    await expect(resultPromise).resolves.toBeNull();
    expect(document.documentElement.style.getPropertyValue("cursor")).toBe(
      "wait",
    );
    expect(document.documentElement.style.getPropertyPriority("cursor")).toBe(
      "important",
    );
  });

  it("replaces a poisoned page registry without trusting its cancel member", async () => {
    Object.defineProperty(window, "__bbExperimentalPageInspectionV1", {
      configurable: true,
      writable: true,
      value: { requestId: "hostile", cancel: "not-a-function" },
    });
    const target = document.body.appendChild(document.createElement("button"));
    const resultPromise = startElementInspection(target);

    await window.eval(
      createDesktopBrowserInspectionCancelSource("redaction-test"),
    );
    await expect(resultPromise).resolves.toBeNull();
    expect(
      document.querySelector("[data-bb-page-inspection-overlay]"),
    ).toBeNull();
    delete (
      window as Window & {
        __bbExperimentalPageInspectionV1?: unknown;
      }
    ).__bbExperimentalPageInspectionV1;
  });
});
