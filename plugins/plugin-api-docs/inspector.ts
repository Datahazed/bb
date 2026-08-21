import type {
  ExperimentalUiInspectionApi,
  ExperimentalUiInspectionElement,
  ExperimentalUiInspectionPointer,
  ExperimentalUiInspectionSession,
  ExperimentalUiInspectionTarget,
} from "@get-bb/plugin-sdk";

export type PluginGuideInspectorMode =
  | "idle"
  | "active"
  | "hover"
  | "pinned"
  | "handoff"
  | "unavailable"
  | "error";

export interface InspectionPayloadElement {
  codeName: string;
  name: string;
  kind: string;
  source:
    | { kind: "core" }
    | { kind: "plugin"; pluginId: string; displayName?: string };
  component?: string;
  variant?: string;
  state?: Readonly<Record<string, unknown>>;
  tokens?: readonly string[];
  context?: Readonly<Record<string, unknown>>;
  bounds: ExperimentalUiInspectionElement["bounds"];
  style: ExperimentalUiInspectionElement["style"];
  accessibility: ExperimentalUiInspectionElement["accessibility"];
}

export interface InspectionPayload {
  version: 1;
  capturedAt: string;
  path: readonly string[];
  hierarchy: readonly InspectionPayloadElement[];
  target: InspectionPayloadElement;
}

interface ThreadChoice {
  id: string;
  label: string;
}

interface PluginGuideInspectorOptions {
  document: Document;
  inspection?: ExperimentalUiInspectionApi;
  setFooterActive?: (active: boolean) => void;
  fetch?: typeof globalThis.fetch;
  clipboard?: Pick<Clipboard, "writeText">;
  navigateToCompose?: (prompt: string) => void;
  now?: () => Date;
}

export interface PluginGuideInspector {
  readonly mode: PluginGuideInspectorMode;
  toggle(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

const CARD_ATTRIBUTE = "data-bb-plugin-guide-inspector-card";
const OUTLINE_ATTRIBUTE = "data-bb-plugin-guide-inspector-outline";

const INSPECTOR_CSS = `
[${CARD_ATTRIBUTE}] {
  position: fixed;
  z-index: 2147483647;
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 24px));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius, 0.5rem) + 2px);
  background: var(--popover);
  color: var(--popover-foreground);
  outline: none;
  box-shadow: 0 18px 48px rgb(0 0 0 / 0.24), 0 2px 8px rgb(0 0 0 / 0.12);
  font: 400 12px/1.4 var(--font-sans, ui-sans-serif, system-ui, sans-serif);
}
[${CARD_ATTRIBUTE}][data-mode="hover"],
[${CARD_ATTRIBUTE}][data-mode="unavailable"],
[${CARD_ATTRIBUTE}][data-mode="error"] { pointer-events: none; }
.pgi-header { display: grid; gap: 4px; padding: 12px 12px 10px; border-bottom: 1px solid var(--border); }
.pgi-path { overflow: hidden; color: var(--muted-foreground); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.pgi-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pgi-title { min-width: 0; flex: 1; overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.pgi-badge { max-width: 42%; overflow: hidden; border: 1px solid var(--border); border-radius: 999px; padding: 1px 6px; color: var(--muted-foreground); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.pgi-code { color: var(--muted-foreground); font: 500 11px/1.35 var(--font-mono, ui-monospace, monospace); }
.pgi-body { display: grid; gap: 1px; padding: 8px 12px 10px; }
.pgi-row { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 8px; padding: 3px 0; }
.pgi-key { color: var(--muted-foreground); }
.pgi-value { min-width: 0; overflow-wrap: anywhere; }
.pgi-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; }
.pgi-swatch { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border: 1px solid var(--border); border-radius: 2px; vertical-align: -1px; }
.pgi-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.pgi-tag { border-radius: 4px; background: var(--muted); padding: 1px 5px; color: var(--muted-foreground); font: 500 10px/1.5 var(--font-mono, ui-monospace, monospace); }
.pgi-message { padding: 14px; }
.pgi-message strong { display: block; margin-bottom: 3px; font-size: 13px; }
.pgi-message span { color: var(--muted-foreground); }
.pgi-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 12px; border-top: 1px solid var(--border); }
.pgi-button, .pgi-select { min-height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--background); color: var(--foreground); font: 500 11px/1 var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
.pgi-button { padding: 0 9px; cursor: pointer; }
.pgi-button:hover { background: var(--accent); color: var(--accent-foreground); }
.pgi-button-primary { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); }
.pgi-select { width: 100%; padding: 0 8px; }
.pgi-field { display: grid; width: 100%; gap: 5px; color: var(--muted-foreground); }
.pgi-feedback { min-height: 16px; flex: 1 0 100%; color: var(--muted-foreground); font-size: 10px; }
[${OUTLINE_ATTRIBUTE}] { position: fixed; z-index: 2147483646; pointer-events: none; box-sizing: border-box; border: 2px solid var(--ring); border-radius: 2px; background: color-mix(in oklab, var(--ring) 8%, transparent); }
@media (max-width: 520px) {
  [${CARD_ATTRIBUTE}] { inset: auto 8px 8px 8px !important; width: auto; max-height: 62vh; }
}
`;

function payloadElement(
  element: ExperimentalUiInspectionElement,
): InspectionPayloadElement {
  const { metadata, source } = element;
  return {
    codeName: metadata.codeName,
    name: metadata.name,
    kind: metadata.kind,
    source: { ...source },
    ...(metadata.component === undefined
      ? {}
      : { component: metadata.component }),
    ...(metadata.variant === undefined ? {} : { variant: metadata.variant }),
    ...(metadata.state === undefined ? {} : { state: { ...metadata.state } }),
    ...(metadata.tokens === undefined ? {} : { tokens: [...metadata.tokens] }),
    ...(metadata.context === undefined
      ? {}
      : { context: { ...metadata.context } }),
    bounds: { ...element.bounds },
    style: { ...element.style },
    accessibility: { ...element.accessibility },
  };
}

export function createInspectionPayload(
  target: ExperimentalUiInspectionTarget,
  capturedAt = new Date(),
): InspectionPayload {
  const hierarchy = target.hierarchy.map(payloadElement);
  return {
    version: 1,
    capturedAt: capturedAt.toISOString(),
    path: hierarchy.map(({ codeName }) => codeName),
    hierarchy,
    target: payloadElement(target.target),
  };
}

export function formatInspectionAgentPrompt(
  payload: InspectionPayload,
): string {
  return [
    "I inspected this bb UI element with Plugin Guide. Help me understand or change it.",
    "",
    `Path: ${payload.path.join(" / ")}`,
    `Element: ${payload.target.name} (${payload.target.codeName})`,
    `Source: ${sourceLabel(payload.target.source)}`,
    "",
    "Inspection payload:",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

function sourceLabel(source: InspectionPayloadElement["source"]): string {
  return source.kind === "core"
    ? "bb Core"
    : source.displayName || source.pluginId;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function threadChoices(value: unknown): ThreadChoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): ThreadChoice[] => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string") return [];
    const label =
      (typeof record.title === "string" && record.title.trim()) ||
      (typeof record.titleFallback === "string" &&
        record.titleFallback.trim()) ||
      `Thread ${record.id.slice(0, 8)}`;
    return [{ id: record.id, label }];
  });
}

function defaultNavigateToCompose(document: Document, prompt: string): void {
  const view = document.defaultView;
  if (view === null) return;
  const locationState = {
    focusPrompt: true,
    initialPrompt: prompt,
    replaceInitialPrompt: true,
  };
  // React Router stores the user-visible location state under `usr`. Preserve
  // its browser-history envelope so the root composer receives this state
  // through `useLocation()` instead of only changing the address bar.
  const previous = view.history.state as
    | { idx?: unknown }
    | null
    | undefined;
  const previousIndex =
    typeof previous?.idx === "number" ? previous.idx : 0;
  const historyState = {
    usr: locationState,
    key: Math.random().toString(36).slice(2, 10),
    idx: previousIndex + 1,
  };
  view.history.pushState(historyState, "", "/");
  view.dispatchEvent(new PopStateEvent("popstate", { state: historyState }));
}

export function createPluginGuideInspector(
  options: PluginGuideInspectorOptions,
): PluginGuideInspector {
  const { document } = options;
  const view = document.defaultView;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const clipboard = options.clipboard ?? view?.navigator.clipboard;
  const navigateToCompose =
    options.navigateToCompose ??
    ((prompt: string) => defaultNavigateToCompose(document, prompt));
  const now = options.now ?? (() => new Date());
  let mode: PluginGuideInspectorMode = "idle";
  let session: ExperimentalUiInspectionSession | null = null;
  let currentTarget: ExperimentalUiInspectionTarget | null = null;
  let card: HTMLDivElement | null = null;
  let outline: HTMLDivElement | null = null;
  let style: HTMLStyleElement | null = null;
  let handoffController: AbortController | null = null;
  let disposed = false;

  const ensureStyle = (): void => {
    if (style !== null) return;
    style = document.createElement("style");
    style.setAttribute("data-bb-plugin-guide-inspector-style", "");
    style.textContent = INSPECTOR_CSS;
    document.head.append(style);
  };

  const removeCard = (): void => {
    card?.remove();
    card = null;
  };

  const removeOutline = (): void => {
    outline?.remove();
    outline = null;
  };

  const setFeedback = (message: string): void => {
    const feedback = card?.querySelector<HTMLElement>(".pgi-feedback");
    if (feedback) feedback.textContent = message;
  };

  const positionHoverCard = (
    nextCard: HTMLDivElement,
    pointer: ExperimentalUiInspectionPointer,
  ): void => {
    if (view === null) return;
    const rect = nextCard.getBoundingClientRect();
    const gap = 12;
    const left = Math.max(
      gap,
      Math.min(pointer.x + gap, view.innerWidth - rect.width - gap),
    );
    const top = Math.max(
      gap,
      Math.min(pointer.y + gap, view.innerHeight - rect.height - gap),
    );
    nextCard.style.left = `${left}px`;
    nextCard.style.top = `${top}px`;
  };

  const createCard = (
    nextMode: Exclude<PluginGuideInspectorMode, "idle" | "active">,
  ): HTMLDivElement => {
    ensureStyle();
    removeCard();
    const nextCard = element(document, "div", "") as HTMLDivElement;
    nextCard.setAttribute(CARD_ATTRIBUTE, "");
    nextCard.dataset.mode = nextMode;
    if (nextMode === "pinned" || nextMode === "handoff") {
      nextCard.setAttribute("role", "dialog");
      nextCard.setAttribute("aria-label", "UI inspection details");
      nextCard.tabIndex = -1;
      nextCard.style.right = "16px";
      nextCard.style.bottom = "16px";
    }
    document.body.append(nextCard);
    card = nextCard;
    return nextCard;
  };

  const addRow = (
    body: HTMLElement,
    key: string,
    value: string,
    options: { mono?: boolean; swatch?: string } = {},
  ): void => {
    if (!value) return;
    const row = element(document, "div", "pgi-row");
    row.append(element(document, "div", "pgi-key", key));
    const valueNode = element(
      document,
      "div",
      `pgi-value${options.mono ? " pgi-mono" : ""}`,
    );
    if (options.swatch) {
      const swatch = element(document, "span", "pgi-swatch");
      swatch.style.background = options.swatch;
      valueNode.append(swatch);
    }
    valueNode.append(document.createTextNode(value));
    row.append(valueNode);
    body.append(row);
  };

  const drawPinnedOutline = (target: ExperimentalUiInspectionTarget): void => {
    removeOutline();
    ensureStyle();
    const bounds = target.target.bounds;
    outline = element(document, "div", "") as HTMLDivElement;
    outline.setAttribute(OUTLINE_ATTRIBUTE, "");
    Object.assign(outline.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
    document.body.append(outline);
  };

  const resume = (): void => {
    if (mode === "idle" || disposed) return;
    handoffController?.abort();
    handoffController = null;
    removeCard();
    removeOutline();
    currentTarget = null;
    mode = "active";
    startSession();
  };

  const renderTarget = (
    target: ExperimentalUiInspectionTarget,
    nextMode: "hover" | "pinned" | "handoff",
    pointer?: ExperimentalUiInspectionPointer,
  ): HTMLDivElement => {
    const nextCard = createCard(nextMode);
    const metadata = target.target.metadata;
    const payload = createInspectionPayload(target, now());
    const header = element(document, "div", "pgi-header");
    header.append(
      element(document, "div", "pgi-path", payload.path.join(" / ")),
    );
    const titleRow = element(document, "div", "pgi-title-row");
    titleRow.append(element(document, "div", "pgi-title", metadata.name));
    titleRow.append(
      element(
        document,
        "span",
        "pgi-badge",
        sourceLabel(payload.target.source),
      ),
    );
    header.append(titleRow);
    header.append(element(document, "div", "pgi-code", metadata.codeName));
    nextCard.append(header);

    const body = element(document, "div", "pgi-body");
    addRow(body, "Kind", metadata.kind);
    addRow(
      body,
      "Component",
      [metadata.component, metadata.variant].filter(Boolean).join(" · "),
      { mono: true },
    );
    addRow(
      body,
      "Bounds",
      `${Math.round(payload.target.bounds.width)} × ${Math.round(
        payload.target.bounds.height,
      )} at ${Math.round(payload.target.bounds.x)}, ${Math.round(
        payload.target.bounds.y,
      )}`,
      { mono: true },
    );
    addRow(
      body,
      "Layout",
      [payload.target.style.display, payload.target.style.position]
        .filter(Boolean)
        .join(" · "),
      { mono: true },
    );
    addRow(
      body,
      "Typography",
      [
        payload.target.style.fontSize,
        payload.target.style.fontWeight,
        payload.target.style.lineHeight,
      ]
        .filter(Boolean)
        .join(" / "),
      { mono: true },
    );
    addRow(body, "Color", payload.target.style.color, {
      mono: true,
      swatch: payload.target.style.color,
    });
    addRow(body, "Background", payload.target.style.backgroundColor, {
      mono: true,
      swatch: payload.target.style.backgroundColor,
    });
    addRow(
      body,
      "Spacing",
      `padding ${payload.target.style.padding || "—"}; margin ${
        payload.target.style.margin || "—"
      }; gap ${payload.target.style.gap || "—"}`,
      { mono: true },
    );
    const accessibility = payload.target.accessibility;
    addRow(
      body,
      "Accessibility",
      [
        accessibility.role,
        accessibility.name,
        accessibility.disabled ? "disabled" : "",
        accessibility.expanded === null
          ? ""
          : `expanded ${String(accessibility.expanded)}`,
        accessibility.pressed === null
          ? ""
          : `pressed ${String(accessibility.pressed)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    if (metadata.tokens && metadata.tokens.length > 0) {
      const row = element(document, "div", "pgi-row");
      row.append(element(document, "div", "pgi-key", "Tokens"));
      const tags = element(document, "div", "pgi-tags");
      for (const token of metadata.tokens) {
        tags.append(element(document, "span", "pgi-tag", token));
      }
      row.append(tags);
      body.append(row);
    }
    if (metadata.state) {
      addRow(body, "State", JSON.stringify(metadata.state), { mono: true });
    }
    if (metadata.context) {
      addRow(body, "Context", JSON.stringify(metadata.context), { mono: true });
    }
    nextCard.append(body);

    if (nextMode !== "hover") {
      const actions = element(document, "div", "pgi-actions");
      const copyButton = element(
        document,
        "button",
        "pgi-button",
        "Copy payload",
      );
      copyButton.type = "button";
      copyButton.addEventListener("click", () => {
        void (async () => {
          try {
            if (!clipboard) throw new Error("Clipboard is unavailable.");
            await clipboard.writeText(JSON.stringify(payload, null, 2));
            setFeedback("Copied inspection payload.");
          } catch (error) {
            setFeedback(
              error instanceof Error ? error.message : "Copy failed.",
            );
          }
        })();
      });
      const sendButton = element(
        document,
        "button",
        "pgi-button",
        "Send to thread",
      );
      sendButton.type = "button";
      sendButton.addEventListener("click", () => void beginHandoff());
      const newButton = element(document, "button", "pgi-button", "New thread");
      newButton.type = "button";
      newButton.addEventListener("click", () => {
        const prompt = formatInspectionAgentPrompt(payload);
        stop();
        navigateToCompose(prompt);
      });
      const resumeButton = element(document, "button", "pgi-button", "Resume");
      resumeButton.type = "button";
      resumeButton.addEventListener("click", resume);
      actions.append(copyButton, sendButton, newButton, resumeButton);
      const feedback = element(document, "div", "pgi-feedback");
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      actions.append(feedback);
      nextCard.append(actions);
    }
    if (pointer) positionHoverCard(nextCard, pointer);
    return nextCard;
  };

  const renderMessage = (
    nextMode: "unavailable" | "error",
    title: string,
    message: string,
    pointer?: ExperimentalUiInspectionPointer,
  ): void => {
    const nextCard = createCard(nextMode);
    const content = element(document, "div", "pgi-message");
    content.append(element(document, "strong", "", title));
    content.append(element(document, "span", "", message));
    nextCard.append(content);
    if (pointer) positionHoverCard(nextCard, pointer);
  };

  const renderHandoff = (
    threads: readonly ThreadChoice[],
    error?: string,
  ): void => {
    const target = currentTarget;
    if (target === null || mode !== "handoff") return;
    const nextCard = renderTarget(target, "handoff");
    const actions = nextCard.querySelector<HTMLElement>(".pgi-actions");
    if (!actions) return;
    actions.replaceChildren();
    if (error) {
      const message = element(document, "div", "pgi-feedback", error);
      message.setAttribute("role", "alert");
      actions.append(message);
    }
    if (threads.length > 0) {
      const label = element(document, "label", "pgi-field", "Thread");
      const select = element(document, "select", "pgi-select");
      for (const thread of threads) {
        const option = document.createElement("option");
        option.value = thread.id;
        option.textContent = thread.label;
        select.append(option);
      }
      label.append(select);
      actions.append(label);
      const send = element(
        document,
        "button",
        "pgi-button pgi-button-primary",
        "Send",
      );
      send.type = "button";
      send.addEventListener("click", () => {
        void (async () => {
          const thread = threads.find(({ id }) => id === select.value);
          if (!thread || currentTarget === null) return;
          send.disabled = true;
          try {
            const payload = createInspectionPayload(currentTarget, now());
            const response = await fetchImpl(
              `/api/v1/threads/${encodeURIComponent(thread.id)}/send`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  input: [
                    {
                      type: "text",
                      text: formatInspectionAgentPrompt(payload),
                      mentions: [],
                    },
                  ],
                  mode: "queue-if-active",
                }),
              },
            );
            if (!response.ok) {
              throw new Error(`Send failed (${response.status}).`);
            }
            mode = "pinned";
            renderTarget(currentTarget, "pinned");
            setFeedback(`Sent to ${thread.label}.`);
          } catch (caught) {
            send.disabled = false;
            const message =
              caught instanceof Error ? caught.message : "Send failed.";
            const status = actions.querySelector<HTMLElement>(".pgi-feedback");
            if (status) status.textContent = message;
          }
        })();
      });
      actions.append(send);
    }
    const back = element(document, "button", "pgi-button", "Back");
    back.type = "button";
    back.addEventListener("click", () => {
      if (currentTarget === null) return;
      handoffController?.abort();
      handoffController = null;
      mode = "pinned";
      renderTarget(currentTarget, "pinned").focus();
    });
    actions.append(back);
  };

  const beginHandoff = async (): Promise<void> => {
    if (currentTarget === null || mode !== "pinned") return;
    mode = "handoff";
    handoffController?.abort();
    handoffController = new AbortController();
    renderHandoff([], "Loading threads…");
    try {
      const response = await fetchImpl(
        "/api/v1/threads?archived=false&limit=50",
        {
          signal: handoffController.signal,
        },
      );
      if (!response.ok)
        throw new Error(`Could not load threads (${response.status}).`);
      const threads = threadChoices(await response.json());
      if (mode !== "handoff") return;
      renderHandoff(
        threads,
        threads.length === 0 ? "No available threads." : undefined,
      );
    } catch (error) {
      if (handoffController.signal.aborted || mode !== "handoff") return;
      renderHandoff(
        [],
        error instanceof Error ? error.message : "Could not load threads.",
      );
    }
  };

  const onSessionEvent: Parameters<
    NonNullable<PluginGuideInspectorOptions["inspection"]>["startSession"]
  >[0]["onEvent"] = (event) => {
    if (
      disposed ||
      (mode !== "active" &&
        mode !== "hover" &&
        mode !== "unavailable" &&
        mode !== "error")
    ) {
      return;
    }
    if (event.type === "error") {
      mode = "error";
      renderMessage("error", "Inspector error", event.message);
      return;
    }
    if (event.type === "hover") {
      currentTarget = event.target;
      if (event.target === null) {
        mode = "unavailable";
        renderMessage(
          "unavailable",
          "No inspection metadata",
          "Move over a named bb surface.",
          event.pointer,
        );
      } else {
        mode = "hover";
        renderTarget(event.target, "hover", event.pointer);
      }
      return;
    }
    session?.dispose();
    session = null;
    currentTarget = event.target;
    mode = "pinned";
    drawPinnedOutline(event.target);
    renderTarget(event.target, "pinned").focus();
  };

  function startSession(): void {
    session?.dispose();
    session =
      options.inspection?.startSession({ onEvent: onSessionEvent }) ?? null;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || mode === "idle") return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === "handoff") {
      handoffController?.abort();
      handoffController = null;
      mode = "pinned";
      if (currentTarget) renderTarget(currentTarget, "pinned").focus();
      return;
    }
    if (mode === "pinned") {
      resume();
      return;
    }
    stop();
  };

  function start(): void {
    if (disposed || mode !== "idle") return;
    ensureStyle();
    mode = "active";
    options.setFooterActive?.(true);
    view?.addEventListener("keydown", onKeyDown, true);
    if (options.inspection) {
      startSession();
    } else {
      mode = "unavailable";
      renderMessage(
        "unavailable",
        "Inspector unavailable",
        "Update bb to a version that supports UI inspection.",
      );
    }
  }

  function stop(): void {
    if (mode === "idle") return;
    handoffController?.abort();
    handoffController = null;
    session?.dispose();
    session = null;
    currentTarget = null;
    removeCard();
    removeOutline();
    view?.removeEventListener("keydown", onKeyDown, true);
    mode = "idle";
    options.setFooterActive?.(false);
  }

  return {
    get mode() {
      return mode;
    },
    toggle() {
      if (mode === "idle") start();
      else stop();
    },
    start,
    stop,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      style?.remove();
      style = null;
    },
  };
}
