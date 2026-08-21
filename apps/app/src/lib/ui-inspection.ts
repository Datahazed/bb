import type {
  ExperimentalUiInspectionAccessibility,
  ExperimentalUiInspectionApi,
  ExperimentalUiInspectionBounds,
  ExperimentalUiInspectionElement,
  ExperimentalUiInspectionMetadata,
  ExperimentalUiInspectionSession,
  ExperimentalUiInspectionSessionEvent,
  ExperimentalUiInspectionSessionOptions,
  ExperimentalUiInspectionSource,
  ExperimentalUiInspectionStyle,
  ExperimentalUiInspectionTarget,
} from "@get-bb/plugin-sdk";
import { runWithPluginDomIsolation } from "./foreign-dom-mutation-guard";

interface RegisteredInspectionMetadata {
  metadata: ExperimentalUiInspectionMetadata;
  source: ExperimentalUiInspectionSource;
}

const registrations = new WeakMap<Element, RegisteredInspectionMetadata>();
const OVERLAY_ATTRIBUTE = "data-bb-ui-inspection-overlay";
const ACTIVATION_PASSTHROUGH_ATTRIBUTE =
  "data-bb-ui-inspection-activation-passthrough";

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === 1
  );
}

function copyMetadata(
  metadata: ExperimentalUiInspectionMetadata,
): ExperimentalUiInspectionMetadata {
  return {
    codeName: metadata.codeName,
    name: metadata.name,
    kind: metadata.kind,
    ...(metadata.component === undefined
      ? {}
      : { component: metadata.component }),
    ...(metadata.variant === undefined ? {} : { variant: metadata.variant }),
    ...(metadata.state === undefined ? {} : { state: { ...metadata.state } }),
    ...(metadata.tokens === undefined ? {} : { tokens: [...metadata.tokens] }),
    ...(metadata.context === undefined
      ? {}
      : { context: { ...metadata.context } }),
    ...(metadata.logicalParent === undefined
      ? {}
      : { logicalParent: metadata.logicalParent }),
  };
}

/** Register inspectable metadata for a Core or plugin-owned DOM element. */
export function registerUiInspectionMetadata(
  element: Element,
  metadata: ExperimentalUiInspectionMetadata,
  source: ExperimentalUiInspectionSource = { kind: "core" },
): { dispose(): void } {
  const record = { metadata: copyMetadata(metadata), source };
  registrations.set(element, record);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (registrations.get(element) === record) registrations.delete(element);
    },
  };
}

function dataAttributeRecord(
  element: Element,
): RegisteredInspectionMetadata | null {
  const codeName = element.getAttribute("data-code-name")?.trim();
  if (!codeName) return null;
  const label = element.getAttribute("data-code-label")?.trim();
  const kind = element.getAttribute("data-code-kind")?.trim();
  return {
    metadata: {
      codeName,
      name: label || codeName,
      kind: kind || "element",
    },
    source: { kind: "core" },
  };
}

function getRecord(element: Element): RegisteredInspectionMetadata | null {
  return registrations.get(element) ?? dataAttributeRecord(element);
}

function nearestInspectable(element: Element | null): Element | null {
  let current = element;
  while (current !== null) {
    if (
      !current.hasAttribute(OVERLAY_ATTRIBUTE) &&
      getRecord(current) !== null
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function implicitRole(element: Element): string | null {
  switch (element.tagName.toLowerCase()) {
    case "a":
      return element.hasAttribute("href") ? "link" : null;
    case "button":
      return "button";
    case "input": {
      const type = element.getAttribute("type")?.toLowerCase() ?? "text";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "button" || type === "submit" || type === "reset") {
        return "button";
      }
      return "textbox";
    }
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "img":
      return "img";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "aside":
      return "complementary";
    default:
      return null;
  }
}

function ariaBoolean(
  element: Element,
  name: "aria-expanded" | "aria-pressed" | "aria-selected",
): boolean | null {
  const value = element.getAttribute(name);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

const NAME_FROM_CONTENT_ROLES = new Set([
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "heading",
  "link",
  "menuitem",
  "option",
  "radio",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);
const NAME_FROM_CONTENT_TAGS = new Set([
  "caption",
  "label",
  "legend",
  "summary",
]);
const ACCESSIBLE_NAME_MAX_LENGTH = 240;

function boundedAccessibleName(
  value: string | null | undefined,
): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= ACCESSIBLE_NAME_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, ACCESSIBLE_NAME_MAX_LENGTH - 1)}…`;
}

function accessibleName(element: Element): string | null {
  const ariaLabel = boundedAccessibleName(element.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const labels = labelledBy
      .split(/\s+/)
      .map((id) =>
        element.ownerDocument.getElementById(id)?.textContent?.trim(),
      )
      .filter((value): value is string => Boolean(value));
    if (labels.length > 0) return boundedAccessibleName(labels.join(" "));
  }
  const alt = boundedAccessibleName(element.getAttribute("alt"));
  if (alt) return alt;
  const title = boundedAccessibleName(element.getAttribute("title"));
  if (title) return title;
  const role = element.getAttribute("role") ?? implicitRole(element);
  if (
    !NAME_FROM_CONTENT_ROLES.has(role ?? "") &&
    !NAME_FROM_CONTENT_TAGS.has(element.tagName.toLowerCase())
  ) {
    return null;
  }
  return boundedAccessibleName(element.textContent);
}

function snapshotBounds(element: Element): ExperimentalUiInspectionBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function snapshotStyle(element: Element): ExperimentalUiInspectionStyle {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return {
    display: style?.display ?? "",
    position: style?.position ?? "",
    color: style?.color ?? "",
    backgroundColor: style?.backgroundColor ?? "",
    fontFamily: style?.fontFamily ?? "",
    fontSize: style?.fontSize ?? "",
    fontWeight: style?.fontWeight ?? "",
    lineHeight: style?.lineHeight ?? "",
    padding: style?.padding ?? "",
    margin: style?.margin ?? "",
    border: style?.border ?? "",
    borderRadius: style?.borderRadius ?? "",
    gap: style?.gap ?? "",
    opacity: style?.opacity ?? "",
  };
}

function snapshotAccessibility(
  element: Element,
): ExperimentalUiInspectionAccessibility {
  const disabledProperty =
    "disabled" in element && typeof element.disabled === "boolean"
      ? element.disabled
      : false;
  return {
    role: element.getAttribute("role") ?? implicitRole(element),
    name: accessibleName(element),
    disabled:
      disabledProperty || element.getAttribute("aria-disabled") === "true",
    expanded: ariaBoolean(element, "aria-expanded"),
    pressed: ariaBoolean(element, "aria-pressed"),
    selected: ariaBoolean(element, "aria-selected"),
  };
}

function snapshotElement(
  element: Element,
  record: RegisteredInspectionMetadata,
): ExperimentalUiInspectionElement {
  const { logicalParent: _logicalParent, ...metadata } = record.metadata;
  return {
    element,
    metadata: copyMetadata(metadata),
    source: { ...record.source },
    bounds: snapshotBounds(element),
    style: snapshotStyle(element),
    accessibility: snapshotAccessibility(element),
  };
}

/** Resolve the deepest inspectable target and its root-to-target hierarchy. */
export function resolveUiInspectionTarget(
  element: Element,
): ExperimentalUiInspectionTarget | null {
  const targetElement = nearestInspectable(element);
  if (targetElement === null) return null;

  const reversed: ExperimentalUiInspectionElement[] = [];
  const visited = new Set<Element>();
  let current: Element | null = targetElement;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const record = getRecord(current);
    if (record === null) break;
    reversed.push(snapshotElement(current, record));
    const logicalParent = record.metadata.logicalParent;
    current = nearestInspectable(
      isElement(logicalParent) ? logicalParent : current.parentElement,
    );
  }

  const hierarchy = reversed.reverse();
  const target = hierarchy.at(-1);
  return target === undefined ? null : { target, hierarchy };
}

function eventElement(event: Event): Element | null {
  const target = event.target;
  return isElement(target) ? target : null;
}

function isPrimaryPointer(event: PointerEvent): boolean {
  return event.button === 0 && event.isPrimary !== false;
}

function consume(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function createHighlightOverlay(document: Document): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.setAttribute(OVERLAY_ATTRIBUTE, "");
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    display: "none",
    position: "fixed",
    pointerEvents: "none",
    boxSizing: "border-box",
    zIndex: "2147483646",
    border: "2px solid var(--ring)",
    background: "color-mix(in oklab, var(--ring) 10%, transparent)",
  });
  document.body.appendChild(overlay);
  return overlay;
}

function showHighlight(
  overlay: HTMLDivElement,
  target: ExperimentalUiInspectionTarget | null,
): void {
  if (target === null) {
    overlay.style.display = "none";
    return;
  }
  const { bounds } = target.target;
  overlay.style.display = "block";
  overlay.style.left = `${bounds.left}px`;
  overlay.style.top = `${bounds.top}px`;
  overlay.style.width = `${bounds.width}px`;
  overlay.style.height = `${bounds.height}px`;
}

interface FrozenActivation {
  pointerId: number;
  element: Element;
  x: number;
  y: number;
}

/** Start one Core-owned pointer inspection session in the supplied document. */
export function startUiInspectionSession(
  options: ExperimentalUiInspectionSessionOptions,
  document: Document = globalThis.document,
  warn: (message: string) => void = console.warn,
): ExperimentalUiInspectionSession {
  const overlay = createHighlightOverlay(document);
  const view = document.defaultView;
  let disposed = false;
  let frame: number | ReturnType<typeof setTimeout> | null = null;
  let pendingMove: PointerEvent | null = null;
  let frozen: FrozenActivation | null = null;
  let suppressClick = false;
  let clickCleanup: ReturnType<typeof setTimeout> | null = null;

  const deliver = (event: ExperimentalUiInspectionSessionEvent): void => {
    try {
      options.onEvent(event);
    } catch (error) {
      warn(
        `bb UI inspection callback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const resolveSafely = (
    element: Element | null,
    pointer: { x: number; y: number },
  ): ExperimentalUiInspectionTarget | null => {
    if (element === null) return null;
    if (!element.isConnected) {
      deliver({
        type: "error",
        code: "target-detached",
        message: "The inspected element is no longer attached.",
      });
      return null;
    }
    try {
      return resolveUiInspectionTarget(element);
    } catch (error) {
      deliver({
        type: "error",
        code: "internal",
        message: error instanceof Error ? error.message : String(error),
      });
      warn(
        `bb UI inspection target resolution failed at ${pointer.x},${pointer.y}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  const hitTest = (event: PointerEvent): Element | null => {
    const atPoint = document.elementFromPoint?.(event.clientX, event.clientY);
    if (
      isElement(atPoint) &&
      !atPoint.hasAttribute(OVERLAY_ATTRIBUTE) &&
      nearestInspectable(atPoint) !== null
    ) {
      return atPoint;
    }
    return eventElement(event);
  };

  const flushMove = (): void => {
    frame = null;
    const event = pendingMove;
    pendingMove = null;
    if (disposed || event === null) return;
    const pointer = { x: event.clientX, y: event.clientY };
    const target = resolveSafely(hitTest(event), pointer);
    showHighlight(overlay, target);
    deliver({ type: "hover", target, pointer });
  };

  const onPointerMove = (event: PointerEvent): void => {
    pendingMove = event;
    if (frame !== null) return;
    frame =
      view?.requestAnimationFrame(flushMove) ??
      globalThis.setTimeout(flushMove, 16);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!isPrimaryPointer(event)) return;
    const element = hitTest(event);
    if (
      element !== null &&
      element.closest(`[${ACTIVATION_PASSTHROUGH_ATTRIBUTE}="true"]`) !== null
    ) {
      return;
    }
    const target = resolveSafely(element, {
      x: event.clientX,
      y: event.clientY,
    });
    if (target === null) return;
    frozen = {
      pointerId: event.pointerId,
      element: target.target.element,
      x: event.clientX,
      y: event.clientY,
    };
    consume(event);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (
      frozen === null ||
      !isPrimaryPointer(event) ||
      event.pointerId !== frozen.pointerId
    ) {
      return;
    }
    consume(event);
    const activation = frozen;
    frozen = null;
    suppressClick = true;
    if (clickCleanup !== null) clearTimeout(clickCleanup);
    clickCleanup = setTimeout(() => {
      suppressClick = false;
      clickCleanup = null;
    }, 0);
    const pointer = { x: activation.x, y: activation.y };
    const target = resolveSafely(activation.element, pointer);
    if (target !== null) deliver({ type: "select", target, pointer });
  };

  const onClick = (event: MouseEvent): void => {
    if (!suppressClick || event.button !== 0) return;
    suppressClick = false;
    if (clickCleanup !== null) clearTimeout(clickCleanup);
    clickCleanup = null;
    consume(event);
    if (disposed) {
      document.removeEventListener("click", onClick, true);
    }
  };

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("click", onClick, true);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      if (!suppressClick) {
        document.removeEventListener("click", onClick, true);
      }
      if (frame !== null) {
        if (view !== null && typeof frame === "number") {
          view.cancelAnimationFrame(frame);
        } else {
          clearTimeout(frame);
        }
      }
      if (clickCleanup !== null) clearTimeout(clickCleanup);
      if (suppressClick) {
        clickCleanup = setTimeout(() => {
          suppressClick = false;
          clickCleanup = null;
          document.removeEventListener("click", onClick, true);
        }, 0);
      }
      frame = null;
      pendingMove = null;
      frozen = null;
      overlay.remove();
    },
  };
}

/** Create a plugin-stamped API whose handles are owned by one abort signal. */
export function createPluginUiInspectionApi(
  pluginId: string,
  signal: AbortSignal,
  warn: (message: string) => void = console.warn,
): ExperimentalUiInspectionApi {
  const handles = new Set<{ dispose(): void }>();

  const own = <Handle extends { dispose(): void }>(handle: Handle): Handle => {
    if (signal.aborted) {
      handle.dispose();
      return handle;
    }
    handles.add(handle);
    let disposed = false;
    return {
      ...handle,
      dispose() {
        if (disposed) return;
        disposed = true;
        handles.delete(handle);
        handle.dispose();
      },
    };
  };

  const disposeAll = (): void => {
    for (const handle of handles) handle.dispose();
    handles.clear();
  };
  signal.addEventListener("abort", disposeAll, { once: true });

  return {
    register(element, metadata) {
      if (signal.aborted) return { dispose() {} };
      return own(
        registerUiInspectionMetadata(element, metadata, {
          kind: "plugin",
          pluginId,
        }),
      );
    },
    startSession(options) {
      if (signal.aborted) return { dispose() {} };
      return own(
        startUiInspectionSession(
          {
            onEvent: (event) =>
              runWithPluginDomIsolation(() => options.onEvent(event), pluginId),
          },
          document,
          warn,
        ),
      );
    },
  };
}

/** Test-only reset for module-global registrations. */
export function resetUiInspectionForTest(elements: readonly Element[]): void {
  for (const element of elements) registrations.delete(element);
}
