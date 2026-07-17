import { ResourceState } from "@bb/shared-ui/resource-list";
import type { PluginRowSignal } from "./plugin-status";
import { UPDATE_TINT_STYLE } from "./plugin-ui";

/** The single status/action slot shared by installed plugin rows and galleries. */
export function PluginRowSignalView({
  signal,
  onUpdateClick,
}: {
  signal: PluginRowSignal;
  onUpdateClick: () => void;
}) {
  if (signal.kind === "update") {
    return (
      <button
        type="button"
        className="shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium"
        style={UPDATE_TINT_STYLE}
        onClick={onUpdateClick}
      >
        Update {signal.version}
      </button>
    );
  }

  return (
    <ResourceState
      tone={signal.tone}
      tooltip={signal.detail}
      accessibleLabel={
        signal.detail === null
          ? signal.label
          : `${signal.label}: ${signal.detail}`
      }
    >
      {signal.label}
    </ResourceState>
  );
}
