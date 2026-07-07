import type { ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Card } from "@bb/shared-ui/card";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { Switch } from "@bb/shared-ui/switch";
import type { PillVariant } from "@bb/shared-ui/pill";
import type {
  PluginStatus,
  ToolAutomation,
  ToolKind,
  ToolPlugin,
  ToolSkill,
} from "./types";

/**
 * Per-kind identity is carried as a *full* card-border tint and a tinted icon
 * chip — never a one-sided accent bar. The three proposed accent hues are
 * injected here (with a `.dark` re-anchor, mirroring theme.css's own light/dark
 * split) so both modes retint automatically; cards opt in with `data-tool-kind`
 * / `data-tool-chip` attributes. Everything else is a real theme token.
 *
 * Render <ToolKindAccentStyles /> once at the root of any surface that shows
 * kind-tinted cards or chips (the overview and the detail scaffold both do).
 */
export function ToolKindAccentStyles() {
  return (
    <style>{`
      :root {
        --skill-accent: oklch(0.55 0.16 272);
        --automation-accent: oklch(0.60 0.115 195);
        --plugin-accent: oklch(0.56 0.16 322);
      }
      .dark {
        --skill-accent: oklch(0.72 0.15 272);
        --automation-accent: oklch(0.76 0.11 195);
        --plugin-accent: oklch(0.73 0.15 322);
      }
      [data-tool-kind="skill"] { border-color: color-mix(in oklab, var(--skill-accent) 30%, var(--border)); }
      [data-tool-kind="automation"] { border-color: color-mix(in oklab, var(--automation-accent) 30%, var(--border)); }
      [data-tool-kind="plugin"] { border-color: color-mix(in oklab, var(--plugin-accent) 30%, var(--border)); }
      [data-tool-interactive="true"][data-tool-kind="skill"]:hover { border-color: color-mix(in oklab, var(--skill-accent) 55%, var(--border)); }
      [data-tool-interactive="true"][data-tool-kind="automation"]:hover { border-color: color-mix(in oklab, var(--automation-accent) 55%, var(--border)); }
      [data-tool-interactive="true"][data-tool-kind="plugin"]:hover { border-color: color-mix(in oklab, var(--plugin-accent) 55%, var(--border)); }
      [data-tool-chip="skill"] { background: color-mix(in oklab, var(--skill-accent) 16%, transparent); color: var(--skill-accent); }
      [data-tool-chip="automation"] { background: color-mix(in oklab, var(--automation-accent) 16%, transparent); color: var(--automation-accent); }
      [data-tool-chip="plugin"] { background: color-mix(in oklab, var(--plugin-accent) 16%, transparent); color: var(--plugin-accent); }
    `}</style>
  );
}

export type ChipTone = ToolKind | "neutral";

const CHIP_BOX: Record<"sm" | "md" | "lg", string> = {
  sm: "size-5",
  md: "size-7",
  lg: "size-9",
};

const CHIP_ICON: Record<"sm" | "md" | "lg", string> = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

export function ToolChip({
  icon,
  tone,
  size = "md",
}: {
  icon: IconName;
  tone: ChipTone;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      data-tool-chip={tone}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        CHIP_BOX[size],
        tone === "neutral" && "bg-surface-recessed-solid text-muted-foreground",
      )}
    >
      <Icon name={icon} aria-hidden="true" className={CHIP_ICON[size]} />
    </span>
  );
}

export type DotTone = "success" | "destructive" | "muted";

export function StatusDot({
  tone,
  pulse = false,
}: {
  tone: DotTone;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "destructive" && "bg-destructive",
        tone === "muted" && "bg-muted-foreground/60",
        pulse && "animate-pulse ring-4 ring-success/20",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared card shell — one shape, kind-specific metadata line.
// ---------------------------------------------------------------------------

export interface CardShellProps {
  kind: ToolKind;
  accented: boolean;
  chip: ReactNode;
  title: string;
  /** Optional small line under the title; most cards omit it (name + desc only). */
  subtitle?: ReactNode;
  /** Optional 2-line blurb. Automations omit it — their PR rows carry none. */
  description?: string;
  /** Optional bottom row (status + on/off). Skills — plain files — have none. */
  footer?: ReactNode;
  /** Optional trailing node in the top row (e.g. a registry topic Pill). */
  topRight?: ReactNode;
}

export function CardShell({
  kind,
  accented,
  chip,
  title,
  subtitle,
  description,
  footer,
  topRight,
}: CardShellProps) {
  return (
    <Card
      data-tool-kind={accented ? kind : undefined}
      data-tool-interactive="true"
      className={cn(
        "relative flex flex-col p-3.5 transition-[border-color,box-shadow] hover:shadow-sm",
        "has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring",
        !accented && "opacity-95",
      )}
    >
      <div className="mb-2.5 flex gap-2.5">
        {chip}
        <div className="min-w-0 flex-1">
          {/* Whole-card link: the title anchor's stretched ::after covers the
              card, so a click anywhere navigates — while the footer control,
              raised above it, stays independently clickable. */}
          <a
            href="#tool"
            onClick={(event) => event.preventDefault()}
            className="block truncate text-sm font-semibold text-foreground outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
          >
            {title}
          </a>
          {subtitle ? (
            <div className="mt-0.5 truncate text-2xs text-subtle-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
        {topRight ? <div className="relative z-10 shrink-0">{topRight}</div> : null}
      </div>
      {description ? (
        <p className="line-clamp-2 min-h-[2.6em] text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {footer ? (
        <div className="relative z-10 mt-3 flex items-center justify-between gap-2">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-kind derivations
// ---------------------------------------------------------------------------

function automationChipIcon(kind: ToolAutomation["kind"]): IconName {
  return kind === "script" ? "Terminal" : "Reload";
}

function automationStatus(automation: ToolAutomation): {
  tone: DotTone;
  pulse: boolean;
  label: string;
} {
  if (!automation.enabled) return { tone: "muted", pulse: false, label: "Paused" };
  switch (automation.lastRunStatus) {
    case "running":
      return { tone: "success", pulse: true, label: "Running now" };
    case "succeeded":
      return { tone: "success", pulse: false, label: "Succeeded" };
    case "failed":
      return { tone: "destructive", pulse: false, label: "Failed" };
    case "skipped":
      return { tone: "muted", pulse: false, label: "Skipped" };
    default:
      return { tone: "muted", pulse: false, label: "Not run yet" };
  }
}

const PLUGIN_STATUS_LABEL: Record<PluginStatus, string> = {
  running: "running",
  "needs-configuration": "needs configuration",
  error: "error",
  disabled: "disabled",
};

const PLUGIN_STATUS_VARIANT: Record<PluginStatus, PillVariant> = {
  running: "secondary",
  "needs-configuration": "outline",
  error: "destructive",
  disabled: "outline",
};

// ---------------------------------------------------------------------------
// ToolCard — one presentational card, discriminated by kind.
// ---------------------------------------------------------------------------

export type ToolCardProps =
  | { kind: "skill"; skill: ToolSkill }
  | {
      kind: "automation";
      automation: ToolAutomation;
      onToggle?: (enabled: boolean) => void;
    }
  | {
      kind: "plugin";
      plugin: ToolPlugin;
      onToggle?: (enabled: boolean) => void;
    };

export function ToolCard(props: ToolCardProps) {
  if (props.kind === "skill") {
    const { skill } = props;
    return (
      <CardShell
        kind="skill"
        accented
        chip={<ToolChip icon="Zap" tone="skill" />}
        title={skill.name}
        description={skill.description}
      />
    );
  }

  if (props.kind === "automation") {
    const { automation, onToggle } = props;
    const status = automationStatus(automation);
    return (
      <CardShell
        kind="automation"
        accented={automation.enabled}
        chip={
          <ToolChip
            icon={automationChipIcon(automation.kind)}
            tone={automation.enabled ? "automation" : "neutral"}
          />
        }
        title={automation.name}
        footer={
          <>
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-2xs text-muted-foreground">
              <StatusDot tone={status.tone} pulse={status.pulse} />
              {automation.enabled
                ? automation.nextRunAt
                  ? `Next ${automation.nextRunAt}`
                  : automation.schedule
                : "Paused"}
            </span>
            <Switch
              checked={automation.enabled}
              onCheckedChange={onToggle}
              aria-label={
                automation.enabled
                  ? `Disable ${automation.name}`
                  : `Enable ${automation.name}`
              }
            />
          </>
        }
      />
    );
  }

  const { plugin, onToggle } = props;
  return (
    <CardShell
      kind="plugin"
      accented={plugin.enabled}
      chip={
        <ToolChip
          icon={plugin.icon ?? "Plug"}
          tone={plugin.enabled ? "plugin" : "neutral"}
        />
      }
      title={plugin.id}
      description={plugin.description}
      footer={
        <>
          <Pill variant={PLUGIN_STATUS_VARIANT[plugin.status]} size="sm">
            {PLUGIN_STATUS_LABEL[plugin.status]}
          </Pill>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={onToggle}
            aria-label={
              plugin.enabled ? `Disable ${plugin.id}` : `Enable ${plugin.id}`
            }
          />
        </>
      }
    />
  );
}
