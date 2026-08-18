import { describe, expect, it } from "vitest";
import {
  threadTabsSchema,
  updateThreadTabsRequestSchema,
  type ThreadTab,
} from "../src/index.js";

// Regression for get-bb/bb#1773: plugin file-opener tabs carry the native
// preview they diverted as `fileOpenerOwner`. The strict plugin-panel branch
// rejected the key, so the app never sent PUT /threads/:id/tabs.
describe("threadTabsSchema plugin-panel fileOpenerOwner", () => {
  const openerTab: ThreadTab = {
    actionId: "file-opener:docs-editor",
    fileOpenerOwner: {
      kind: "workspace-file-preview",
      environmentId: "env-1",
      projectId: null,
      tab: {
        lineRange: { endLineNumber: 3, startLineNumber: 1 },
        path: "README.md",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
      threadId: "thr-1",
    },
    id: "plugin-panel:docs:file-opener:docs-editor:README.md",
    kind: "plugin-panel",
    paramsJson: JSON.stringify({
      path: "README.md",
      source: { kind: "workspace" },
    }),
    pluginId: "docs",
    title: "README.md",
  };

  it("round-trips a workspace-file-preview owner", () => {
    const parsed = threadTabsSchema.parse([openerTab]);
    expect(parsed).toEqual([openerTab]);
    expect(
      updateThreadTabsRequestSchema.parse({
        expectedRevision: 0,
        tabs: [openerTab],
      }).tabs,
    ).toEqual([openerTab]);
  });

  it("round-trips host and thread-storage owners", () => {
    const hostTab: ThreadTab = {
      ...openerTab,
      fileOpenerOwner: {
        kind: "host-file-preview",
        environmentId: "env-1",
        tab: { lineRange: null, path: "/etc/hosts" },
        threadId: "thr-1",
      },
      id: "host-opener",
    };
    const storageTab: ThreadTab = {
      ...openerTab,
      fileOpenerOwner: {
        kind: "thread-storage-file-preview",
        environmentId: null,
        tab: { lineRange: null, path: "notes.md" },
        threadId: "thr-1",
      },
      id: "storage-opener",
    };
    expect(threadTabsSchema.parse([hostTab, storageTab])).toEqual([
      hostTab,
      storageTab,
    ]);
  });

  it("still accepts plain plugin-panel tabs without an owner", () => {
    const { fileOpenerOwner: _owner, ...actionTab } = openerTab;
    expect(threadTabsSchema.parse([actionTab])).toEqual([actionTab]);
  });

  it("rejects unknown owner shapes", () => {
    expect(
      threadTabsSchema.safeParse([
        {
          ...openerTab,
          fileOpenerOwner: { kind: "browser", url: "https://example.com" },
        },
      ]).success,
    ).toBe(false);
  });
});
