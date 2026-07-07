import type { IconName } from "@bb/shared-ui/icon";

/**
 * Presentational types for the Tools Hub — Direction A (Marketplace Gallery)
 * Ladle stories. These mirror the *shape* of the real Tool domain records
 * (skills, automations, plugins) closely enough to render the design, but stay
 * local to the gallery: props in, nothing fetched. When this design is built
 * for real these will map onto the server contract types.
 */

export type ToolKind = "skill" | "automation" | "plugin";

/** The four states the filter bar can switch between (All + one per kind). */
export type ToolFilter = "all" | "skill" | "automation" | "plugin";

/** Overview grid states — drives which body the overview renders. */
export type ToolsOverviewState =
  | "ready"
  | "loading"
  | "empty"
  | "error"
  | "no-results";

// ---------------------------------------------------------------------------
// Card-level records
// ---------------------------------------------------------------------------

export interface ToolSkill {
  id: string;
  name: string;
  description: string;
  /** Display provider, e.g. "bb" or "Claude". */
  provider: string;
  scope: "built-in" | "user";
  /** Whether this skill can be edited in-app (drives read-only vs editable). */
  manageable: boolean;
}

export type AutomationRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | null;

export interface ToolAutomation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  kind: "agent" | "script";
  /** Human schedule label, rendered mono, e.g. "9PM daily · America/New_York". */
  schedule: string;
  lastRunStatus: AutomationRunStatus;
  /** Next scheduled run label, or null when paused. */
  nextRunAt: string | null;
}

export type PluginStatus =
  | "running"
  | "needs-configuration"
  | "error"
  | "disabled";

export interface ToolPlugin {
  id: string;
  version: string;
  enabled: boolean;
  status: PluginStatus;
  /** One-line status elaboration (e.g. an error reason), or null. */
  statusDetail: string | null;
  description: string;
  /**
   * Optional per-plugin glyph. Real plugins ship a logo/icon; when absent the
   * card falls back to the plugin kind icon. (Not in the minimal contract —
   * added so the marketplace grid reads like the static mock.)
   */
  icon?: IconName;
}

// ---------------------------------------------------------------------------
// Detail-page content. Kept separate from the card records so the card types
// stay lean; a detail page is rendered from its card record + one of these.
// ---------------------------------------------------------------------------

export interface DetailRailRow {
  label: string;
  value: string;
}

export interface DetailRailAction {
  icon: IconName;
  label: string;
}

export interface SkillReadmeBlock {
  type: "heading" | "paragraph" | "code";
  text: string;
}

export interface SkillDetail {
  filePath: string;
  invocation: string;
  availableTo: string;
  readme: SkillReadmeBlock[];
  rail: DetailRailRow[];
  railAction: DetailRailAction;
}

export interface AutomationRunEntry {
  status: "running" | "succeeded" | "failed";
  label: string;
  timestamp: string;
}

export interface AutomationDetail {
  prompt: string;
  execution: string;
  nextRunLabel: string;
  runs: AutomationRunEntry[];
  rail: DetailRailRow[];
}

export type PluginSettingControl =
  | { type: "text"; placeholder: string; icon?: IconName }
  | { type: "boolean"; value: boolean };

export interface PluginSettingField {
  label: string;
  help: string;
  control: PluginSettingControl;
}

export interface PluginPermission {
  icon: IconName;
  text: string;
  scopeLabel: string;
}

export interface PluginDetail {
  source: string;
  settings: PluginSettingField[];
  permissions: PluginPermission[];
  rail: DetailRailRow[];
  railAction: DetailRailAction;
}
