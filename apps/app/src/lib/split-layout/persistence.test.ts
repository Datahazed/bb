import { describe, expect, it } from "vitest";
import {
  deserializeSplitLayout,
  serializeSplitLayout,
  SPLIT_LAYOUT_SCHEMA_VERSION,
} from "./persistence";
import { MAX_TABS_PER_PANE } from "./ops";
import type { PaneContent, PaneNode, SplitLayout } from "./types";

function pane(paneId: string, content: PaneContent): PaneNode {
  const tabId = `${paneId}-t1`;
  return {
    type: "pane",
    paneId,
    tabs: [{ tabId, content, preview: false }],
    activeTabId: tabId,
  };
}

function layoutWithPaneCount(count: number): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: Array.from({ length: count }, () => 1 / count),
      children: Array.from({ length: count }, (_, index) =>
        pane(`pane-${index + 1}`, {
          kind: "thread" as const,
          projectId: "project-1",
          threadId: `thread-${index + 1}`,
        }),
      ),
    },
    focusedPaneId: `pane-${count}`,
  };
}

const layout: SplitLayout = {
  root: {
    type: "split",
    dir: "row",
    sizes: [0.4, 0.6],
    children: [
      pane("pane-1", {
        kind: "thread",
        projectId: "project-1",
        threadId: "thread-1",
      }),
      pane("pane-2", {
        kind: "thread",
        projectId: "project-2",
        threadId: "thread-2",
      }),
    ],
  },
  focusedPaneId: "pane-2",
};

describe("split layout persistence", () => {
  it("round-trips a versioned split layout", () => {
    const serialized = serializeSplitLayout(layout);

    expect(JSON.parse(serialized)).toMatchObject({
      version: SPLIT_LAYOUT_SCHEMA_VERSION,
    });
    expect(deserializeSplitLayout(serialized)).toEqual(layout);
  });

  it("round-trips tabs, preview state, terminal targets, and mixed content", () => {
    const mixed: SplitLayout = {
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            ...pane("pane-1", { kind: "new-thread" }),
            tabs: [
              {
                tabId: "pane-1-t1",
                content: { kind: "new-thread" },
                preview: false,
              },
              {
                tabId: "pane-1-t2",
                content: {
                  kind: "terminal",
                  terminalId: "term-1",
                  target: { kind: "thread", threadId: "thread-1" },
                },
                preview: false,
              },
              {
                tabId: "pane-1-t3",
                content: {
                  kind: "diff",
                  projectId: "project-1",
                  threadId: "thread-1",
                },
                preview: true,
              },
            ],
            activeTabId: "pane-1-t3",
          },
          pane("pane-2", {
            kind: "plugin-panel",
            pluginId: "notes",
            panelPath: "notes",
            subPath: "work/today.md",
          }),
        ],
      },
      focusedPaneId: "pane-2",
    };

    expect(deserializeSplitLayout(serializeSplitLayout(mixed))).toEqual(mixed);
  });

  it("round-trips and restores all eight panes with focus and sizes intact", () => {
    const eightPanes = layoutWithPaneCount(8);

    expect(deserializeSplitLayout(serializeSplitLayout(eightPanes))).toEqual(
      eightPanes,
    );
  });

  it("rejects malformed JSON, unknown versions, and invalid layout invariants", () => {
    expect(deserializeSplitLayout(null)).toBeNull();
    expect(deserializeSplitLayout("not json")).toBeNull();
    expect(
      deserializeSplitLayout(JSON.stringify({ version: 999, layout })),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: {
            ...layout,
            root: { ...layout.root, sizes: [0.4, 0.4] },
          },
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: { ...layout, focusedPaneId: "missing" },
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(serializeSplitLayout(layoutWithPaneCount(9))),
    ).toBeNull();
  });

  it("deliberately rejects version-one single-content pane payloads", () => {
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: 1,
          layout: {
            root: {
              type: "pane",
              paneId: "pane-1",
              content: {
                kind: "thread",
                projectId: "project-1",
                threadId: "thread-1",
              },
            },
            focusedPaneId: "pane-1",
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects invalid tab-group invariants and terminals without targets", () => {
    const single = pane("pane-1", {
      kind: "thread",
      projectId: "project-1",
      threadId: "thread-1",
    });
    const stored = (root: unknown) =>
      JSON.stringify({
        version: SPLIT_LAYOUT_SCHEMA_VERSION,
        layout: { root, focusedPaneId: "pane-1" },
      });

    expect(
      deserializeSplitLayout(stored({ ...single, activeTabId: "missing" })),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        stored({
          ...single,
          tabs: [
            { ...single.tabs[0], preview: true },
            {
              tabId: "pane-1-t2",
              content: { kind: "new-thread" },
              preview: true,
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(deserializeSplitLayout(stored({ ...single, tabs: [] }))).toBeNull();
    expect(
      deserializeSplitLayout(
        stored({
          ...single,
          tabs: Array.from({ length: MAX_TABS_PER_PANE + 1 }, (_, index) => ({
            tabId: `tab-${index}`,
            content: { kind: "new-thread" },
            preview: false,
          })),
          activeTabId: "tab-0",
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        stored({
          ...single,
          tabs: [
            {
              tabId: "pane-1-t1",
              content: { kind: "terminal", terminalId: "term-1" },
              preview: false,
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        stored({
          ...single,
          tabs: [
            {
              tabId: "pane-1-t1",
              content: {
                kind: "terminal",
                terminalId: "term-1",
                target: { kind: "thread", threadId: "thread-1" },
              },
              preview: true,
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: {
            root: {
              type: "split",
              dir: "row",
              sizes: [0.5, 0.5],
              children: [single, { ...single, paneId: "pane-2" }],
            },
            focusedPaneId: "pane-1",
          },
        }),
      ),
    ).toBeNull();
    expect(
      deserializeSplitLayout(
        JSON.stringify({
          version: SPLIT_LAYOUT_SCHEMA_VERSION,
          layout: {
            root: {
              type: "split",
              dir: "row",
              sizes: [0.5, 0.5],
              children: [
                single,
                {
                  ...single,
                  tabs: [
                    {
                      ...single.tabs[0],
                      tabId: "pane-2-t1",
                    },
                  ],
                  activeTabId: "pane-2-t1",
                },
              ],
            },
            focusedPaneId: "pane-1",
          },
        }),
      ),
    ).toBeNull();
  });
});
