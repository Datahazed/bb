import {
  BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_BYTES,
  bbDesktopBrowserInspectionPageResultSchema,
  bbDesktopBrowserInspectionResultSchema,
  type BbDesktopBrowserInspectionPageResult,
  type BbDesktopBrowserInspectionRequest,
  type BbDesktopBrowserInspectionResult,
} from "@bb/desktop-contract";

const INSPECTION_DEADLINE_MS = 60_000;
interface PageControllerInput {
  requestId: string;
  kind: "element" | "region" | "auto";
}

interface PageControllerRegistry {
  requestId: string;
  cancel(): void;
}

/**
 * Runs in the inspected page's main world. Keep every dependency nested: its
 * source is bundled below and Electron executes only that static controller.
 */
function desktopBrowserInspectionPageController(
  input: PageControllerInput,
): Promise<unknown> {
  const registryKey = "__bbExperimentalPageInspectionV1";
  const rootWindow = window as typeof window & {
    [registryKey]?: PageControllerRegistry;
  };
  const MAX_SELECTOR = 2_048;
  const MAX_DOM = 16_384;
  const MAX_TEXT = 2_000;
  const MAX_TREE_NODES = 200;
  const MAX_TREE_DEPTH = 6;
  const OVERLAY_ATTRIBUTE = "data-bb-page-inspection-overlay";

  const cap = (value: string, max: number): string =>
    value.length > max ? value.slice(0, max) : value;
  const normalizedText = (value: string, max: number): string =>
    cap(value.replace(/\s+/gu, " ").trim(), max);
  const rectValue = (
    rect: DOMRect,
  ): { x: number; y: number; width: number; height: number } => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  const pageValue = () => ({
    url: cap(location.href, 4_096),
    title: document.title.length > 0 ? cap(document.title, 1_024) : null,
    viewport: {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    },
    scroll: { x: window.scrollX, y: window.scrollY },
  });
  const escapeCss = (value: string): string => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(
      /[^a-zA-Z0-9_-]/gu,
      (character) => `\\${character.codePointAt(0)?.toString(16) ?? "0"} `,
    );
  };
  const selectorFor = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      let part = current.localName.toLowerCase();
      if (current.id.length > 0) {
        part += `#${escapeCss(cap(current.id, 256))}`;
        parts.unshift(part);
        break;
      }
      const classes = [...current.classList]
        .filter((name) => name.length > 0)
        .slice(0, 3)
        .map((name) => `.${escapeCss(cap(name, 128))}`)
        .join("");
      part += classes;
      if (current.parentElement !== null) {
        const siblings = [...current.parentElement.children].filter(
          (candidate) => candidate.localName === current?.localName,
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      if (parts.join(" > ").length >= MAX_SELECTOR) break;
      current = current.parentElement;
    }
    return cap(parts.join(" > "), MAX_SELECTOR);
  };
  const SECRET_ATTRIBUTE_NAMES = new Set([
    "action",
    "checked",
    "formaction",
    "href",
    "poster",
    "selected",
    "src",
    "srcdoc",
    "srcset",
    "style",
    "value",
    "xlink:href",
  ]);
  const shouldRedactAttribute = (name: string): boolean => {
    const lower = name.toLowerCase();
    return (
      SECRET_ATTRIBUTE_NAMES.has(lower) ||
      (lower.startsWith("data-") &&
        /(auth|credential|key|password|secret|session|token)/u.test(lower))
    );
  };
  const isEffectivelyEditable = (element: Element): boolean => {
    if ((document.designMode ?? "off").toLowerCase() === "on") return true;
    let current: Element | null = element;
    while (current !== null) {
      const value = current.getAttribute("contenteditable");
      if (value !== null) {
        const normalized = value.trim().toLowerCase();
        if (normalized === "false") return false;
        if (
          normalized === "" ||
          normalized === "true" ||
          normalized === "plaintext-only"
        ) {
          return true;
        }
      }
      current = current.parentElement;
    }
    return element instanceof HTMLElement && element.isContentEditable === true;
  };
  interface SanitizedTreeBudget {
    characters: number;
    nodes: number;
  }
  const sanitizedCopy = (
    source: Element,
    depth: number,
    budget: SanitizedTreeBudget,
  ): Element => {
    budget.nodes += 1;
    const copy = document.createElementNS(
      source.namespaceURI,
      source.localName,
    );
    for (const attribute of [...source.attributes]) {
      if (shouldRedactAttribute(attribute.name)) continue;
      const remaining = MAX_DOM - budget.characters;
      if (remaining <= 0) break;
      const value = cap(attribute.value, remaining);
      try {
        copy.setAttribute(attribute.name, value);
        budget.characters += value.length;
      } catch {
        // A page can expose unusual namespace attributes. Omit attributes that
        // cannot be represented safely in the sanitized copy.
      }
    }

    const tag = source.localName.toLowerCase();
    const inputType =
      tag === "input"
        ? (source.getAttribute("type") ?? "text").toLowerCase()
        : "";
    if (
      tag === "textarea" ||
      isEffectivelyEditable(source) ||
      (tag === "input" && (inputType === "password" || inputType === "hidden"))
    ) {
      return copy;
    }
    if (depth >= MAX_TREE_DEPTH) return copy;

    for (const child of [...source.childNodes]) {
      if (budget.nodes >= MAX_TREE_NODES) break;
      if (child instanceof Element) {
        copy.append(sanitizedCopy(child, depth + 1, budget));
        continue;
      }
      if (child.nodeType !== Node.TEXT_NODE) continue;
      budget.nodes += 1;
      const remaining = MAX_DOM - budget.characters;
      if (remaining <= 0) break;
      const text = cap(child.textContent ?? "", remaining);
      budget.characters += text.length;
      copy.append(document.createTextNode(text));
    }
    return copy;
  };
  const sanitizedClone = (element: Element): Element => {
    return sanitizedCopy(element, 0, { characters: 0, nodes: 0 });
  };
  const descriptorFromClone = (element: Element, clone: Element) => {
    return {
      selector: selectorFor(element),
      tag: cap(element.localName.toLowerCase(), 64),
      id: element.id.length > 0 ? cap(element.id, 256) : null,
      classNames: [...element.classList]
        .slice(0, 12)
        .map((name) => cap(name, 256)),
      text: normalizedText(clone.textContent ?? "", 240),
      rect: rectValue(element.getBoundingClientRect()),
    };
  };
  const descriptor = (element: Element) =>
    descriptorFromClone(element, sanitizedClone(element));
  const reactStack = (element: Element): string[] | null => {
    try {
      const keyed = element as Element & Record<string, unknown>;
      const fiberKey = Object.getOwnPropertyNames(element).find(
        (name) =>
          name.startsWith("__reactFiber$") ||
          name.startsWith("__reactInternalInstance$"),
      );
      if (fiberKey === undefined) return null;
      const frames: string[] = [];
      let fiber = keyed[fiberKey] as Record<string, unknown> | null;
      for (
        let index = 0;
        fiber !== null && index < 40 && frames.length < 20;
        index += 1
      ) {
        const candidate = fiber.elementType ?? fiber.type;
        let name: unknown = null;
        if (typeof candidate === "string") name = candidate;
        if (typeof candidate === "function") {
          name =
            (candidate as Function & { displayName?: string }).displayName ??
            candidate.name;
        }
        if (typeof candidate === "object" && candidate !== null) {
          const nested = candidate as Record<string, unknown>;
          name = nested.displayName ?? nested.name;
          const nestedType = nested.type;
          if (name == null && typeof nestedType === "function") {
            name =
              (nestedType as Function & { displayName?: string }).displayName ??
              nestedType.name;
          }
        }
        if (typeof name === "string" && name.length > 0)
          frames.push(cap(name, 256));
        fiber =
          (fiber.return as Record<string, unknown> | null | undefined) ?? null;
      }
      return frames.length > 0 ? frames : null;
    } catch {
      return null;
    }
  };
  const accessibility = (element: Element) => {
    const attributes: Record<string, string> = {};
    for (const name of [
      "aria-label",
      "aria-labelledby",
      "aria-describedby",
      "aria-expanded",
      "aria-pressed",
      "aria-checked",
      "aria-current",
      "aria-hidden",
    ]) {
      const value = element.getAttribute(name);
      if (value !== null)
        attributes[name] = cap(
          value,
          name.startsWith("aria-l") || name === "aria-describedby" ? 512 : 64,
        );
    }
    const implicitRoles: Record<string, string> = {
      a: "link",
      button: "button",
      img: "img",
      input: "textbox",
      nav: "navigation",
      select: "combobox",
      textarea: "textbox",
    };
    const roleHint =
      element.getAttribute("role") ??
      implicitRoles[element.localName.toLowerCase()] ??
      null;
    let nameHint =
      element.getAttribute("aria-label") ??
      element.getAttribute("alt") ??
      element.getAttribute("title");
    if (nameHint === null && element instanceof HTMLInputElement) {
      nameHint = element.labels?.[0]?.textContent ?? null;
    }
    if (nameHint === null && element.getAttribute("aria-labelledby")) {
      const ids = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/u)
        .slice(0, 4);
      nameHint = ids
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    }
    return {
      source: "dom-hint" as const,
      roleHint: roleHint === null ? null : cap(roleHint, 256),
      nameHint: nameHint === null ? null : normalizedText(nameHint, 512),
      attributes,
    };
  };
  const elementValue = (element: Element) => {
    const clone = sanitizedClone(element);
    const computed = getComputedStyle(element);
    const styles: Record<string, string> = {};
    for (const name of [
      "display",
      "position",
      "color",
      "backgroundColor",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "margin",
      "padding",
      "border",
      "borderRadius",
      "boxShadow",
      "opacity",
      "overflow",
      "zIndex",
      "flex",
      "grid",
      "transform",
    ]) {
      const value = computed[name as keyof CSSStyleDeclaration];
      if (typeof value === "string" && value.length > 0)
        styles[name] = cap(value, 512);
    }
    return {
      ...descriptorFromClone(element, clone),
      dom: cap(clone.outerHTML, MAX_DOM),
      text: normalizedText(clone.textContent ?? "", MAX_TEXT),
      styles,
      accessibility: accessibility(element),
      reactComponentStack: reactStack(element),
    };
  };
  const regionElements = (rect: DOMRect): ReturnType<typeof descriptor>[] => {
    const found = new Set<Element>();
    const columns = 5;
    const rows = 4;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = rect.x + ((column + 0.5) * rect.width) / columns;
        const y = rect.y + ((row + 0.5) * rect.height) / rows;
        for (const element of document.elementsFromPoint(x, y)) {
          if (!element.hasAttribute(OVERLAY_ATTRIBUTE)) found.add(element);
          if (found.size >= 20) break;
        }
        if (found.size >= 20) break;
      }
      if (found.size >= 20) break;
    }
    return [...found]
      .filter((element) => {
        const candidate = element.getBoundingClientRect();
        return (
          candidate.right > rect.left &&
          candidate.left < rect.right &&
          candidate.bottom > rect.top &&
          candidate.top < rect.bottom
        );
      })
      .slice(0, 20)
      .map(descriptor);
  };

  const previousController = rootWindow[registryKey];
  if (typeof previousController?.cancel === "function") {
    try {
      previousController.cancel();
    } catch {
      // Page globals are untrusted. A poisoned prior registry must not prevent
      // installing a fresh controller whose own cleanup remains idempotent.
    }
  }
  const root = document.createElement("div");
  root.setAttribute(OVERLAY_ATTRIBUTE, "true");
  root.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const outline = document.createElement("div");
  outline.setAttribute(OVERLAY_ATTRIBUTE, "true");
  outline.style.cssText =
    "display:none;position:fixed;box-sizing:border-box;border:2px solid #2563eb;background:rgba(37,99,235,.10);pointer-events:none";
  const label = document.createElement("div");
  label.setAttribute(OVERLAY_ATTRIBUTE, "true");
  label.style.cssText =
    "display:none;position:fixed;max-width:320px;padding:3px 6px;border-radius:4px;background:#1d4ed8;color:white;font:12px/16px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none";
  root.append(outline, label);
  document.documentElement.append(root);

  return new Promise((resolve) => {
    let settled = false;
    let dragging = false;
    let dragStart: { x: number; y: number } | null = null;
    let animationFrameId: number | null = null;
    let pendingPointerMove: { x: number; y: number } | null = null;
    let handlePointerMove: ((x: number, y: number) => void) | null = null;
    const listeners: Array<[EventTarget, string, EventListener]> = [];
    const previousCursor =
      document.documentElement.style.getPropertyValue("cursor");
    const previousCursorPriority =
      document.documentElement.style.getPropertyPriority("cursor");
    const listen = (
      target: EventTarget,
      name: string,
      listener: EventListener,
    ): void => {
      target.addEventListener(name, listener, { capture: true });
      listeners.push([target, name, listener]);
    };
    const stopInteractions = (): void => {
      for (const [target, name, listener] of listeners.splice(0)) {
        target.removeEventListener(name, listener, { capture: true });
      }
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        pendingPointerMove = null;
      }
      if (previousCursor.length === 0) {
        document.documentElement.style.removeProperty("cursor");
      } else {
        document.documentElement.style.setProperty(
          "cursor",
          previousCursor,
          previousCursorPriority,
        );
      }
    };
    const cancel = (): void => {
      stopInteractions();
      root.remove();
      if (rootWindow[registryKey]?.requestId === input.requestId) {
        delete rootWindow[registryKey];
      }
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };
    rootWindow[registryKey] = { requestId: input.requestId, cancel };
    const settle = (value: unknown): void => {
      if (settled) return;
      settled = true;
      stopInteractions();
      resolve(value);
    };
    const draw = (
      rect: { x: number; y: number; width: number; height: number },
      text: string,
    ): void => {
      outline.style.display = "block";
      outline.style.left = `${rect.x}px`;
      outline.style.top = `${rect.y}px`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;
      label.style.display = "block";
      label.style.left = `${Math.max(0, Math.min(rect.x, window.innerWidth - 320))}px`;
      label.style.top = `${Math.max(0, rect.y - 24)}px`;
      label.textContent = text;
    };
    const schedulePointerMove = (event: PointerEvent): void => {
      pendingPointerMove = { x: event.clientX, y: event.clientY };
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        const point = pendingPointerMove;
        pendingPointerMove = null;
        if (point !== null) handlePointerMove?.(point.x, point.y);
      });
    };
    listen(window, "keydown", ((event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    }) as EventListener);
    listen(document, "visibilitychange", (() => {
      if (document.visibilityState !== "visible") cancel();
    }) as EventListener);

    if (input.kind === "element") {
      document.documentElement.style.setProperty(
        "cursor",
        "crosshair",
        "important",
      );
      handlePointerMove = (x, y) => {
        const target = document.elementFromPoint(x, y);
        if (target === null || target.hasAttribute(OVERLAY_ATTRIBUTE)) return;
        const rect = target.getBoundingClientRect();
        draw(
          rectValue(rect),
          `${target.localName}${target.id ? `#${target.id}` : ""}`,
        );
      };
      listen(document, "pointermove", schedulePointerMove as EventListener);
      listen(document, "click", ((event: MouseEvent) => {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target === null || target.hasAttribute(OVERLAY_ATTRIBUTE)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = target.getBoundingClientRect();
        draw(rectValue(rect), selectorFor(target));
        settle({
          version: 1,
          kind: "element",
          page: pageValue(),
          rect: rectValue(rect),
          deviceScaleFactor: window.devicePixelRatio,
          element: elementValue(target),
          region: null,
        });
      }) as EventListener);
      return;
    }

    document.documentElement.style.setProperty(
      "cursor",
      "crosshair",
      "important",
    );
    listen(document, "pointerdown", ((event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragging = true;
      dragStart = { x: event.clientX, y: event.clientY };
    }) as EventListener);
    handlePointerMove = (x, y) => {
      if (input.kind === "auto" && (!dragging || dragStart === null)) {
        const target = document.elementFromPoint(x, y);
        if (target === null || target.hasAttribute(OVERLAY_ATTRIBUTE)) return;
        const rect = target.getBoundingClientRect();
        draw(
          rectValue(rect),
          `${target.localName}${target.id ? `#${target.id}` : ""}`,
        );
        return;
      }
      if (!dragging || dragStart === null) return;
      const left = Math.max(0, Math.min(dragStart.x, x));
      const top = Math.max(0, Math.min(dragStart.y, y));
      const right = Math.min(window.innerWidth, Math.max(dragStart.x, x));
      const bottom = Math.min(window.innerHeight, Math.max(dragStart.y, y));
      draw(
        { x: left, y: top, width: right - left, height: bottom - top },
        "Marked region",
      );
    };
    listen(document, "pointermove", schedulePointerMove as EventListener);
    listen(document, "pointerup", ((event: PointerEvent) => {
      if (!dragging || dragStart === null || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragging = false;
      const left = Math.max(0, Math.min(dragStart.x, event.clientX));
      const top = Math.max(0, Math.min(dragStart.y, event.clientY));
      const right = Math.min(
        window.innerWidth,
        Math.max(dragStart.x, event.clientX),
      );
      const bottom = Math.min(
        window.innerHeight,
        Math.max(dragStart.y, event.clientY),
      );
      const rect = new DOMRect(left, top, right - left, bottom - top);
      dragStart = null;
      if (rect.width < 8 || rect.height < 8) {
        if (input.kind !== "auto") {
          outline.style.display = "none";
          label.style.display = "none";
          return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target === null || target.hasAttribute(OVERLAY_ATTRIBUTE)) return;
        const targetRect = target.getBoundingClientRect();
        draw(rectValue(targetRect), selectorFor(target));
        settle({
          version: 1,
          kind: "element",
          page: pageValue(),
          rect: rectValue(targetRect),
          deviceScaleFactor: window.devicePixelRatio,
          element: elementValue(target),
          region: null,
        });
        return;
      }
      draw(rectValue(rect), "Marked region");
      settle({
        version: 1,
        kind: "region",
        page: pageValue(),
        rect: rectValue(rect),
        deviceScaleFactor: window.devicePixelRatio,
        element: null,
        region: { elements: regionElements(rect) },
      });
    }) as EventListener);
  });
}

function desktopBrowserInspectionPageCancel(requestId: string): void {
  const registryKey = "__bbExperimentalPageInspectionV1";
  const rootWindow = window as typeof window & {
    [registryKey]?: PageControllerRegistry;
  };
  const controller = rootWindow[registryKey];
  if (
    controller?.requestId === requestId &&
    typeof controller.cancel === "function"
  ) {
    try {
      controller.cancel();
    } catch {
      // Page globals are untrusted; cancellation is best effort.
    }
  }
}

const PAGE_CONTROLLER_SOURCE =
  desktopBrowserInspectionPageController.toString();
const PAGE_CANCEL_SOURCE = desktopBrowserInspectionPageCancel.toString();

export function createDesktopBrowserInspectionControllerSource(
  input: PageControllerInput,
): string {
  return `(${PAGE_CONTROLLER_SOURCE})(${JSON.stringify(input)})`;
}

export function createDesktopBrowserInspectionCancelSource(
  requestId: string,
): string {
  return `(${PAGE_CANCEL_SOURCE})(${JSON.stringify(requestId)})`;
}

interface DesktopBrowserInspectionImage {
  getSize(): { width: number; height: number };
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface DesktopBrowserInspectionWebContents {
  capturePage(): Promise<DesktopBrowserInspectionImage>;
  executeJavaScript(source: string): Promise<unknown>;
  getURL(): string;
  getZoomFactor(): number;
  isDestroyed(): boolean;
  on(event: "did-start-navigation" | "destroyed", listener: () => void): void;
  removeListener(
    event: "did-start-navigation" | "destroyed",
    listener: () => void,
  ): void;
}

interface StartDesktopBrowserInspectionArgs {
  request: BbDesktopBrowserInspectionRequest;
  webContents: DesktopBrowserInspectionWebContents;
  deadlineMs?: number;
}

export interface DesktopBrowserInspectionSession {
  requestId: string;
  promise: Promise<BbDesktopBrowserInspectionResult | null>;
  cancel(): void;
}

function pngDataUrl(image: DesktopBrowserInspectionImage): string {
  const png = image.toPNG();
  if (png.byteLength > BB_DESKTOP_BROWSER_INSPECTION_MAX_PNG_BYTES) {
    throw new Error("The captured page image is too large");
  }
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function startDesktopBrowserInspection(
  args: StartDesktopBrowserInspectionArgs,
): DesktopBrowserInspectionSession {
  const requestId = args.request.requestId;
  const initialUrl = args.webContents.getURL();
  let cancelResolve: ((value: null) => void) | null = null;
  let disposed = false;
  const cancellation = new Promise<null>((resolve) => {
    cancelResolve = resolve;
  });

  const cancelPage = (): void => {
    if (args.webContents.isDestroyed()) return;
    void args.webContents
      .executeJavaScript(createDesktopBrowserInspectionCancelSource(requestId))
      .catch(() => undefined);
  };
  const cancel = (): void => {
    if (disposed) return;
    disposed = true;
    cancelPage();
    cancelResolve?.(null);
  };
  const cancelOnNavigation = (): void => cancel();
  const cancelOnDestroyed = (): void => cancel();
  args.webContents.on("did-start-navigation", cancelOnNavigation);
  args.webContents.on("destroyed", cancelOnDestroyed);
  const deadline = setTimeout(
    cancel,
    args.deadlineMs ?? INSPECTION_DEADLINE_MS,
  );

  const capture =
    async (): Promise<BbDesktopBrowserInspectionResult | null> => {
      const raw: unknown = await args.webContents.executeJavaScript(
        createDesktopBrowserInspectionControllerSource({
          requestId,
          kind: args.request.kind,
        }),
      );
      if (raw === null || disposed) return null;
      const pageResult: BbDesktopBrowserInspectionPageResult =
        bbDesktopBrowserInspectionPageResultSchema.parse(raw);
      if (
        (args.request.kind !== "auto" &&
          pageResult.kind !== args.request.kind) ||
        args.webContents.getURL() !== initialUrl
      ) {
        return null;
      }
      const image = await args.webContents.capturePage();
      if (
        disposed ||
        args.webContents.getURL() !== initialUrl ||
        image.isEmpty()
      )
        return null;
      const pixelSize = image.getSize();
      const viewport = pageResult.page.viewport;
      if (
        viewport.width <= 0 ||
        viewport.height <= 0 ||
        pixelSize.width <= 0 ||
        pixelSize.height <= 0
      ) {
        throw new Error("The inspected page has no visible viewport");
      }
      const { deviceScaleFactor, ...captureData } = pageResult;
      return bbDesktopBrowserInspectionResultSchema.parse({
        ...captureData,
        screenshot: {
          dataUrl: pngDataUrl(image),
          pixelSize,
          deviceScaleFactor,
          pageZoom: args.webContents.getZoomFactor(),
          cssToImageScale: {
            x: pixelSize.width / viewport.width,
            y: pixelSize.height / viewport.height,
          },
        },
      });
    };

  const promise = Promise.race([capture(), cancellation]).finally(() => {
    clearTimeout(deadline);
    args.webContents.removeListener("did-start-navigation", cancelOnNavigation);
    args.webContents.removeListener("destroyed", cancelOnDestroyed);
    disposed = true;
    cancelPage();
  });
  return { requestId, promise, cancel };
}
