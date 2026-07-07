import { useState, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { Switch } from "@bb/shared-ui/switch";
import { StatusDot, type DotTone } from "./ToolCard";
import type {
  AutomationDetail,
  AutomationRunEntry,
  PluginDetail,
  SkillDetail,
  SkillReadmeBlock,
  ToolAutomation,
  ToolPlugin,
  ToolSkill,
} from "./types";

// ---------------------------------------------------------------------------
// Detail pages. These deliberately mirror the *existing PR-branch* detail
// views — the skill detail (ported from SkillDetailDialogView, a dialog → a
// full page) and the automation detail (DetailView, already a centered full
// page). Kept minimal and aligned so all three read as the same kind of page:
// one centered max-w-3xl column, a back link, a title row, then the body.
// Separators are full-enclosure cards/panels or spacing — never a row divider.
// ---------------------------------------------------------------------------

function DetailPage({
  backLabel,
  children,
}: {
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="mx-auto w-full max-w-3xl px-5 pt-4 pb-8">
        <a
          href="#back"
          onClick={(event) => event.preventDefault()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="ChevronLeft" aria-hidden="true" className="size-3.5" />
          {backLabel}
        </a>
        <div className="mt-4 space-y-6">{children}</div>
      </div>
    </div>
  );
}

/** Uppercase section label, matching the PR automation detail's run-history. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase text-muted-foreground">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Skill detail — full-page port of SkillDetailDialogView (was a Dialog).
// ---------------------------------------------------------------------------

function ReadmeBlock({ block }: { block: SkillReadmeBlock }) {
  if (block.type === "heading") {
    return (
      <h4 className="mt-2.5 mb-1 text-sm font-semibold text-foreground first:mt-0">
        {block.text}
      </h4>
    );
  }
  if (block.type === "code") {
    return (
      <code className="mt-1 block rounded-sm border border-border bg-surface-recessed-solid px-3 py-2.5 font-mono text-xs text-muted-foreground">
        {block.text}
      </code>
    );
  }
  return <p className="mb-2 text-sm text-muted-foreground">{block.text}</p>;
}

function SkillDetailPage({
  skill,
  detail,
}: {
  skill: ToolSkill;
  detail: SkillDetail;
}) {
  return (
    <DetailPage backLabel="Skills">
      {/* Title row — Zap · name · scope pill · actions (Edit + overflow), the
          same content the PR dialog header carried, now inline on a page. */}
      <div className="flex items-center gap-2">
        <Icon
          name="Zap"
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
          {skill.name}
        </h1>
        <Pill variant="outline" size="sm" className="ml-1 shrink-0">
          {skill.provider} · {skill.scope}
        </Pill>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline">
            <Icon name={skill.manageable ? "Edit" : "Copy"} aria-hidden="true" />
            {skill.manageable ? "Edit" : "Duplicate to edit"}
          </Button>
          <Button size="icon" variant="outline" aria-label="Skill actions">
            <Icon name="MoreHorizontal" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* SKILL.md — a bordered, scrollable preview (the PR dialog's body). */}
      <div>
        <SectionLabel>SKILL.md</SectionLabel>
        <div className="mt-2 max-h-[60dvh] overflow-auto rounded-md border border-border bg-surface-raised px-4 py-3">
          {detail.readme.map((block, index) => (
            <ReadmeBlock key={index} block={block} />
          ))}
        </div>
      </div>
    </DetailPage>
  );
}

// ---------------------------------------------------------------------------
// Automation detail — mirrors the PR-branch DetailView (centered full page).
// ---------------------------------------------------------------------------

const RUN_TONE_CLASS: Record<AutomationRunEntry["status"], string> = {
  running: "text-foreground",
  succeeded: "text-foreground",
  failed: "text-destructive-text",
};

function RunRow({ run }: { run: AutomationRunEntry }) {
  const leading =
    run.status === "running" ? (
      <StatusDot tone="success" pulse />
    ) : (
      <Icon
        name={run.status === "succeeded" ? "Check" : "AlertCircle"}
        aria-hidden="true"
        className="size-3.5 text-muted-foreground"
      />
    );
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className="flex w-3.5 shrink-0 justify-center">{leading}</span>
        <span className={cn("min-w-0 flex-1 truncate", RUN_TONE_CLASS[run.status])}>
          {run.label}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {run.timestamp}
        </span>
      </div>
    </div>
  );
}

function automationDotTone(automation: ToolAutomation): DotTone {
  if (!automation.enabled) return "muted";
  if (automation.lastRunStatus === "failed") return "destructive";
  return "success";
}

function AutomationDetailPage({
  automation,
  detail,
}: {
  automation: ToolAutomation;
  detail: AutomationDetail;
}) {
  return (
    <DetailPage backLabel="Automations">
      {/* Header block + muted trigger/execution/prompt lines — the PR layout. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusDot tone={automationDotTone(automation)} />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {automation.name}
          </h1>
          {automation.kind === "script" ? (
            <Pill variant="outline" size="sm">
              Script
            </Pill>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{automation.schedule}</p>
        <p className="text-xs text-muted-foreground">{detail.execution}</p>
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {detail.prompt}
        </p>
      </div>

      {/* Action row — Pause/Resume · Run now · Delete (the PR order + icons). */}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm">
          <Icon
            name={automation.enabled ? "Pause" : "Play"}
            aria-hidden="true"
          />
          {automation.enabled ? "Pause" : "Resume"}
        </Button>
        <Button type="button" variant="outline" size="sm">
          <Icon name="Zap" aria-hidden="true" />
          Run now
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          <Icon name="Trash2" aria-hidden="true" />
          Delete
        </Button>
      </div>

      <section className="space-y-2">
        <SectionLabel>Run history</SectionLabel>
        <div className="space-y-2">
          {detail.runs.map((run, index) => (
            <RunRow key={index} run={run} />
          ))}
        </div>
      </section>
    </DetailPage>
  );
}

// ---------------------------------------------------------------------------
// Plugin detail — aligned to the same page shell (settings + permissions).
// ---------------------------------------------------------------------------

function SettingInput({
  placeholder,
  icon,
}: {
  placeholder: string;
  icon?: IconName;
}) {
  return (
    <div className="flex h-8 w-[220px] shrink-0 items-center gap-2 rounded-md border border-input bg-background px-2.5">
      {icon ? (
        <Icon
          name={icon}
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
      ) : null}
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function PluginDetailPage({
  plugin,
  detail,
}: {
  plugin: ToolPlugin;
  detail: PluginDetail;
}) {
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [booleans, setBooleans] = useState<Record<number, boolean>>(() =>
    detail.settings.reduce<Record<number, boolean>>((acc, field, index) => {
      if (field.control.type === "boolean") acc[index] = field.control.value;
      return acc;
    }, {}),
  );
  const statusLabel: Record<ToolPlugin["status"], string> = {
    running: "running",
    "needs-configuration": "needs configuration",
    error: "error",
    disabled: "disabled",
  };

  return (
    <DetailPage backLabel="Plugins">
      <div className="flex items-center gap-2">
        <Icon
          name={plugin.icon ?? "Plug"}
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
          {plugin.id}
        </h1>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          v{plugin.version}
        </span>
        <Pill
          variant={
            plugin.status === "error"
              ? "destructive"
              : plugin.status === "running"
                ? "secondary"
                : "outline"
          }
          size="sm"
          className="shrink-0"
        >
          {statusLabel[plugin.status]}
        </Pill>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label={enabled ? `Disable ${plugin.id}` : `Enable ${plugin.id}`}
          />
          <Button size="icon" variant="outline" aria-label="Plugin actions">
            <Icon name="MoreHorizontal" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <p className="-mt-3.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="ExternalLink" aria-hidden="true" className="size-3.5" />
        {detail.source}
      </p>

      <section className="space-y-2">
        <SectionLabel>Settings</SectionLabel>
        <div className="rounded-md border border-border bg-card px-4">
          {detail.settings.map((field, index) => (
            <div
              key={field.label}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm text-foreground">{field.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {field.help}
                </div>
              </div>
              {field.control.type === "text" ? (
                <SettingInput
                  placeholder={field.control.placeholder}
                  icon={field.control.icon}
                />
              ) : (
                <Switch
                  checked={booleans[index] ?? false}
                  onCheckedChange={(checked) =>
                    setBooleans((current) => ({ ...current, [index]: checked }))
                  }
                  aria-label={field.label}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Permissions</SectionLabel>
        <div className="rounded-md border border-border bg-card px-4">
          {detail.permissions.map((permission) => (
            <div
              key={permission.text}
              className="flex items-center gap-2.5 py-2.5 text-xs"
            >
              <Icon
                name={permission.icon}
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 text-foreground">
                {permission.text}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {permission.scopeLabel}
              </span>
            </div>
          ))}
        </div>
      </section>
    </DetailPage>
  );
}

// ---------------------------------------------------------------------------
// ToolDetail — kind + entity + its detail content → a full detail page.
// ---------------------------------------------------------------------------

export type ToolDetailProps =
  | { kind: "skill"; skill: ToolSkill; detail: SkillDetail }
  | { kind: "automation"; automation: ToolAutomation; detail: AutomationDetail }
  | { kind: "plugin"; plugin: ToolPlugin; detail: PluginDetail };

export function ToolDetail(props: ToolDetailProps) {
  if (props.kind === "skill") {
    return <SkillDetailPage skill={props.skill} detail={props.detail} />;
  }
  if (props.kind === "automation") {
    return (
      <AutomationDetailPage
        automation={props.automation}
        detail={props.detail}
      />
    );
  }
  return <PluginDetailPage plugin={props.plugin} detail={props.detail} />;
}
