import { describe, expect, it } from "vitest";
import type { PromptMentionSuggestion } from "@bb/client-core";
import { buildPromptMentionResults } from "./promptMentionCandidates";

type ProjectMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "project" }
>;
type PluginMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "plugin" }
>;

function project(name: string): ProjectMentionSuggestion {
  return {
    kind: "project",
    path: "project:proj_automations",
    replacement: "project:proj_automations",
    projectId: "proj_automations",
    name,
  };
}

function plugin(
  title: string,
  searchAliases: readonly string[],
): PluginMentionSuggestion {
  return {
    kind: "plugin",
    pluginId: "at-plugin",
    providerId: "installed",
    itemId: "installed:automations",
    providerLabel: "Installed",
    title,
    searchAliases,
    subtitle: "Automation tools",
    icon: null,
    replacement: title,
  };
}

describe("buildPromptMentionResults", () => {
  it("ranks a source identity alias ahead of a weaker built-in title", () => {
    const results = buildPromptMentionResults({
      query: "automations",
      paths: [],
      threads: [],
      projects: [project("Automations project")],
      sections: [],
      plugins: [plugin("Workflow Tools", ["automations"])],
    });

    expect(results.groups.map((group) => group.label)).toEqual([
      "Installed",
      "Projects",
    ]);
    expect(
      results.suggestions.map((suggestion) => suggestion.replacement),
    ).toEqual(["Workflow Tools", "project:proj_automations"]);
  });

  it("keeps provider sections distinct when their visible labels collide", () => {
    const first = plugin("First", ["first"]);
    const second: PluginMentionSuggestion = {
      ...plugin("Second", ["second"]),
      pluginId: "other-plugin",
      itemId: "installed:second",
    };
    const results = buildPromptMentionResults({
      query: "",
      paths: [],
      threads: [],
      projects: [],
      sections: [],
      plugins: [first, second],
    });

    expect(results.groups.map((group) => group.key)).toEqual([
      "plugin:at-plugin:installed",
      "plugin:other-plugin:installed",
    ]);
  });
});
