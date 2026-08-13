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

describe("desktop Browser page controller", () => {
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
});
