import type { ReactNode } from "react";
import type { PluginCapability } from "@bb/server-contract";
import {
  ResourceDetailCollection,
  ResourceDetailListItem,
} from "@bb/shared-ui/resource-list";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { formatAbsoluteDate } from "@/components/plugin/management/plugin-ui";
import type { PluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  usePluginSettingsView,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePluginSlots, type PluginSlotSnapshot } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";

function pluginActivityIcon(
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null,
): { name: IconName; className: string; label: string } {
  if (state === "running" || state === "ok") {
    return {
      name: "CircleCheck",
      className: "text-success",
      label: "Healthy",
    };
  }
  if (state === "backoff") {
    return {
      name: "AlertTriangle",
      className: "text-warning",
      label: "Retrying",
    };
  }
  if (state === "error") {
    return { name: "CircleX", className: "text-destructive", label: "Failed" };
  }
  if (state === null) {
    return {
      name: "Clock",
      className: "text-muted-foreground",
      label: "No runs yet",
    };
  }
  return {
    name: "Pause",
    className: "text-muted-foreground",
    label: "Stopped",
  };
}

function PluginActivityState({
  state,
  resourceLabel,
}: {
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null;
  resourceLabel: string;
}) {
  const icon = pluginActivityIcon(state);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={`${resourceLabel}: ${icon.label}`}
            className="inline-flex"
          >
            <Icon
              name={icon.name}
              className={cn("size-4", icon.className)}
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{icon.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface PluginCapabilityItem {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
}

function namedSurface(
  prefix: string,
  id: string,
  title: string | undefined,
  describe: (label: string) => string,
): PluginCapabilityItem {
  const label = title?.trim() || id;
  return {
    key: `${prefix}:${id}`,
    label,
    detail: describe(label),
    mono: label === id,
  };
}

function namedSlotItems(
  pluginId: string,
  slots: readonly { pluginId: string; id: string; title?: string }[],
  prefix: string,
  describe: (label: string) => string,
): PluginCapabilityItem[] {
  return slots
    .filter((slot) => slot.pluginId === pluginId)
    .map((slot) => namedSurface(prefix, slot.id, slot.title, describe));
}

function pluginAppSurfaceItems(
  plugin: PluginListItem,
  slots: PluginSlotSnapshot,
): PluginCapabilityItem[] {
  const pluginId = plugin.id;
  const namedSlots = [
    [slots.navPanels, "nav", (label: string) => `Open ${label} in bb.`],
    [
      slots.homepageSections,
      "homepage",
      (label: string) => `Show ${label} on the homepage.`,
    ],
    [
      slots.threadPanelActions,
      "thread-panel",
      (label: string) => `Open ${label} from a thread.`,
    ],
    [
      slots.pendingInteractions,
      "input",
      (label: string) => `Collect input for ${label}.`,
    ],
    [
      slots.sidebarFooterActions,
      "sidebar",
      (label: string) => `Open ${label} from the sidebar.`,
    ],
    [
      slots.messageActions,
      "message-action",
      (label: string) => `Run ${label} on a thread message.`,
    ],
  ] as const;
  return [
    ...namedSlots.flatMap(([items, prefix, describe]) =>
      namedSlotItems(pluginId, items, prefix, describe),
    ),
    ...slots.composerCustomizations
      .filter((slot) => slot.pluginId === pluginId)
      .flatMap((slot) => [
        ...(slot.actions ?? []).map((action) =>
          namedSurface(
            `composer:${slot.id}:action`,
            action.id,
            undefined,
            (label) => `Run ${label} from the composer.`,
          ),
        ),
        ...(slot.banners ?? []).map((banner) =>
          namedSurface(
            `composer:${slot.id}:banner`,
            banner.id,
            undefined,
            (label) => `Show ${label} above the composer.`,
          ),
        ),
        ...(slot.plusMenu ?? []).map((item) =>
          namedSurface(
            `composer:${slot.id}:plus-menu`,
            item.id,
            item.label,
            (label) =>
              item.description ??
              `Add ${label.toLowerCase()} from the composer.`,
          ),
        ),
        ...(slot.richText?.effects ?? []).map((effect) =>
          namedSurface(
            `composer:${slot.id}:rich-text`,
            effect.id,
            undefined,
            (label) => `Apply ${label} while composing.`,
          ),
        ),
      ]),
    ...slots.fileOpeners
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        ...namedSurface(
          "file",
          slot.id,
          slot.title,
          (label) =>
            `Open ${slot.extensions
              .map((extension) => `.${extension}`)
              .join(", ")} files with ${label}.`,
        ),
      })),
    ...slots.messageDirectives
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        key: `directive:${slot.id}`,
        label: `::${slot.id}`,
        detail: `Render ::${slot.id} content inside assistant messages.`,
        mono: true,
      })),
  ];
}

function pluginServiceDescription(plugin: PluginListItem): string {
  const name = plugin.name ?? plugin.id;
  return plugin.description
    ? `Runs in the background. ${plugin.description}`
    : `Runs ${name} work in the background.`;
}

function pluginScheduleDescription(
  plugin: PluginListItem,
  cron: string,
): string {
  const purpose =
    plugin.description ??
    `Runs scheduled work for ${plugin.name ?? plugin.id}.`;
  return `Runs on ${cron}. ${purpose}`;
}

function PluginCapabilityGroup({
  icon,
  label,
  items,
}: {
  icon: IconName;
  label: string;
  items: readonly PluginCapabilityItem[];
}) {
  return (
    <ResourceDetailListItem
      className="items-start px-3 py-3"
      leading={
        <Icon
          name={icon}
          className="mt-0.5 size-4 text-muted-foreground"
          aria-hidden
        />
      }
    >
      <span data-plugin-capability-group className="block font-medium">
        {label}
      </span>
      <ul className="mt-2.5 space-y-2.5">
        {items.map((item) => (
          <li key={item.key} className="min-w-0">
            <span
              className={cn(
                "block break-words text-sm leading-snug text-foreground",
                item.mono && "break-all font-mono",
              )}
            >
              {item.label}
            </span>
            {item.detail ? (
              <span className="mt-0.5 block min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </ResourceDetailListItem>
  );
}

export function PluginIncludes({
  plugin,
  hasSettings,
}: {
  plugin: PluginListItem;
  hasSettings: boolean;
}) {
  const slots = usePluginSlots();
  const settingsQuery = usePluginSettingsView(plugin.id, {
    enabled: plugin.hasSettings,
  });
  const settingsSections = slots.settingsSections.filter(
    (slot) => slot.pluginId === plugin.id,
  );
  const appItems = pluginAppSurfaceItems(plugin, slots);
  if (
    plugin.app.hasApp &&
    appItems.length === 0 &&
    settingsSections.length === 0
  ) {
    appItems.push({
      key: "frontend-app",
      label: "Frontend app",
      detail:
        plugin.description ??
        `Provides ${plugin.name ?? plugin.id} screens while its app is loaded.`,
    });
  }

  const settingsItems: PluginCapabilityItem[] = [
    ...Object.entries(settingsQuery.data?.schema ?? {}).map(
      ([key, descriptor]) => ({
        key: `setting:${key}`,
        label: descriptor.label,
        detail:
          descriptor.description ??
          `Configure ${descriptor.label.toLowerCase()}.`,
      }),
    ),
    ...settingsSections.map((slot) => {
      const item = namedSurface(
        "settings-section",
        slot.id,
        slot.title,
        (label) => slot.description ?? `Configure ${label} in Settings.`,
      );
      return item;
    }),
  ];
  if (hasSettings && settingsItems.length === 0) {
    settingsItems.push({
      key: "settings",
      label: "Configurable behavior",
      detail: settingsQuery.isLoading
        ? "Loading setting names…"
        : "Setting names are unavailable",
    });
  }

  const declared = (kind: PluginCapability["kind"]): PluginCapabilityItem[] =>
    plugin.capabilities
      .filter((capability) => capability.kind === kind)
      .map((capability) => ({
        key: `${capability.kind}:${capability.id}`,
        label: capability.label,
        detail:
          capability.detail ??
          (kind === "theme"
            ? `Apply the ${capability.label} theme to bb.`
            : kind === "skill"
              ? `Teach agents how to use ${capability.label}.`
              : `Use ${capability.label} in bb.`),
        mono: kind === "skill" || kind === "agent-tool",
      }));

  const groups: Array<{
    icon: IconName;
    label: string;
    items: PluginCapabilityItem[];
  }> = [
    { icon: "AppWindow", label: "App surfaces", items: appItems },
    {
      icon: "Terminal",
      label: "Command",
      items: plugin.cliCommand
        ? [
            {
              key: plugin.cliCommand.name,
              label: `bb ${plugin.cliCommand.name}`,
              detail: plugin.cliCommand.summary || undefined,
              mono: true,
            },
          ]
        : [],
    },
    { icon: "Settings", label: "Settings", items: settingsItems },
    { icon: "Explore", label: "Skills", items: declared("skill") },
    { icon: "Toolbox", label: "Agent tools", items: declared("agent-tool") },
    {
      icon: "MessageCirclePlus",
      label: "Thread integrations",
      items: declared("thread-integration"),
    },
    { icon: "Palette", label: "Themes", items: declared("theme") },
    {
      icon: "Workflow",
      label: "Services",
      items: plugin.services.map((service) => ({
        key: service.name,
        label: service.name,
        detail: pluginServiceDescription(plugin),
        mono: true,
      })),
    },
    {
      icon: "TimeSchedule",
      label: "Schedules",
      items: plugin.schedules.map((schedule) => ({
        key: schedule.name,
        label: schedule.name,
        detail: pluginScheduleDescription(plugin, schedule.cron),
        mono: true,
      })),
    },
  ];
  const populated = groups.filter(({ items }) => items.length > 0);

  // Commands, settings, agent tools, thread integrations and app surfaces are
  // only observable on a *running* plugin — not merely an enabled one. A
  // plugin that is enabled but failed to load, or is still loading, reports
  // none of them, so keying this off `enabled` would tell the user it declares
  // nothing when the truth is that we cannot see yet.
  // "needs-configuration" is set on a *loaded* plugin, so its tools, slots and
  // settings are registered and its capabilities do render — it just cannot do
  // useful work yet. Treating it as not-running would caption a populated list
  // with "this plugin isn't running".
  const live =
    plugin.status === "running" || plugin.status === "needs-configuration";
  const liveCapabilitiesNote = plugin.enabled
    ? "This plugin isn't running, so its commands, settings, agent tools, app surfaces, and thread integrations can't be listed."
    : "Commands, settings, agent tools, app surfaces, and thread integrations are listed once this plugin is enabled.";

  // Includes is a stable part of the plugin recipe, so it explains an empty
  // result rather than disappearing.
  if (populated.length === 0) {
    return (
      <EmptyStatePanel className="py-6">
        {live
          ? "This plugin declares no user-facing capabilities."
          : plugin.enabled
            ? "This plugin isn't running yet, so what it adds can't be listed."
            : "Enable this plugin to see what it adds to bb."}
      </EmptyStatePanel>
    );
  }

  return (
    <ResourceDetailCollection>
      {populated.map(({ icon, label, items }) => (
        <PluginCapabilityGroup
          key={label}
          icon={icon}
          label={label}
          items={items}
        />
      ))}
      {live ? null : (
        <ResourceDetailListItem
          leading={
            <Icon
              name="Info"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
          }
        >
          <span className="block text-xs text-muted-foreground">
            {liveCapabilitiesNote}
          </span>
        </ResourceDetailListItem>
      )}
    </ResourceDetailCollection>
  );
}

export function PluginActivity({
  plugin,
  runtimeStatus,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation | null;
}) {
  const showOverallState = plugin.enabled && runtimeStatus !== null;
  const hasHandlerErrors = plugin.handlerStats.errorCount > 0;
  if (
    !showOverallState &&
    !hasHandlerErrors &&
    plugin.services.length === 0 &&
    plugin.schedules.length === 0
  ) {
    return null;
  }
  return (
    <ResourceDetailCollection>
      {showOverallState && runtimeStatus !== null ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name={
                runtimeStatus.tone === "error" ? "CircleX" : "AlertTriangle"
              }
              className={cn(
                "size-4",
                runtimeStatus.tone === "error"
                  ? "text-destructive"
                  : "text-warning",
              )}
              aria-hidden
            />
          }
        >
          <span className="block">{runtimeStatus.label}</span>
          {plugin.statusDetail ? (
            <span className="block text-xs text-muted-foreground">
              {plugin.statusDetail}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Next:</span>{" "}
            {runtimeStatus.recovery}
          </span>
        </ResourceDetailListItem>
      ) : null}
      {plugin.services.map((service) => (
        <ResourceDetailListItem
          key={service.name}
          leading={<Icon name="Workflow" className="size-4" aria-hidden />}
          trailing={
            <PluginActivityState
              state={service.state}
              resourceLabel={service.name}
            />
          }
        >
          <span className="block">{service.name}</span>
          <span className="block text-xs text-muted-foreground">
            {pluginServiceDescription(plugin)}
          </span>
        </ResourceDetailListItem>
      ))}
      {plugin.schedules.map((schedule) => (
        <ResourceDetailListItem
          key={schedule.name}
          leading={<Icon name="TimeSchedule" className="size-4" aria-hidden />}
          trailing={
            <PluginActivityState
              state={schedule.lastStatus}
              resourceLabel={schedule.name}
            />
          }
        >
          <span className="block">{schedule.name}</span>
          {schedule.lastError ? (
            <span className="block text-xs text-destructive">
              {schedule.lastError}
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">
              Next {formatAbsoluteDate(schedule.nextRunAt)}
            </span>
          )}
        </ResourceDetailListItem>
      ))}
      {hasHandlerErrors ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name="AlertCircle"
              className="size-4 text-destructive"
              aria-hidden
            />
          }
        >
          {plugin.handlerStats.errorCount} handler{" "}
          {plugin.handlerStats.errorCount === 1 ? "error" : "errors"}
        </ResourceDetailListItem>
      ) : null}
    </ResourceDetailCollection>
  );
}
