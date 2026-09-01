import { pluginCatalogCategory } from "@bb/domain";
import type {
  PluginCatalogCategoryId,
  PluginListingLifecycle,
} from "@bb/server-contract";
import {
  type UntrustedPromptField,
  untrustedPromptDataBlock,
} from "./untrusted-prompt-data";

function pluginDataBlock(fields: readonly UntrustedPromptField[]): string[] {
  return untrustedPromptDataBlock({
    delimiterLabel: "PLUGIN DATA",
    sourceDescription: "a plugin or registry",
    fields,
  });
}

export function pluginListingCategoryLabel(id: PluginCatalogCategoryId) {
  return pluginCatalogCategory(id).displayName;
}

function pullRequestNumber(url: string): number {
  return Number(new URL(url).pathname.split("/").at(-1));
}

export function pluginListingSourceRange(source: string): string {
  const semverMarker = "@semver:";
  const semverAt = source.lastIndexOf(semverMarker);
  if (semverAt >= 0) {
    const selector = source.slice(semverAt + semverMarker.length);
    return selector.includes(":")
      ? selector.slice(selector.lastIndexOf(":") + 1)
      : selector;
  }
  if (source.startsWith("npm:")) {
    const specAt = source.lastIndexOf("@");
    if (specAt > "npm:".length) return source.slice(specAt + 1);
  }
  return "its current source constraint";
}

export function buildSubmitPluginListingPrompt(args: {
  name: string;
  path: string;
  category: string | null;
}) {
  return [
    "Submit my plugin identified below to the BB Community marketplace.",
    ...pluginDataBlock([
      { label: "Plugin name", value: args.name, maxLength: 200 },
      { label: "Plugin path", value: args.path, maxLength: 1_024 },
      {
        label: "Suggested category",
        value: args.category ?? "[choose category]",
        maxLength: 200,
      },
    ]),
    "",
    "Run the submit-a-plugin skill: confirm it builds and loads on this bb, tag the release, then write the entry — a description that says what it does and when you'd use it, the suggested category unless a better fit exists, icon — and capture listing screenshots with bb plugin screenshot. Show me the entry and screenshots, then open the PR on get-bb/marketplace.",
  ].join("\n");
}

export function buildUpdatePluginSubmissionPrompt(args: {
  name: string;
  pullRequestUrl: string;
}) {
  return [
    `My plugin submission is in review — get-bb/marketplace PR #${pullRequestNumber(args.pullRequestUrl)}.`,
    ...pluginDataBlock([
      { label: "Plugin name", value: args.name, maxLength: 200 },
    ]),
    "",
    "Bring it up to date with my local plugin: retag if the version moved, refresh the entry and screenshots to match, and fold in this change if I name one: [optional — what to change]. Push to the existing PR branch — no new PR — and leave a PR comment summarizing what changed for the reviewer.",
  ].join("\n");
}

export function buildPublishPluginUpdatePrompt(args: {
  name: string;
  path: string;
  range: string;
}) {
  return [
    "Publish an update to the plugin identified below.",
    ...pluginDataBlock([
      { label: "Plugin name", value: args.name, maxLength: 200 },
      { label: "Plugin path", value: args.path, maxLength: 1_024 },
      { label: "Published source range", value: args.range, maxLength: 500 },
    ]),
    "",
    "Confirm it builds and loads, then tag and push the release. Anything inside the published source range reaches users automatically. If this version leaves the range, also open a small PR on get-bb/marketplace bumping the entry's range and tell me — that part is reviewed.",
  ].join("\n");
}

export function buildEditPluginListingPrompt(name: string) {
  return [
    "The plugin identified below is listed in the BB Community marketplace.",
    ...pluginDataBlock([
      { label: "Plugin name", value: name, maxLength: 200 },
    ]),
    "",
    "Update the listing, not the code: [what to change — description, screenshots, category]. Open a PR on get-bb/marketplace editing only my entry and its assets. No new tag, no version change.",
  ].join("\n");
}

export function buildEditInstalledPluginPrompt(args: {
  name: string;
  path: string;
}) {
  return [
    "Edit the installed bb plugin identified below.",
    ...pluginDataBlock([
      { label: "Plugin name", value: args.name, maxLength: 200 },
      { label: "Plugin path", value: args.path, maxLength: 1_024 },
    ]),
    "",
    "I want to ",
  ].join("\n");
}

export type PluginListingAction =
  | { id: "submit"; label: "Submit"; prompt: string; variant: "outline" }
  | {
      id: "update-submission";
      label: "Update submission";
      prompt: string;
      variant: "default";
    }
  | {
      id: "publish-update";
      label: "Publish update";
      prompt: string;
      variant: "default";
    }
  | {
      id: "edit-listing";
      label: "Edit listing";
      prompt: string;
      variant: "outline";
    };

export function pluginListingActions(args: {
  lifecycle: PluginListingLifecycle;
  name: string;
  path: string;
  publishedSource: string | null;
}): PluginListingAction[] {
  switch (args.lifecycle.status) {
    case "not-published":
      return [
        {
          id: "submit",
          label: "Submit",
          prompt: buildSubmitPluginListingPrompt({
            name: args.name,
            path: args.path,
            category: null,
          }),
          variant: "outline",
        },
      ];
    case "draft":
      return [
        {
          id: "submit",
          label: "Submit",
          prompt: buildSubmitPluginListingPrompt({
            name: args.name,
            path: args.path,
            category: pluginListingCategoryLabel(args.lifecycle.entry.category),
          }),
          variant: "outline",
        },
      ];
    case "in-review":
      return [
        {
          id: "update-submission",
          label: "Update submission",
          prompt: buildUpdatePluginSubmissionPrompt({
            name: args.name,
            pullRequestUrl: args.lifecycle.pullRequest.url,
          }),
          variant: "default",
        },
      ];
    case "published":
      return [
        {
          id: "publish-update",
          label: "Publish update",
          prompt: buildPublishPluginUpdatePrompt({
            name: args.name,
            path: args.path,
            range:
              args.publishedSource === null
                ? "its current source constraint"
                : pluginListingSourceRange(args.publishedSource),
          }),
          variant: "default",
        },
        {
          id: "edit-listing",
          label: "Edit listing",
          prompt: buildEditPluginListingPrompt(args.name),
          variant: "outline",
        },
      ];
  }
}
