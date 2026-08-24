import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  useComposer,
  type ExperimentalProviderExtensionStateProps,
} from "@get-bb/plugin-sdk/app";
import {
  PI_EXTENSION_UI_STATE_NAME,
  piExtensionUIStateSchema,
  type PiExtensionUIState,
} from "./src/extension-state.js";
import { PiModelSettingsEditor } from "./src/model-settings-editor.js";
import "./app.css";

type PiNotification = PiExtensionUIState["notifications"][number];

/** How long a notification stays up: errors linger, the rest pass. */
function notificationDurationMs(level: PiNotification["level"]): number {
  return level === "error" ? 10_000 : 5_000;
}

function showNotification(notification: PiNotification): void {
  const show =
    notification.level === "error"
      ? toast.error
      : notification.level === "warning"
        ? toast.warning
        : toast.info;
  show(notification.message, {
    id: `pi-extension-notification-${notification.id}`,
    closeButton: true,
    duration: notificationDurationMs(notification.level),
  });
}

function parseState(payload: unknown): PiExtensionUIState | null {
  const parsed = piExtensionUIStateSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/**
 * What Pi's extensions put beside the composer. Statuses, widgets and the
 * title render in place; a notification is transient, like pi's own, so it
 * goes to the app's toaster instead — once, when it arrives. The
 * notifications a persisted snapshot already holds when this mounts are
 * history (the TUI would have shown them at the time), not news.
 */
function PiExtensionState({ payload, placement }: ExperimentalProviderExtensionStateProps) {
  const composer = useComposer();
  const appliedEditorRevision = useRef<number | null>(null);
  const state = parseState(payload);
  const editor = state?.editor ?? null;
  const title = state?.title ?? null;
  const notifications = state?.notifications ?? null;
  const lastShownNotificationId = useRef<number | null>(null);
  if (lastShownNotificationId.current === null) {
    lastShownNotificationId.current = Math.max(0, ...(notifications ?? []).map(({ id }) => id));
  }

  useEffect(() => {
    if (placement !== "aboveEditor") return;
    if (editor === null) {
      appliedEditorRevision.current = null;
      return;
    }
    if (appliedEditorRevision.current === editor.revision) return;
    appliedEditorRevision.current = editor.revision;
    composer.setText(editor.text);
  }, [composer, editor, placement]);

  useEffect(() => {
    if (placement !== "aboveEditor" || title === null) return;
    const previousTitle = document.title;
    document.title = title;
    return () => {
      if (document.title === title) document.title = previousTitle;
    };
  }, [placement, title]);

  useEffect(() => {
    if (placement !== "aboveEditor" || notifications === null) return;
    for (const notification of notifications) {
      if (notification.id <= (lastShownNotificationId.current ?? 0)) continue;
      lastShownNotificationId.current = notification.id;
      showNotification(notification);
    }
  }, [notifications, placement]);

  if (state === null) return null;
  const widgets = state.widgets.filter((widget) => widget.placement === placement);
  const showMetadata =
    placement === "aboveEditor" && (state.statuses.length > 0 || state.title !== null);
  if (!showMetadata && widgets.length === 0) return null;

  return (
    <div className="pi-extension-state" data-pi-extension-placement={placement}>
      {showMetadata ? (
        <div className="pi-extension-state__metadata">
          {state.title !== null ? (
            <div className="pi-extension-state__title">{state.title}</div>
          ) : null}
          {state.statuses.map((status) => (
            <div className="pi-extension-state__status" key={status.key}>
              {status.text}
            </div>
          ))}
        </div>
      ) : null}
      {widgets.map((widget) => (
        <div className="pi-extension-state__widget" key={widget.key}>
          {widget.lines.map((line, index) => (
            <div key={`${widget.key}:${index}`}>{line || " "}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "models",
    title: "Models",
    description: "Choose the authenticated models available in Pi's picker and model cycling.",
    component: PiModelSettingsEditor,
  });
  app.slots.experimental_providerExtensionState({
    name: PI_EXTENSION_UI_STATE_NAME,
    component: PiExtensionState,
  });
});
