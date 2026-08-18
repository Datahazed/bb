import { threadTabsSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildFileOpenerPanelTab } from "./file-opener-tabs";

// Regression for get-bb/bb#1773: persistThreadTabs runs every tab through the
// strict server contract before PUT /threads/:id/tabs. The app-side owner
// shape and the contract shape must not drift.
describe("buildFileOpenerPanelTab", () => {
  it("builds a tab that the thread-tabs contract accepts", () => {
    const openerTab = buildFileOpenerPanelTab(
      { id: "docs-editor", pluginId: "docs" },
      {
        path: "README.md",
        source: {
          kind: "workspace",
          environmentId: "env-1",
          projectId: null,
          threadId: "thr-1",
        },
      },
      {
        kind: "workspace-file-preview",
        environmentId: "env-1",
        projectId: null,
        tab: {
          lineRange: null,
          path: "README.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
        threadId: "thr-1",
      },
    );
    expect(openerTab.fileOpenerOwner).toBeDefined();
    expect(threadTabsSchema.parse([openerTab])).toEqual([openerTab]);
  });
});
