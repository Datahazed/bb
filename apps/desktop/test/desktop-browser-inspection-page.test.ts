// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopBrowserInspectionCancelSource,
  createDesktopBrowserInspectionControllerSource,
} from "../src/desktop-browser-inspection.js";

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty("cursor");
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

  it("redacts form state, editable content, srcdoc, and sensitive data attributes", async () => {
    document.body.innerHTML = `
      <form id="account" data-token="top-secret" data-safe="kept">
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
      /password-secret|text-secret|hidden-secret|textarea-secret|attribute-secret|editable-secret|frame-secret|top-secret/u,
    );
    expect(result.element.dom).not.toMatch(
      /\s(value|checked|selected|srcdoc|data-token)=/u,
    );
    expect(result.element.text).not.toMatch(/textarea-secret|editable-secret/u);

    await window.eval(
      createDesktopBrowserInspectionCancelSource("redaction-test"),
    );
    expect(
      document.querySelector("[data-bb-page-inspection-overlay]"),
    ).toBeNull();
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
