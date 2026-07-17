import { useState, type ReactNode } from "react";
import {
  pluginRuntimeStatusSchema,
  pluginUpdateOutcomeSchema,
  skillScopeSchema,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceInstallControl,
  ResourceInstalledControl,
  ResourceLifecycleStatus,
  ResourceMeta,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { AutomationRunStatusIndicator } from "bb-plugin-automations/detail-view";
import {
  automationRunModeSchema,
  automationRunStatusSchema,
} from "bb-plugin-automations/rpc-types";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { PluginRowSignalView } from "@/components/plugin/management/PluginRowSignal";
import {
  pluginRuntimeStatusDefinition,
  type PluginRowSignal,
} from "@/components/plugin/management/plugin-status";
import { SkillBundledPluginMetadata } from "@/components/tools/SkillDetailView";
import { SKILL_SCOPE_DEFINITIONS } from "@/components/tools/skill-taxonomy";

export default {
  title: "Tools/State galleries",
};

const noop = () => {};

function Gallery({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-6">
      <header>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      {children}
    </main>
  );
}

function StateSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <StoryCard className="m-0 divide-y divide-border border border-border bg-card">
        {children}
      </StoryCard>
    </section>
  );
}

function SurfaceRule({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs italic text-subtle-foreground">{children}</span>
  );
}

function StatefulSwitch({
  initialChecked,
  disabled = false,
  label,
}: {
  initialChecked: boolean;
  disabled?: boolean;
  label: string;
}) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={setChecked}
      aria-label={label}
    />
  );
}

function InstallStates() {
  return (
    <>
      <StoryRow label="available" hint="Resource is not installed">
        <ResourceInstallControl
          accessibleLabel="Install resource"
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="installing" hint="Install mutation is pending">
        <ResourceInstallControl
          accessibleLabel="Installing resource"
          pending
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="incompatible" hint="Install is unavailable">
        <ResourceInstallControl
          accessibleLabel="Resource is incompatible"
          disabled
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="installed" hint="Installed, but not removable here">
        <ResourceInstalledControl accessibleLabel="Resource installed" />
      </StoryRow>
      <StoryRow
        label="installed · removable"
        hint="Hover or focus the control to reveal Uninstall"
      >
        <ResourceInstalledControl
          accessibleLabel="Uninstall resource"
          onAction={noop}
        />
      </StoryRow>
      <StoryRow label="uninstalling" hint="Removal mutation is pending">
        <ResourceInstalledControl
          accessibleLabel="Uninstalling resource"
          pending
          onAction={noop}
        />
      </StoryRow>
    </>
  );
}

function pluginRuntimeSignal(
  status: (typeof pluginRuntimeStatusSchema.options)[number],
): PluginRowSignal | null {
  const definition = pluginRuntimeStatusDefinition(status);
  return definition === null
    ? null
    : {
        kind: "status",
        label: definition.label,
        tone: definition.tone,
        detail: null,
      };
}

export function Plugins() {
  return (
    <Gallery
      title="Plugin states"
      description="Every row comes from the plugin contract or a real mutation transition. Running and disabled stay in the lifecycle control; health and release never collapse into a generic attention badge."
    >
      <StateSection
        title="Installation"
        description="One shared install control is used by browse and detail surfaces."
      >
        <InstallStates />
      </StateSection>

      <StateSection
        title="Lifecycle"
        description="Enablement is an interactive compact toggle, not a written runtime badge."
      >
        <StoryRow label="running" hint="Enabled and healthy">
          <StatefulSwitch initialChecked label="Disable plugin" />
          <SurfaceRule>No written status</SurfaceRule>
        </StoryRow>
        <StoryRow label="disabled" hint="Installed but not enabled">
          <StatefulSwitch initialChecked={false} label="Enable plugin" />
          <SurfaceRule>No written status</SurfaceRule>
        </StoryRow>
        <StoryRow label="changing" hint="Enable/disable mutation is pending">
          <StatefulSwitch
            initialChecked
            disabled
            label="Changing plugin state"
          />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Runtime health"
        description="Only actionable abnormal states earn the row's single status slot."
      >
        {pluginRuntimeStatusSchema.options.map((status) => {
          const signal = pluginRuntimeSignal(status);
          return (
            <StoryRow
              key={status}
              label={status}
              hint={
                signal === null
                  ? "Represented by the lifecycle toggle"
                  : "Passive health status; details appear on hover and in Activity"
              }
            >
              {signal === null ? (
                <SurfaceRule>No health label</SurfaceRule>
              ) : (
                <PluginRowSignalView signal={signal} onUpdateClick={noop} />
              )}
            </StoryRow>
          );
        })}
      </StateSection>

      <StateSection
        title="Release"
        description="Update availability is an action. Quiet outcomes stay in the Release section instead of becoming list badges."
      >
        {pluginUpdateOutcomeSchema.options.map((outcome) => (
          <StoryRow key={outcome} label={outcome} hint="Server update outcome">
            {outcome === "update-available" ? (
              <PluginRowSignalView
                signal={{ kind: "update", version: "{version}" }}
                onUpdateClick={noop}
              />
            ) : (
              <SurfaceRule>Release section only · no row signal</SurfaceRule>
            )}
          </StoryRow>
        ))}
        <StoryRow
          label="update failed"
          hint="A failed update rolled back to the installed version"
        >
          <PluginRowSignalView
            signal={{
              kind: "status",
              label: "Update failed",
              tone: "error",
              detail: null,
            }}
            onUpdateClick={noop}
          />
        </StoryRow>
      </StateSection>
    </Gallery>
  );
}

function SkillScopeTreatment({
  scope,
}: {
  scope: (typeof skillScopeSchema.options)[number];
}) {
  const definition = SKILL_SCOPE_DEFINITIONS[scope];
  if (scope === "plugin") {
    return (
      <>
        <SkillBundledPluginMetadata
          pluginName="Documents"
          providerLabel="Codex"
        />
        <SurfaceRule>Read-only</SurfaceRule>
      </>
    );
  }
  if (scope === "bb-builtin") {
    return (
      <ResourceLifecycleStatus
        label="Built-in"
        tooltip="Ships with bb and is read-only"
      />
    );
  }
  if (definition.editability === "always") {
    return (
      <Button type="button" variant="outline" size="sm" onClick={noop}>
        Edit
      </Button>
    );
  }
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <SurfaceRule>manageable</SurfaceRule>
        <Button type="button" variant="outline" size="sm" onClick={noop}>
          Edit
        </Button>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <SurfaceRule>read-only</SurfaceRule>
        <ResourceLifecycleStatus
          label="Imported"
          tooltip={`Discovered from ${scope.startsWith("claude") ? "Claude Code" : "Codex"}`}
        />
      </span>
    </>
  );
}

export function Skills() {
  return (
    <Gallery
      title="Skill states"
      description="Skill scope determines provenance; the server's manageable flag determines whether externally discovered user/project skills can be edited."
    >
      <StateSection
        title="Installation"
        description="Registry skills use the same shared install lifecycle as plugins."
      >
        <InstallStates />
      </StateSection>

      <StateSection
        title="Provenance and editability"
        description="All eight skill scopes from the server contract, with their supported ownership treatment."
      >
        {skillScopeSchema.options.map((scope) => {
          const definition = SKILL_SCOPE_DEFINITIONS[scope];
          return (
            <StoryRow
              key={scope}
              label={scope}
              hint={`${definition.label} · ${definition.ownership}`}
            >
              <SkillScopeTreatment scope={scope} />
            </StoryRow>
          );
        })}
      </StateSection>

      <StateSection
        title="Content"
        description="The required file viewer has explicit asynchronous and editing states."
      >
        <StoryRow label="loading" hint="File content request in flight">
          <ResourceLifecycleStatus label="Loading SKILL.md…" />
        </StoryRow>
        <StoryRow label="ready" hint="Rendered file viewer">
          <ResourceLifecycleStatus label="SKILL.md" />
        </StoryRow>
        <StoryRow label="editing" hint="Editable user-owned SKILL.md">
          <Button type="button" size="sm" onClick={noop}>
            Save
          </Button>
        </StoryRow>
        <StoryRow label="error" hint="File content could not be loaded">
          <Button type="button" variant="outline" size="sm" onClick={noop}>
            Retry
          </Button>
        </StoryRow>
      </StateSection>
    </Gallery>
  );
}

function AutomationMode({
  mode,
}: {
  mode: (typeof automationRunModeSchema.options)[number];
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-foreground">
      <Icon
        name={mode === "agent" ? "Calendar" : "ComputerTerminal01"}
        className="size-4 text-muted-foreground"
        aria-hidden
      />
      {mode === "agent" ? "Agent prompt" : "Script"}
    </span>
  );
}

export function Automations() {
  return (
    <Gallery
      title="Automation states"
      description="Lifecycle, execution definition, schedule, and run history remain separate so a simple automation and a complex script automation use the same system."
    >
      <StateSection
        title="Lifecycle"
        description="Automation enablement uses the same compact control size as plugins."
      >
        <StoryRow label="enabled" hint="Eligible for its next scheduled run">
          <StatefulSwitch initialChecked label="Pause automation" />
          <ResourceLifecycleStatus label="Next scheduled run" />
        </StoryRow>
        <StoryRow label="paused" hint="Retained but not scheduled">
          <StatefulSwitch initialChecked={false} label="Resume automation" />
          <ResourceLifecycleStatus label="Paused" />
        </StoryRow>
        <StoryRow label="not scheduled" hint="Enabled without a next run">
          <StatefulSwitch initialChecked label="Pause automation" />
          <ResourceLifecycleStatus label="Not scheduled" />
        </StoryRow>
        <StoryRow
          label="completed"
          hint="A one-shot automation that has already run"
        >
          <StatefulSwitch
            initialChecked={false}
            disabled
            label="Completed automation"
          />
          <ResourceLifecycleStatus label="Completed" />
        </StoryRow>
        <StoryRow label="changing" hint="Pause/resume mutation is pending">
          <StatefulSwitch
            initialChecked
            disabled
            label="Changing automation state"
          />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Execution"
        description="The definition section switches between the composer-style prompt and the script form."
      >
        {automationRunModeSchema.options.map((mode) => (
          <StoryRow
            key={mode}
            label={mode}
            hint={
              mode === "agent"
                ? "Prompt composer"
                : "Interpreter, timeout, and script"
            }
          >
            <AutomationMode mode={mode} />
          </StoryRow>
        ))}
      </StateSection>

      <StateSection
        title="Trigger"
        description="Schedule shape is definition metadata, not runtime health."
      >
        <StoryRow label="schedule" hint="Recurring cron schedule">
          <ResourceMeta items={["Recurring", "Timezone"]} />
        </StoryRow>
        <StoryRow label="once" hint="A single scheduled run">
          <ResourceMeta items={["One-time", "Scheduled time"]} />
        </StoryRow>
      </StateSection>

      <StateSection
        title="Run history"
        description="Every persisted run status from the automation contract, plus the empty history state."
      >
        <StoryRow label="no runs" hint="No persisted run history yet">
          <ResourceLifecycleStatus label="No runs yet" />
        </StoryRow>
        {automationRunStatusSchema.options.map((status) => (
          <StoryRow key={status} label={status} hint="Persisted run outcome">
            <AutomationRunStatusIndicator status={status} showLabel />
          </StoryRow>
        ))}
      </StateSection>
    </Gallery>
  );
}
