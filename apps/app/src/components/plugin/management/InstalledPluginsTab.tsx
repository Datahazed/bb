import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Pill } from "@bb/shared-ui/pill";
import { Switch } from "@bb/shared-ui/switch";
import {
  ResourceListPanel,
  ResourceRow,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { appToast } from "@/components/ui/app-toast.js";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  setPluginEnabled,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginNeedsAttention } from "@/hooks/usePluginAttention";
import { cn, formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  pluginRowSignal,
  pluginRuntimeStatusPresentation,
} from "./plugin-status";
import { PluginRowSignalView, PluginSignalLogo } from "./PluginRowSignal";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import { PluginLogo } from "./plugin-ui";

interface InstalledPluginProblemLine {
  text: string;
  tone: "error" | "warning";
  attentionCount: string | null;
}

function oneLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
}

function withProblemTime(
  text: string,
  plugin: PluginListItem,
  now: number,
): string {
  return plugin.lastProblem === null
    ? text
    : `${text} · ${formatRelativeTime({ timestamp: plugin.lastProblem.at, now })}`;
}

function installedPluginProblemLine(
  plugin: PluginListItem,
  now = Date.now(),
): InstalledPluginProblemLine | null {
  if (!plugin.enabled || plugin.status === "disabled") return null;
  const message = oneLine(
    plugin.lastProblem?.message ?? plugin.statusDetail ?? "",
  );
  if (
    plugin.status === "running" &&
    plugin.statusDetail?.startsWith("reload failed:")
  ) {
    const detail = message || oneLine(plugin.statusDetail.slice(14));
    return {
      text: withProblemTime(
        `Running the previous version — reload failed: ${detail}`,
        plugin,
        now,
      ),
      tone: "error",
      attentionCount: null,
    };
  }
  if (plugin.status === "running" && plugin.handlerStats.errorCount > 0) {
    const count = plugin.handlerStats.errorCount;
    const countText = `${count} ${count === 1 ? "error" : "errors"}`;
    const last =
      plugin.lastProblem === null
        ? ""
        : `, last ${formatRelativeTime({ timestamp: plugin.lastProblem.at, now })}`;
    return {
      text: message.length === 0 ? last : `${last} — ${message}`,
      tone: "warning",
      attentionCount: countText,
    };
  }
  switch (plugin.status) {
    case "running":
      return null;
    case "incompatible":
      return {
        text: withProblemTime(
          `Not running — ${message || "incompatible with this version of bb"}`,
          plugin,
          now,
        ),
        tone: "error",
        attentionCount: null,
      };
    case "error":
      return {
        text: withProblemTime(
          `Not running — crashed on load: ${message || "unknown error"}`,
          plugin,
          now,
        ),
        tone: "error",
        attentionCount: null,
      };
    case "missing":
      return {
        text: withProblemTime(
          `Not running — source missing at ${formatHomePathForDisplay(plugin.rootDir)}`,
          plugin,
          now,
        ),
        tone: "error",
        attentionCount: null,
      };
    case "degraded":
      return {
        text: withProblemTime(
          `Partly running — ${message || "a background service did not stop"}`,
          plugin,
          now,
        ),
        tone: "warning",
        attentionCount: null,
      };
    case "needs-configuration":
      return {
        text: withProblemTime(
          "Not running — needs configuration in its settings",
          plugin,
          now,
        ),
        tone: "warning",
        attentionCount: null,
      };
  }
}

export function InstalledPluginsTab({
  plugins,
}: {
  plugins: readonly PluginListItem[];
}) {
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null);
  const updateTarget =
    updateTargetId === null
      ? null
      : (plugins.find((plugin) => plugin.id === updateTargetId) ?? null);

  if (plugins.length === 0) {
    return (
      <EmptyState message="No plugins installed. Browse the catalog, create a plugin, or run bb plugin install <source>." />
    );
  }

  return (
    <>
      <ResourceListPanel>
        <div className="divide-y divide-border">
          {plugins.map((plugin) => (
            <InstalledPluginRow
              key={plugin.id}
              plugin={plugin}
              onUpdateClick={() => setUpdateTargetId(plugin.id)}
            />
          ))}
        </div>
      </ResourceListPanel>
      {updateTarget !== null ? (
        <UpdatePluginDialog
          plugin={updateTarget}
          open
          onOpenChange={(open) => {
            if (!open) setUpdateTargetId(null);
          }}
        />
      ) : null}
    </>
  );
}

export function InstalledPluginRow({
  plugin,
  onUpdateClick,
}: {
  plugin: PluginListItem;
  onUpdateClick: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setPluginEnabled(fetch, plugin.id, enabled),
    onError: (error, enabled) => {
      appToast.error(
        `${enabled ? "Enabling" : "Disabling"} ${plugin.id} failed`,
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
    onSettled: () => invalidatePluginList({ queryClient }),
  });
  const enabled = toggle.isPending ? toggle.variables : plugin.enabled;
  const signal = pluginRowSignal(plugin);
  const statusSignal = signal?.kind === "status" ? signal : null;
  const updateSignal = signal?.kind === "update" ? signal : null;
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  const problemLine = installedPluginProblemLine(plugin);
  const notRunning = pluginNeedsAttention({
    enabled: enabled === true,
    status: plugin.status,
  });
  const runtimeStatusToneClass =
    runtimeStatus?.tone === "error"
      ? "text-destructive-text"
      : "text-warning-text";

  const openDetail = () =>
    navigate(
      getPluginDetailRoutePath({ pluginId: plugin.id, view: "installed" }),
    );
  return (
    <div data-testid={`plugin-row-${plugin.id}`}>
      <ResourceRow
        className={
          problemLine?.tone === "error"
            ? "-mx-2 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 text-destructive-text"
            : undefined
        }
        leading={
          <PluginSignalLogo signal={statusSignal} onStatusClick={openDetail}>
            <PluginLogo plugin={plugin} className="size-6 shrink-0" />
          </PluginSignalLogo>
        }
        title={plugin.name ?? plugin.id}
        titleMeta={
          plugin.publisherLabel === null ? undefined : (
            <ProvenancePill label={plugin.publisherLabel} />
          )
        }
        status={
          problemLine !== null || runtimeStatus === null ? undefined : (
            <span
              data-testid={`plugin-runtime-status-${plugin.id}`}
              className={cn(
                "shrink-0 text-xs font-medium",
                runtimeStatusToneClass,
              )}
            >
              {runtimeStatus.label}
            </span>
          )
        }
        description={
          problemLine === null ? (
            runtimeStatus === null ? (
              plugin.description
            ) : (
              (plugin.statusDetail ?? runtimeStatus.condition)
            )
          ) : (
            <span
              data-testid={`plugin-problem-line-${plugin.id}`}
              className={cn(
                "inline-flex min-w-0 items-center gap-1",
                problemLine.tone === "error"
                  ? "text-destructive-text"
                  : "text-warning-text",
              )}
            >
              {problemLine.attentionCount === null ? null : (
                <Pill
                  variant="outline"
                  className="border-transparent bg-surface-attention text-warning-text"
                >
                  {problemLine.attentionCount}
                </Pill>
              )}
              {problemLine.text === "" ? null : (
                <span className="min-w-0 truncate">{problemLine.text}</span>
              )}
            </span>
          )
        }
        openLabel={`${plugin.name ?? plugin.id} plugin details`}
        onOpen={openDetail}
        trailingMeta={
          updateSignal !== null ? (
            <span data-testid={`plugin-update-signal-${plugin.id}`}>
              <PluginRowSignalView
                signal={updateSignal}
                onUpdateClick={onUpdateClick}
                onStatusClick={openDetail}
              />
            </span>
          ) : undefined
        }
        persistentActions={
          <>
            {notRunning && problemLine === null ? (
              <span
                data-testid={`plugin-not-running-${plugin.id}`}
                className={cn(
                  "mr-1 text-2xs font-medium",
                  runtimeStatusToneClass,
                )}
              >
                not running
              </span>
            ) : null}
            <Switch
              checked={enabled}
              disabled={toggle.isPending}
              onCheckedChange={(next) => toggle.mutate(next)}
              aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.id}${
                notRunning ? ` (${plugin.status}, not running)` : ""
              }`}
            />
          </>
        }
        trailingVisual={<ResourceRowDetailChevron />}
      />
    </div>
  );
}
