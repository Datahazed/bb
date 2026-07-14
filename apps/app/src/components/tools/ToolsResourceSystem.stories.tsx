import { useState } from "react";
import type { SkillSummary } from "@bb/server-contract";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "bb-plugin-automations/rpc-types";
import {
  AutomationDetailView,
  automationEditBodyValue,
} from "bb-plugin-automations/detail-view";
import { ResourceListPanel } from "@bb/shared-ui/resource-list";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { SkillDetailDialogView } from "@/views/SkillsView";
import { PluginDetail, PluginListRow } from "@/views/ToolsView";

export default {
  title: "Tools/Resource Detail System",
};

const NOOP = () => {};
const RESOLVED = () => Promise.resolve(true);

const DOCUMENTS_SKILL: SkillSummary = {
  name: "documents:documents",
  description: "Create, edit, and inspect document files.",
  provider: "codex",
  scope: "plugin",
  filePath:
    "/Users/brsbl/.codex/plugins/cache/openai-primary-runtime/documents/skills/documents/SKILL.md",
  manageable: false,
};

const DOCUMENTS_SKILL_CONTENT = `# Documents

Create, edit, redline, and inspect document files using the document workflow.

## Workflow

1. Read the source document.
2. Make the requested changes.
3. Render the result and verify every page.
`;

const PLUGINS: readonly PluginListItem[] = [
  {
    id: "automations",
    source: "builtin:automations",
    isBuiltin: true,
    rootDir: "/plugins/automations",
    version: "0.1.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    displayName: null,
    icon: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [{ name: "automation-sweep", state: "running" }],
    schedules: [],
    cliCommand: {
      name: "automation",
      summary: "Inspect and manage automations (scheduled agent/script runs)",
    },
    app: { hasApp: true },
    provenance: "builtin",
    marketplaceName: null,
    sourceDisplay: "builtin · automations",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
  },
  {
    id: "connect",
    source: "builtin:connect",
    isBuiltin: true,
    rootDir: "/plugins/connect",
    version: "0.1.0",
    enabled: true,
    status: "running",
    statusDetail: null,
    description:
      "Remote access via getbb.app — this bb becomes reachable at https://<handle>.getbb.app. Disable to cut off all remote access.",
    displayName: "Remote access",
    icon: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [{ name: "tunnel", state: "running" }],
    schedules: [],
    cliCommand: {
      name: "connect",
      summary:
        "Expose this bb at https://<handle>.getbb.app (pair with --code/--server from the dashboard)",
    },
    app: { hasApp: true },
    provenance: "builtin",
    marketplaceName: null,
    sourceDisplay: "builtin · connect",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
  },
] satisfies readonly PluginListItem[];

const AUTOMATION: AutomationResponse = {
  id: "aut_release_readiness",
  projectId: "proj_personal",
  name: "Release readiness",
  enabled: true,
  trigger: {
    triggerType: "schedule",
    cron: "0 * * * *",
    timezone: "America/Los_Angeles",
  },
  execution: {
    mode: "agent",
    prompt:
      "Check the release branch, summarize blocking checks, and alert only when the status changes.",
    providerId: "codex",
    model: "gpt-5",
    permissionMode: "workspace-write",
    environment: { type: "project-default" },
  },
  origin: "human",
  createdByThreadId: null,
  nextRunAt: Date.UTC(2026, 6, 13, 20),
  lastRunAt: Date.UTC(2026, 6, 13, 19),
  runCount: 12,
  lastRunStatus: "succeeded",
  lastRunThreadId: "thr_release_readiness",
  lastError: null,
  createdAt: Date.UTC(2026, 6, 1),
  updatedAt: Date.UTC(2026, 6, 13, 19),
};

const AUTOMATION_RUNS: readonly AutomationRunResponse[] = [
  {
    id: "run_release_readiness_12",
    automationId: AUTOMATION.id,
    runMode: "agent",
    threadId: "thr_release_readiness",
    status: "succeeded",
    trigger: "schedule",
    skipReason: null,
    error: null,
    output: null,
    exitCode: null,
    scheduledFor: Date.UTC(2026, 6, 13, 19),
    startedAt: Date.UTC(2026, 6, 13, 19),
    finishedAt: Date.UTC(2026, 6, 13, 19, 2),
  },
];

export function SkillDetail() {
  return (
    <main className="p-4 md:p-5">
      <SkillDetailDialogView
        skill={DOCUMENTS_SKILL}
        files={["SKILL.md"]}
        selectedPath="SKILL.md"
        onSelectPath={NOOP}
        content={DOCUMENTS_SKILL_CONTENT}
        isLoadingContent={false}
        isRefreshingContent={false}
        isContentError={false}
        canEdit={false}
        canDelete={false}
        canOpenInEditor={false}
        isSaving={false}
        isDeleting={false}
        onSave={RESOLVED}
        onRetry={NOOP}
        onDelete={NOOP}
        onOpenInEditor={NOOP}
      />
    </main>
  );
}

export function PluginInventory() {
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-5">
      <ResourceListPanel>
        {PLUGINS.map((plugin) => (
          <PluginListRow
            key={plugin.id}
            plugin={plugin}
            pending={false}
            editDisabled
            onToggle={NOOP}
            onEdit={NOOP}
            onDelete={NOOP}
          />
        ))}
      </ResourceListPanel>
    </main>
  );
}

export function PluginDetailPage() {
  return (
    <main className="p-4 md:p-5">
      <PluginDetail
        isLoading={false}
        plugin={PLUGINS[1]}
        pending={false}
        editDisabled
        onToggle={NOOP}
        onReload={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onBack={NOOP}
      />
    </main>
  );
}

export function AutomationDetailPage() {
  const [enabled, setEnabled] = useState(AUTOMATION.enabled);
  const [draftName, setDraftName] = useState(AUTOMATION.name);
  const [draftBody, setDraftBody] = useState(
    automationEditBodyValue(AUTOMATION.execution),
  );
  return (
    <main className="p-4 md:p-5">
      <AutomationDetailView
        automation={{ ...AUTOMATION, enabled }}
        projectLabel="Personal"
        runsState={{
          runs: AUTOMATION_RUNS,
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
          loadMore: NOOP,
        }}
        editing={false}
        draftName={draftName}
        draftBody={draftBody}
        actionPending={false}
        saving={false}
        onBack={NOOP}
        onToggle={setEnabled}
        onEdit={NOOP}
        onCancelEdit={NOOP}
        onSave={NOOP}
        onRunNow={NOOP}
        onDelete={NOOP}
        onDraftNameChange={setDraftName}
        onDraftBodyChange={setDraftBody}
        onOpenThread={NOOP}
      />
    </main>
  );
}
