import { describe, expect, it } from "vitest";
import type {
  PluginListingDraftEntry,
  PluginListingLifecycle,
} from "@bb/server-contract";
import {
  buildEditPluginListingPrompt,
  buildPublishPluginUpdatePrompt,
  buildSubmitPluginListingPrompt,
  buildUpdatePluginSubmissionPrompt,
  pluginListingActions,
} from "./plugin-listing-prompts";

const entry: PluginListingDraftEntry = {
  id: "provider-usage",
  displayName: "Provider Usage",
  description: "Per-provider usage with multi-account support.",
  icon: "Chart",
  author: { name: "Author" },
  source: {
    git: {
      url: "https://github.com/author/provider-usage.git",
      range: "^0.1.0",
    },
  },
  category: "token-usage-and-cost",
  screenshots: [],
};

const lifecycleCases: Array<{
  lifecycle: PluginListingLifecycle;
  actionIds: string[];
}> = [
  { lifecycle: { status: "not-published" }, actionIds: ["submit"] },
  { lifecycle: { status: "draft", entry }, actionIds: ["submit"] },
  {
    lifecycle: {
      status: "in-review",
      entry,
      pullRequest: {
        url: "https://github.com/get-bb/marketplace/pull/214",
        openedAt: 1,
      },
    },
    actionIds: ["update-submission"],
  },
  {
    lifecycle: {
      status: "published",
      entryId: entry.id,
      publishedAt: 1,
    },
    actionIds: ["publish-update", "edit-listing"],
  },
];

describe("authored plugin listing prompts", () => {
  it("keeps the Submit skill workflow and honest category slot exact", () => {
    expect(
      buildSubmitPluginListingPrompt({
        name: "Provider Usage",
        path: "~/code/bb-plugin-provider-usage",
        category: null,
      }),
    )
      .toBe(`Submit my plugin Provider Usage (~/code/bb-plugin-provider-usage) to the BB Community marketplace.

Run the submit-a-plugin skill: confirm it builds and loads on this bb, tag the release, then write the entry — a description that says what it does and when you'd use it, category [choose category] unless a better fit exists, icon — and capture listing screenshots with bb plugin screenshot. Show me the entry and screenshots, then open the PR on get-bb/marketplace.`);
  });

  it("keeps the Update submission PR identity and visible fill-in slot exact", () => {
    expect(
      buildUpdatePluginSubmissionPrompt({
        name: "Web Push Notify",
        pullRequestUrl: "https://github.com/get-bb/marketplace/pull/214",
      }),
    ).toBe(
      "My Web Push Notify submission is in review — get-bb/marketplace PR #214. Bring it up to date with my local plugin: retag if the version moved, refresh the entry and screenshots to match, and fold in this change if I name one: [optional — what to change]. Push to the existing PR branch — no new PR — and leave a PR comment summarizing what changed for the reviewer.",
    );
  });

  it("keeps Publish update release-only unless the range moves", () => {
    expect(
      buildPublishPluginUpdatePrompt({
        name: "FX Provider",
        path: "~/code/bb-plugin-fx-provider",
        range: "^0.2.0",
      }),
    ).toBe(
      "Publish an update to FX Provider (~/code/bb-plugin-fx-provider). Confirm it builds and loads, then tag and push the release — the listing covers ^0.2.0, so anything in range reaches users automatically. If this version leaves the range, also open a small PR on get-bb/marketplace bumping the entry's range and tell me — that part is reviewed.",
    );
  });

  it("keeps Edit listing entry-only with its visible fill-in slot", () => {
    expect(buildEditPluginListingPrompt("FX Provider")).toBe(
      "FX Provider is listed in the BB Community marketplace. Update the listing, not the code: [what to change — description, screenshots, category]. Open a PR on get-bb/marketplace editing only my entry and its assets. No new tag, no version change.",
    );
  });

  it.each(lifecycleCases)(
    "exposes only $lifecycle.status actions",
    ({ lifecycle, actionIds }) => {
      expect(
        pluginListingActions({
          lifecycle,
          name: entry.displayName,
          path: "~/code/provider-usage",
          publishedSource: "git:https://github.com/a/b.git@semver:^0.2.0",
        }).map((action) => action.id),
      ).toEqual(actionIds);
    },
  );
});
