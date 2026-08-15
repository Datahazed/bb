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
  const MAX_REGION_TARGETS = 64;
  const MAX_REGION_GROUPS = 24;
  const MAX_REGION_STRUCTURED_BYTES = 100_000;
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
  const pruneClone = (
    element: Element,
    depth: number,
    budget: { count: number },
  ): void => {
    budget.count += 1;
    const attributeNames = element.getAttributeNames();
    for (const name of attributeNames) {
      const lower = name.toLowerCase();
      if (
        lower === "value" ||
        lower === "checked" ||
        lower === "selected" ||
        lower === "srcdoc" ||
        (lower.startsWith("data-") &&
          /(auth|credential|key|password|secret|session|token)/u.test(lower))
      ) {
        element.removeAttribute(name);
      }
    }
    const tag = element.localName.toLowerCase();
    const inputType =
      tag === "input"
        ? (element.getAttribute("type") ?? "text").toLowerCase()
        : "";
    const editable =
      element.hasAttribute("contenteditable") &&
      element.getAttribute("contenteditable")?.toLowerCase() !== "false";
    if (
      tag === "textarea" ||
      editable ||
      (tag === "input" && (inputType === "password" || inputType === "hidden"))
    ) {
      element.replaceChildren();
    }
    if (depth >= MAX_TREE_DEPTH) {
      element.replaceChildren();
      return;
    }
    for (const child of [...element.children]) {
      if (budget.count >= MAX_TREE_NODES) {
        child.remove();
        continue;
      }
      pruneClone(child, depth + 1, budget);
    }
  };
  const sanitizedClone = (element: Element): Element => {
    const clone = element.cloneNode(true) as Element;
    pruneClone(clone, 0, { count: 0 });
    for (const control of clone.querySelectorAll("input, textarea")) {
      control.removeAttribute("value");
      if (control.localName === "textarea") control.replaceChildren();
    }
    for (const option of clone.querySelectorAll("option")) {
      option.removeAttribute("selected");
    }
    for (const editable of clone.querySelectorAll(
      "[contenteditable]:not([contenteditable='false'])",
    )) {
      editable.replaceChildren();
    }
    return clone;
  };
  const descriptor = (element: Element) => {
    const clone = sanitizedClone(element);
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
  const reactHint = (element: Element) => {
    try {
      const keyed = element as Element & Record<string, unknown>;
      const fiberKey = Object.getOwnPropertyNames(element).find(
        (name) =>
          name.startsWith("__reactFiber$") ||
          name.startsWith("__reactInternalInstance$"),
      );
      if (fiberKey === undefined) return null;
      const frames: string[] = [];
      let source: {
        fileName: string;
        lineNumber: number;
        columnNumber: number | null;
      } | null = null;
      let fiber = keyed[fiberKey] as Record<string, unknown> | null;
      for (
        let index = 0;
        fiber !== null && index < 40 && frames.length < 20;
        index += 1
      ) {
        if (index === 0) {
          const rawSource = fiber._debugSource;
          if (typeof rawSource === "object" && rawSource !== null) {
            const candidate = rawSource as Record<string, unknown>;
            if (
              typeof candidate.fileName === "string" &&
              candidate.fileName.length > 0 &&
              typeof candidate.lineNumber === "number" &&
              Number.isInteger(candidate.lineNumber) &&
              candidate.lineNumber > 0
            ) {
              source = {
                fileName: cap(candidate.fileName, 1_024),
                lineNumber: Math.min(candidate.lineNumber, 10_000_000),
                columnNumber:
                  typeof candidate.columnNumber === "number" &&
                  Number.isInteger(candidate.columnNumber) &&
                  candidate.columnNumber > 0
                    ? Math.min(candidate.columnNumber, 10_000_000)
                    : null,
              };
            }
          }
        }
        const candidate = fiber.elementType ?? fiber.type;
        let name: unknown = null;
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
        if (typeof name === "string" && name.length > 0) {
          frames.push(cap(name, 256));
        }
        fiber =
          (fiber.return as Record<string, unknown> | null | undefined) ?? null;
      }
      return frames.length > 0 || source !== null
        ? {
            componentStack: frames,
            ...(source === null ? {} : { source }),
          }
        : null;
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
    const tag = element.localName.toLowerCase();
    let implicitRole: string | null = null;
    if (tag === "a" && element.hasAttribute("href")) implicitRole = "link";
    if (tag === "button") implicitRole = "button";
    if (tag === "img") implicitRole = "img";
    if (tag === "nav") implicitRole = "navigation";
    if (tag === "select") implicitRole = "combobox";
    if (tag === "textarea") implicitRole = "textbox";
    if (element instanceof HTMLInputElement) {
      const inputRoles: Record<string, string | null> = {
        button: "button",
        checkbox: "checkbox",
        email: "textbox",
        hidden: null,
        image: "button",
        number: "spinbutton",
        password: null,
        radio: "radio",
        range: "slider",
        reset: "button",
        search: "searchbox",
        submit: "button",
        tel: "textbox",
        text: "textbox",
        url: "textbox",
      };
      implicitRole = inputRoles[element.type.toLowerCase()] ?? "textbox";
    }
    const roleHint = element.getAttribute("role") ?? implicitRole;
    let nameHint = element.getAttribute("aria-label");
    if (nameHint === null && element.getAttribute("aria-labelledby")) {
      const ids = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/u)
        .slice(0, 4);
      const root = element.getRootNode();
      nameHint = ids
        .map((id) =>
          root instanceof Document || root instanceof ShadowRoot
            ? (root.getElementById(id)?.textContent ?? "")
            : "",
        )
        .join(" ");
    }
    nameHint ??=
      element.getAttribute("alt") ?? element.getAttribute("title") ?? null;
    if (nameHint === null && element instanceof HTMLInputElement) {
      nameHint = element.labels?.[0]?.textContent ?? null;
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
      ...descriptor(element),
      dom: cap(clone.outerHTML, MAX_DOM),
      text: normalizedText(clone.textContent ?? "", MAX_TEXT),
      styles,
      accessibility: accessibility(element),
      reactComponentStack: reactStack(element),
    };
  };
  type LocatorScope = Document | ShadowRoot | Element;
  type InspectionLocator = { selectors: string[] };
  type RegionTarget = {
    absoluteLocator: InspectionLocator;
    relativeLocator: InspectionLocator;
    text: string;
    rect: ReturnType<typeof rectValue>;
    accessibility?: ReturnType<typeof accessibility>;
    react?: NonNullable<ReturnType<typeof reactHint>>;
  };
  type RegionGroup = {
    absoluteLocator: InspectionLocator;
    relativeLocator: InspectionLocator;
    count: number;
    rect: ReturnType<typeof rectValue>;
  };

  const cssString = (value: string): string =>
    `"${value
      .replace(/\\/gu, "\\\\")
      .replace(/"/gu, '\\"')
      .replace(
        /[\n\r\f]/gu,
        (character) => `\\${character.codePointAt(0)?.toString(16) ?? "a"} `,
      )}"`;
  const queryAll = (scope: LocatorScope, selector: string): Element[] => {
    if (scope instanceof Element && selector === ":scope") return [scope];
    try {
      return [...scope.querySelectorAll(selector)];
    } catch {
      return [];
    }
  };
  const uniqueIn = (
    element: Element,
    scope: LocatorScope,
    selector: string,
  ): boolean => {
    if (selector.length > MAX_SELECTOR) return false;
    const matches = queryAll(scope, selector);
    return matches.length === 1 && matches[0] === element;
  };
  const selectorPart = (element: Element): string => {
    let part = element.localName.toLowerCase();
    part += [...element.classList]
      .filter((name) => name.length > 0 && name.length <= 128)
      .slice(0, 3)
      .map((name) => `.${escapeCss(name)}`)
      .join("");
    const parent = element.parentElement;
    if (parent !== null) {
      const sameTag = [...parent.children].filter(
        (candidate) => candidate.localName === element.localName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(element) + 1})`;
      }
    } else {
      const root = element.getRootNode();
      if (root instanceof ShadowRoot) {
        const sameTag = [...root.children].filter(
          (candidate) => candidate.localName === element.localName,
        );
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(element) + 1})`;
        }
      }
    }
    return part;
  };
  const uniqueSelectorIn = (
    element: Element,
    scope: LocatorScope,
  ): string | null => {
    if (scope instanceof Element && element === scope) return ":scope";
    const tag = element.localName.toLowerCase();
    if (element.id.length > 0) {
      const byId = `${tag}#${escapeCss(cap(element.id, 256))}`;
      if (uniqueIn(element, scope, byId)) return byId;
    }
    for (const name of ["data-testid", "data-test", "data-cy", "name"]) {
      const value = element.getAttribute(name);
      if (value === null || value.length === 0 || value.length > 256) continue;
      const byAttribute = `${tag}[${name}=${cssString(value)}]`;
      if (uniqueIn(element, scope, byAttribute)) return byAttribute;
    }
    const classes = [...element.classList]
      .filter((name) => name.length > 0 && name.length <= 128)
      .slice(0, 3);
    for (let count = 1; count <= classes.length; count += 1) {
      const byClass = `${tag}${classes
        .slice(0, count)
        .map((name) => `.${escapeCss(name)}`)
        .join("")}`;
      if (uniqueIn(element, scope, byClass)) return byClass;
    }
    const parts: string[] = [];
    let current: Element | null = element;
    while (current !== null && current !== scope) {
      parts.unshift(selectorPart(current));
      const selector = parts.join(" > ");
      if (uniqueIn(element, scope, selector)) return selector;
      current = current.parentElement;
    }
    return null;
  };
  const locatorFrom = (
    element: Element,
    scope: LocatorScope,
  ): InspectionLocator | null => {
    const selectors: string[] = [];
    let current = element;
    while (true) {
      const root = current.getRootNode();
      if (
        root === scope ||
        (scope instanceof Element &&
          root === scope.getRootNode() &&
          (current === scope || scope.contains(current)))
      ) {
        const selector = uniqueSelectorIn(current, scope);
        if (selector === null) return null;
        selectors.unshift(selector);
        return selectors.length <= 8 ? { selectors } : null;
      }
      if (!(root instanceof ShadowRoot)) return null;
      const selector = uniqueSelectorIn(current, root);
      if (selector === null) return null;
      selectors.unshift(selector);
      current = root.host;
    }
  };
  const locatorForElements = (
    elements: readonly Element[],
    scope: LocatorScope,
  ): InspectionLocator | null => {
    const first = elements[0];
    if (first === undefined) return null;
    const tag = first.localName.toLowerCase();
    if (elements.every((element) => element.localName === first.localName)) {
      const sharedClasses = [...first.classList]
        .filter(
          (name) =>
            name.length > 0 &&
            name.length <= 128 &&
            elements.every((element) => element.classList.contains(name)),
        )
        .slice(0, 3);
      const sharedSelectors = [tag];
      for (let count = 1; count <= sharedClasses.length; count += 1) {
        sharedSelectors.push(
          `${tag}${sharedClasses
            .slice(0, count)
            .map((name) => `.${escapeCss(name)}`)
            .join("")}`,
        );
      }
      for (const selector of sharedSelectors) {
        const matches = queryAll(scope, selector);
        if (
          matches.length === elements.length &&
          matches.every((element, index) => element === elements[index])
        ) {
          return { selectors: [selector] };
        }
      }
    }
    const locators = elements.map((element) => locatorFrom(element, scope));
    if (locators.some((locator) => locator === null)) return null;
    const resolved = locators as InspectionLocator[];
    const length = resolved[0]?.selectors.length ?? 0;
    if (
      length === 0 ||
      resolved.some((locator) => locator.selectors.length !== length)
    ) {
      return null;
    }
    const prefix = resolved[0].selectors.slice(0, -1);
    if (
      resolved.some((locator) =>
        locator.selectors
          .slice(0, -1)
          .some((selector, index) => selector !== prefix[index]),
      )
    ) {
      return null;
    }
    const finalSelector = resolved
      .map((locator) => locator.selectors.at(-1) ?? "")
      .join(", ");
    if (finalSelector.length > MAX_SELECTOR) return null;
    return { selectors: [...prefix, finalSelector] };
  };
  const composedParent = (element: Element): Element | null => {
    if (element.assignedSlot !== null) return element.assignedSlot;
    if (element.parentElement !== null) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const composedContains = (ancestor: Element, element: Element): boolean => {
    let current: Element | null = element;
    while (current !== null) {
      if (current === ancestor) return true;
      current = composedParent(current);
    }
    return false;
  };
  const lowestComposedElementAncestor = (
    elements: readonly Element[],
  ): Element | null => {
    const [first, ...rest] = elements;
    if (first === undefined) return null;
    const chain: Element[] = [];
    let current: Element | null = first;
    while (current !== null) {
      chain.push(current);
      current = composedParent(current);
    }
    return (
      chain.find((candidate) =>
        rest.every((element) => composedContains(candidate, element)),
      ) ?? null
    );
  };
  const lowestLocatableComposedElementAncestor = (
    elements: readonly Element[],
  ): Element | null => {
    let candidate = lowestComposedElementAncestor(elements);
    while (candidate !== null) {
      const scope = candidate;
      if (elements.every((element) => locatorFrom(element, scope) !== null)) {
        return scope;
      }
      candidate = composedParent(candidate);
    }
    return null;
  };
  type DomCommonAncestor = Element | ShadowRoot;
  const domParent = (node: DomCommonAncestor): DomCommonAncestor | null => {
    if (node instanceof ShadowRoot) return null;
    if (node.parentElement !== null) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root : null;
  };
  const domContains = (
    ancestor: DomCommonAncestor,
    element: Element,
  ): boolean => ancestor === element || ancestor.contains(element);
  const lowestDomCommonAncestor = (
    elements: readonly Element[],
  ): DomCommonAncestor | null => {
    const [first, ...rest] = elements;
    if (first === undefined) return null;
    const chain: DomCommonAncestor[] = [];
    let current: DomCommonAncestor | null = first;
    while (current !== null) {
      chain.push(current);
      current = domParent(current);
    }
    return (
      chain.find((candidate) =>
        rest.every((element) => domContains(candidate, element)),
      ) ?? null
    );
  };
  const intersects = (element: Element, selection: DOMRect): boolean => {
    const candidate = element.getBoundingClientRect();
    if (candidate.width <= 0 || candidate.height <= 0) return false;
    const computed = getComputedStyle(element);
    if (
      computed.display === "none" ||
      computed.visibility === "hidden" ||
      computed.visibility === "collapse"
    ) {
      return false;
    }
    return (
      candidate.right > selection.left &&
      candidate.left < selection.right &&
      candidate.bottom > selection.top &&
      candidate.top < selection.bottom
    );
  };
  const hasDirectText = (element: Element): boolean =>
    [...element.childNodes].some(
      (node) =>
        node.nodeType === Node.TEXT_NODE &&
        normalizedText(node.textContent ?? "", 1).length > 0,
    );
  const isMeaningful = (element: Element): boolean => {
    const tag = element.localName.toLowerCase();
    if (["script", "style", "template", "noscript"].includes(tag)) return false;
    if (
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "option",
        "label",
        "img",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "li",
        "dt",
        "dd",
        "td",
        "th",
        "summary",
      ].includes(tag)
    ) {
      return true;
    }
    if (
      element.hasAttribute("role") ||
      element.hasAttribute("aria-label") ||
      element.hasAttribute("data-testid") ||
      element.hasAttribute("data-test") ||
      element.hasAttribute("data-cy") ||
      element.hasAttribute("contenteditable") ||
      element.hasAttribute("tabindex")
    ) {
      return true;
    }
    return hasDirectText(element);
  };
  const semanticPriority = (element: Element): number => {
    const tag = element.localName.toLowerCase();
    const role = element.getAttribute("role")?.toLowerCase() ?? null;
    if (
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "option",
        "summary",
      ].includes(tag) ||
      [
        "button",
        "checkbox",
        "combobox",
        "gridcell",
        "link",
        "listbox",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "radio",
        "searchbox",
        "slider",
        "spinbutton",
        "switch",
        "tab",
        "textbox",
        "treeitem",
      ].includes(role ?? "") ||
      element.hasAttribute("contenteditable")
    ) {
      return 4;
    }
    if (
      [
        "label",
        "img",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "li",
        "dt",
        "dd",
        "td",
        "th",
      ].includes(tag)
    ) {
      return 3;
    }
    if (
      role !== null ||
      element.hasAttribute("aria-label") ||
      element.hasAttribute("data-testid") ||
      element.hasAttribute("data-test") ||
      element.hasAttribute("data-cy") ||
      element.hasAttribute("tabindex")
    ) {
      return 2;
    }
    return hasDirectText(element) ? 1 : 0;
  };
  const collectMeaningfulElements = (): {
    elements: Element[];
    order: Map<Element, number>;
  } => {
    const elements: Element[] = [];
    const order = new Map<Element, number>();
    const composedChildren = (
      root: Document | ShadowRoot | Element,
    ): Element[] => {
      if (root instanceof Element) {
        if (root.localName.toLowerCase() === "slot") {
          const assigned = (root as HTMLSlotElement).assignedElements({
            flatten: true,
          });
          if (assigned.length > 0) return assigned;
        }
        if (root.shadowRoot !== null) return [...root.shadowRoot.children];
      }
      return [...root.children];
    };
    const visited = new Set<Element>();
    const visit = (root: Document | ShadowRoot | Element): void => {
      for (const child of composedChildren(root)) {
        if (child.hasAttribute(OVERLAY_ATTRIBUTE)) continue;
        if (visited.has(child)) continue;
        visited.add(child);
        order.set(child, order.size);
        if (isMeaningful(child)) elements.push(child);
        visit(child);
      }
    };
    visit(document);
    return { elements, order };
  };
  const accessibilityHint = (
    element: Element,
  ): ReturnType<typeof accessibility> | null => {
    const hint = accessibility(element);
    return hint.roleHint !== null ||
      hint.nameHint !== null ||
      Object.keys(hint.attributes).length > 0
      ? hint
      : null;
  };
  const unionRect = (
    elements: readonly Element[],
  ): ReturnType<typeof rectValue> => {
    const rects = elements.map((element) => element.getBoundingClientRect());
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const structuralSignature = (element: Element, depth = 0): string => {
    const role = element.getAttribute("role");
    const head = `${element.localName.toLowerCase()}${role === null ? "" : `[role=${role}]`}`;
    if (depth >= 2) return head;
    const children = [...element.children]
      .filter((child) => !child.hasAttribute(OVERLAY_ATTRIBUTE))
      .slice(0, 12)
      .map((child) => structuralSignature(child, depth + 1));
    return `${head}(${children.join(",")})`;
  };
  const repeatedGroups = (
    targets: readonly Element[],
    commonAncestor: Element | ShadowRoot,
    order: ReadonlyMap<Element, number>,
  ): Element[][] => {
    const byParent = new Map<ParentNode, Map<string, Set<Element>>>();
    const signatures = new Map<Element, string>();
    const siblingIndexes = new Map<ParentNode, Map<string, Element[]>>();
    const signatureFor = (element: Element): string => {
      const existing = signatures.get(element);
      if (existing !== undefined) return existing;
      const signature = structuralSignature(element);
      signatures.set(element, signature);
      return signature;
    };
    const siblingIndexFor = (parent: ParentNode): Map<string, Element[]> => {
      const existing = siblingIndexes.get(parent);
      if (existing !== undefined) return existing;
      const index = new Map<string, Element[]>();
      for (const sibling of [...parent.children]) {
        const signature = signatureFor(sibling);
        const matches = index.get(signature) ?? [];
        matches.push(sibling);
        index.set(signature, matches);
      }
      siblingIndexes.set(parent, index);
      return index;
    };
    for (const target of targets) {
      let branch: Element | null = target;
      while (branch !== null && branch !== commonAncestor) {
        const root = branch.getRootNode();
        const parent: ParentNode | null =
          branch.parentElement ?? (root instanceof ShadowRoot ? root : null);
        if (parent !== null) {
          const signature = signatureFor(branch);
          const sameSignature = siblingIndexFor(parent).get(signature) ?? [];
          if (sameSignature.length >= 2) {
            const signatures =
              byParent.get(parent) ?? new Map<string, Set<Element>>();
            const selected = signatures.get(signature) ?? new Set<Element>();
            selected.add(branch);
            signatures.set(signature, selected);
            byParent.set(parent, signatures);
          }
        }
        if (parent === commonAncestor) break;
        branch = composedParent(branch);
      }
    }
    const candidates = [...byParent.values()]
      .flatMap((signatures) => [...signatures.values()])
      .map((selected) => [...selected])
      .filter((selected) => selected.length >= 2)
      .sort((left, right) => {
        return (
          (order.get(left[0]) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
        );
      });
    const groups: Element[][] = [];
    for (const candidate of candidates) {
      if (
        groups.some((kept) =>
          candidate.every((branch) =>
            kept.some((ancestor) => composedContains(ancestor, branch)),
          ),
        )
      ) {
        continue;
      }
      groups.push(candidate);
    }
    return groups;
  };
  const regionValue = (selection: DOMRect) => {
    const collected = collectMeaningfulElements();
    const intersecting = collected.elements.filter((element) =>
      intersects(element, selection),
    );
    const matched = new Set(intersecting);
    const suppressed = new Set<Element>();
    for (const element of intersecting) {
      let parent = composedParent(element);
      while (parent !== null) {
        if (matched.has(parent)) {
          const parentPriority = semanticPriority(parent);
          const elementPriority = semanticPriority(element);
          if (
            parentPriority > elementPriority ||
            (parentPriority >= 3 && parentPriority === elementPriority)
          ) {
            suppressed.add(element);
          } else {
            suppressed.add(parent);
          }
        }
        parent = composedParent(parent);
      }
    }
    const targetElements = intersecting.filter(
      (element) => !suppressed.has(element),
    );
    const domCommonAncestor = lowestDomCommonAncestor(targetElements);
    const composedCommonAncestor =
      domCommonAncestor === null
        ? lowestLocatableComposedElementAncestor(targetElements)
        : null;
    const commonAncestor = domCommonAncestor ?? composedCommonAncestor;
    if (commonAncestor === null) {
      return {
        commonAncestor: null,
        targets: [] as RegionTarget[],
        groups: [] as RegionGroup[],
        omittedTargetCount: 0,
        omittedGroupCount: 0,
      };
    }
    const commonAncestorLocator = locatorFrom(
      commonAncestor instanceof ShadowRoot
        ? commonAncestor.host
        : commonAncestor,
      document,
    );
    if (commonAncestorLocator === null) {
      throw new Error("Unable to locate the selected region's common ancestor");
    }
    const allTargets = targetElements
      .slice(0, MAX_REGION_TARGETS)
      .flatMap((element): RegionTarget[] => {
        const absoluteLocator = locatorFrom(element, document);
        const relativeLocator = locatorFrom(element, commonAncestor);
        if (absoluteLocator === null || relativeLocator === null) return [];
        const clone = sanitizedClone(element);
        const targetAccessibility = accessibilityHint(element);
        const targetReact = reactHint(element);
        return [
          {
            absoluteLocator,
            relativeLocator,
            text: normalizedText(clone.textContent ?? "", 240),
            rect: rectValue(element.getBoundingClientRect()),
            ...(targetAccessibility === null
              ? {}
              : { accessibility: targetAccessibility }),
            ...(targetReact === null ? {} : { react: targetReact }),
          },
        ];
      });
    const groupElements = repeatedGroups(
      targetElements,
      commonAncestor,
      collected.order,
    );
    const allGroups = groupElements
      .slice(0, MAX_REGION_GROUPS)
      .flatMap((elements): RegionGroup[] => {
        if (elements.length > MAX_REGION_TARGETS) return [];
        const absoluteLocator = locatorForElements(elements, document);
        const relativeLocator = locatorForElements(elements, commonAncestor);
        if (absoluteLocator === null || relativeLocator === null) return [];
        return [
          {
            absoluteLocator,
            relativeLocator,
            count: elements.length,
            rect: unionRect(elements),
          },
        ];
      });
    const targets = allTargets;
    const groups = allGroups;
    const region = {
      commonAncestor: {
        kind:
          domCommonAncestor instanceof ShadowRoot
            ? ("shadow-root" as const)
            : domCommonAncestor === null
              ? ("composed-element" as const)
              : ("element" as const),
        absoluteLocator: commonAncestorLocator,
      },
      targets,
      groups,
      omittedTargetCount: targetElements.length - targets.length,
      omittedGroupCount: groupElements.length - groups.length,
    };
    const encoder = new TextEncoder();
    while (
      encoder.encode(JSON.stringify(region)).byteLength >
      MAX_REGION_STRUCTURED_BYTES
    ) {
      if (region.groups.length > 0) {
        region.groups.pop();
        region.omittedGroupCount += 1;
        continue;
      }
      if (region.targets.length > 0) {
        region.targets.pop();
        region.omittedTargetCount += 1;
        continue;
      }
      break;
    }
    return region;
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
      listen(document, "pointermove", ((event: PointerEvent) => {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target === null || target.hasAttribute(OVERLAY_ATTRIBUTE)) return;
        const rect = target.getBoundingClientRect();
        draw(
          rectValue(rect),
          `${target.localName}${target.id ? `#${target.id}` : ""}`,
        );
      }) as EventListener);
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
    listen(document, "pointermove", ((event: PointerEvent) => {
      if (input.kind === "auto" && (!dragging || dragStart === null)) {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target === null || target.hasAttribute(OVERLAY_ATTRIBUTE)) return;
        const rect = target.getBoundingClientRect();
        draw(
          rectValue(rect),
          `${target.localName}${target.id ? `#${target.id}` : ""}`,
        );
        return;
      }
      if (!dragging || dragStart === null) return;
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
      draw(
        { x: left, y: top, width: right - left, height: bottom - top },
        "Marked region",
      );
    }) as EventListener);
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
        region: regionValue(rect),
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
