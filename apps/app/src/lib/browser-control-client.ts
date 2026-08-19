import type {
  BrowserControlAction,
  BrowserControlRequestMessage,
  BrowserControlResponseMessage,
  BrowserTabDescriptor,
  BrowserTabTarget,
  JsonValue,
} from "@bb/server-contract";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import { wsManager } from "./ws";

interface RegisteredBrowserTab {
  descriptor: BrowserTabDescriptor;
  desktopBrowser: BbDesktopBrowserApi;
}

interface ActiveBrowserControlRequest {
  controller: AbortController;
  registration: RegisteredBrowserTab;
}

interface RegisterBrowserControlTabArgs {
  active: boolean;
  desktopBrowser: BbDesktopBrowserApi;
  projectId: string | null;
  state: BbDesktopBrowserState | null;
  tabId: string;
  threadId: string | null;
  url: string;
}

export interface BrowserControlTabRegistration {
  update(
    args: Pick<RegisterBrowserControlTabArgs, "active" | "state" | "url">,
  ): void;
  dispose(): void;
}

const registeredTabs = new Map<string, RegisteredBrowserTab>();
const activeRequestCounts = new Map<string, number>();
const activityListeners = new Set<() => void>();
const requestControllers = new Map<string, ActiveBrowserControlRequest>();

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

const clientId = randomId();
const windowId = randomId();

function sendClientState(): void {
  wsManager.sendBrowserClientState({
    type: "browser-client-state",
    clientId,
    windowId,
    tabs: [...registeredTabs.values()].map(({ descriptor }) => ({
      tabId: descriptor.tabId,
      threadId: descriptor.threadId,
      projectId: descriptor.projectId,
      url: descriptor.url,
      title: descriptor.title,
      active: descriptor.active,
      navigationEpoch: descriptor.navigationEpoch,
    })),
  });
}

function targetEquals(a: BrowserTabTarget, b: BrowserTabTarget): boolean {
  return (
    a.clientId === b.clientId &&
    a.windowId === b.windowId &&
    a.tabId === b.tabId &&
    a.navigationEpoch === b.navigationEpoch
  );
}

function targetFor(tab: RegisteredBrowserTab): BrowserTabTarget {
  return {
    clientId,
    windowId,
    tabId: tab.descriptor.tabId,
    navigationEpoch: tab.descriptor.navigationEpoch,
  };
}

function setRequestActive(tabId: string, active: boolean): void {
  const current = activeRequestCounts.get(tabId) ?? 0;
  const next = active ? current + 1 : Math.max(0, current - 1);
  if (next === 0) activeRequestCounts.delete(tabId);
  else activeRequestCounts.set(tabId, next);
  for (const listener of activityListeners) listener();
}

function abortRequestsForRegistration(
  registration: RegisteredBrowserTab,
  reason: string,
): void {
  for (const request of requestControllers.values()) {
    if (request.registration === registration) {
      request.controller.abort(reason);
    }
  }
}

function targetChangedError(): Error {
  const error = new Error(
    "The target Browser tab is no longer at that page revision",
  );
  error.name = "BrowserControlTargetChangedError";
  return error;
}

const resolveLocatorSource = `
  const resolveLocator = (locator) => {
    let root = document;
    let element = null;
    for (let index = 0; index < locator.selectors.length; index += 1) {
      element = root.querySelector(locator.selectors[index]);
      if (!(element instanceof Element)) throw new Error("Browser target was not found");
      if (index < locator.selectors.length - 1) {
        if (!(element.shadowRoot instanceof ShadowRoot)) throw new Error("Browser target shadow root is unavailable");
        root = element.shadowRoot;
      }
    }
    return element;
  };
`;

const snapshotScript = `async ({ input, signal }) => {
  const maxNodes = Math.max(1, Math.min(2000, Number(input.maxNodes ?? 500)));
  const interactiveOnly = input.mode === "interactive";
  const interactiveSelector = "a[href],button,input,select,textarea,[role],[tabindex],[contenteditable=true],summary";
  const queue = [{ root: document, shadowHosts: [] }];
  const nodes = [];
  let scanned = 0;
  let truncated = false;
  const selectorFor = (element, root) => {
    if (element.id && root.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current !== root && parts.length < 8) {
      const parent = current.parentElement;
      let part = current.localName;
      if (parent) {
        const peers = Array.from(parent.children).filter((item) => item.localName === current.localName);
        if (peers.length > 1) part += ":nth-of-type(" + (peers.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      try { if (root.querySelectorAll(candidate).length === 1) return candidate; } catch {}
      current = parent;
    }
    return parts.join(" > ");
  };
  while (queue.length > 0 && nodes.length < maxNodes && scanned < 10000) {
    if (signal.aborted) throw new Error("Browser snapshot cancelled");
    const scope = queue.shift();
    const walker = document.createTreeWalker(scope.root, NodeFilter.SHOW_ELEMENT);
    let element;
    while ((element = walker.nextNode()) && nodes.length < maxNodes && scanned < 10000) {
      scanned += 1;
      if (element.shadowRoot) queue.push({ root: element.shadowRoot, shadowHosts: [...scope.shadowHosts, selectorFor(element, scope.root)] });
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const interactive = element.matches(interactiveSelector);
      if (interactiveOnly && !interactive) continue;
      const editable = element.matches("input,textarea,[contenteditable]") || element.closest("[contenteditable]") !== null || element.isContentEditable || document.designMode === "on";
      const text = editable ? "" : (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
      const label = element.getAttribute("aria-label") || "";
      const role = element.getAttribute("role") || (interactive ? element.localName : "");
      if (!interactive && !text && !label) continue;
      nodes.push({
        locator: { selectors: [...scope.shadowHosts, selectorFor(element, scope.root)] },
        tag: element.localName,
        role: role || null,
        name: label || text.slice(0, 120) || null,
        text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        interactive
      });
    }
  }
  truncated = queue.length > 0 || nodes.length >= maxNodes || scanned >= 10000;
  return { url: location.href, title: document.title || null, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, nodes, scanned, truncated };
}`;

function scriptForAction(action: BrowserControlAction): {
  source: string;
  input: JsonValue;
  timeoutMs: number;
  world?: "isolated" | "main";
} | null {
  switch (action.kind) {
    case "snapshot":
      return { source: snapshotScript, input: action, timeoutMs: 30_000 };
    case "click":
      return {
        source: `({ input }) => { ${resolveLocatorSource}
          const element = input.target.target === "locator"
            ? resolveLocator(input.target.locator)
            : document.elementFromPoint(input.target.x, input.target.y);
          if (!(element instanceof HTMLElement)) throw new Error("Browser target is not clickable");
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
          return { clicked: true, tag: element.localName };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "type":
      return {
        source: `({ input }) => { ${resolveLocatorSource}
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) throw new Error("Browser target is not editable");
          element.focus();
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const nextValue = (input.clear ? "" : element.value) + input.text;
            const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            if (setter) setter.call(element, nextValue);
            else element.value = nextValue;
          } else {
            if (input.clear) element.textContent = "";
            element.textContent = (element.textContent || "") + input.text;
          }
          element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.text }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { typed: true };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "key":
      return {
        source: `({ input }) => {
          const deepActiveElement = () => {
            let active = document.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            return active;
          };
          const init = { key: input.key, code: input.code || "", bubbles: true, cancelable: true,
            altKey: input.modifiers?.includes("Alt") || false,
            ctrlKey: input.modifiers?.includes("Control") || false,
            metaKey: input.modifiers?.includes("Meta") || false,
            shiftKey: input.modifiers?.includes("Shift") || false };
          const target = deepActiveElement() || document.body;
          const accepted = target.dispatchEvent(new KeyboardEvent("keydown", init));
          if (accepted && input.key === "Enter") {
            if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) target.click();
            else if (target instanceof HTMLElement && target.closest("form") instanceof HTMLFormElement) target.closest("form").requestSubmit();
          } else if (accepted && (input.key === " " || input.key === "Spacebar") && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) {
            target.click();
          } else if (accepted && input.key === "Tab") {
            const focusable = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1']),[contenteditable=true]")).filter((element) => element instanceof HTMLElement && !element.hasAttribute("disabled"));
            const index = focusable.indexOf(target);
            const offset = input.modifiers?.includes("Shift") ? -1 : 1;
            const next = focusable[(index + offset + focusable.length) % focusable.length];
            if (next instanceof HTMLElement) next.focus();
          }
          target.dispatchEvent(new KeyboardEvent("keyup", init));
          return { pressed: input.key, defaultApplied: accepted };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "scroll":
      return {
        source: `({ input }) => {
          const options = { behavior: input.behavior || "auto" };
          if (input.x !== undefined || input.y !== undefined) scrollTo({ ...options, left: input.x ?? scrollX, top: input.y ?? scrollY });
          else scrollBy({ ...options, left: input.deltaX ?? 0, top: input.deltaY ?? 0 });
          return { x: scrollX, y: scrollY };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "script":
      return {
        source: action.source,
        input: action.input,
        timeoutMs: action.timeoutMs,
        ...(action.world === undefined ? {} : { world: action.world }),
      };
    case "navigate":
    case "screenshot":
      return null;
  }
}

async function executeAction(
  tab: RegisteredBrowserTab,
  action: BrowserControlAction,
  signal: AbortSignal,
): Promise<JsonValue> {
  if (action.kind === "navigate") {
    const navigate = tab.desktopBrowser.experimental_navigateBrowserPage;
    if (navigate === undefined) {
      throw new Error("Browser navigation requires a newer BB desktop app");
    }
    const result = await navigate({
      tabId: tab.descriptor.tabId,
      url: action.url,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw targetChangedError();
    }
    return { navigating: true, url: result.url };
  }
  if (action.kind === "screenshot") {
    const capture = tab.desktopBrowser.experimental_captureBrowserPage;
    if (capture === undefined)
      throw new Error("Browser screenshots require a newer BB desktop app");
    const result = await capture({
      tabId: tab.descriptor.tabId,
      format: action.format ?? "png",
      quality: action.quality ?? 85,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while the screenshot was captured");
    }
    return result;
  }
  const script = scriptForAction(action);
  const run = tab.desktopBrowser.experimental_runBrowserPageScript;
  if (script === null || run === undefined) {
    throw new Error("Browser page actions require a newer BB desktop app");
  }
  const result = await run(
    {
      tabId: tab.descriptor.tabId,
      requestId: randomId(),
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      ...script,
    },
    { signal },
  );
  if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
    throw new Error("Browser tab changed while the action was running");
  }
  return result.value;
}

async function handleRequest(
  message: BrowserControlRequestMessage,
): Promise<void> {
  const tab = registeredTabs.get(message.target.tabId);
  if (tab === undefined || !targetEquals(message.target, targetFor(tab))) {
    wsManager.sendBrowserControlResponse({
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ok: false,
      error: {
        code: "BrowserControlTargetChangedError",
        message: "The target Browser tab is no longer at that page revision",
      },
    });
    return;
  }
  const controller = new AbortController();
  requestControllers.set(message.requestId, {
    controller,
    registration: tab,
  });
  setRequestActive(message.target.tabId, true);
  let response: BrowserControlResponseMessage;
  try {
    const value = await executeAction(tab, message.action, controller.signal);
    if (
      registeredTabs.get(message.target.tabId) !== tab ||
      !targetEquals(message.target, targetFor(tab)) ||
      controller.signal.aborted
    ) {
      throw targetChangedError();
    }
    response = {
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ok: true,
      value,
    };
  } catch (error) {
    response = {
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ok: false,
      error: {
        code: error instanceof Error ? error.name : "BrowserControlError",
        message: String(error instanceof Error ? error.message : error).slice(
          0,
          2_048,
        ),
      },
    };
  } finally {
    requestControllers.delete(message.requestId);
    setRequestActive(message.target.tabId, false);
  }
  wsManager.sendBrowserControlResponse(response);
}

wsManager.onBrowserControlRequest((message) => void handleRequest(message));
wsManager.onBrowserControlCancel((message) => {
  requestControllers.get(message.requestId)?.controller.abort(message.reason);
});
wsManager.onConnectionStateChange(() => {
  if (wsManager.getConnectionState() === "connected") return;
  for (const request of requestControllers.values()) {
    request.controller.abort("client-disconnected");
  }
});
wsManager.onConnected(() => sendClientState());

export function registerBrowserControlTab(
  args: RegisterBrowserControlTabArgs,
): BrowserControlTabRegistration {
  const descriptorFor = (
    next: Pick<RegisterBrowserControlTabArgs, "active" | "state" | "url">,
  ): BrowserTabDescriptor => ({
    clientId,
    windowId,
    tabId: args.tabId,
    threadId: args.threadId,
    projectId: args.projectId,
    url: next.state?.url ?? next.url,
    title: next.state?.title ?? null,
    active: next.active,
    navigationEpoch: next.state?.navigationEpoch ?? 0,
  });
  const registration = {
    descriptor: descriptorFor(args),
    desktopBrowser: args.desktopBrowser,
  };
  const replacedRegistration = registeredTabs.get(args.tabId);
  if (replacedRegistration !== undefined) {
    abortRequestsForRegistration(replacedRegistration, "tab-replaced");
  }
  registeredTabs.set(args.tabId, registration);
  sendClientState();
  return {
    update(next) {
      if (registeredTabs.get(args.tabId) !== registration) return;
      const descriptor = descriptorFor(next);
      if (
        JSON.stringify(descriptor) === JSON.stringify(registration.descriptor)
      ) {
        return;
      }
      if (
        descriptor.navigationEpoch !== registration.descriptor.navigationEpoch
      ) {
        abortRequestsForRegistration(registration, "navigation");
      }
      registration.descriptor = descriptor;
      sendClientState();
    },
    dispose() {
      if (registeredTabs.get(args.tabId) !== registration) return;
      abortRequestsForRegistration(registration, "tab-disposed");
      registeredTabs.delete(args.tabId);
      sendClientState();
    },
  };
}

export function subscribeBrowserControlActivity(
  listener: () => void,
): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function browserControlActivitySnapshot(tabId: string): number {
  return activeRequestCounts.get(tabId) ?? 0;
}
