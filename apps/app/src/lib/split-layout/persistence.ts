import { z } from "zod";
import { MAX_PANES, MAX_TABS_PER_PANE, countPanes, listPanes } from "./ops";
import type { LayoutNode, PaneNode, SplitLayout, SplitNode } from "./types";

/** v2: leaves are tab groups. v1 (single-content panes) deserializes to null —
 * a deliberate fresh start, matching the reader's "seed from the route". */
export const SPLIT_LAYOUT_SCHEMA_VERSION = 2;
export const SPLIT_LAYOUT_STORAGE_KEY = "bb.splitLayout";

const paneContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread"),
      projectId: z.string().min(1),
      threadId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("new-thread") }).strict(),
  z
    .object({
      kind: z.literal("plugin-panel"),
      pluginId: z.string().min(1),
      panelPath: z.string().min(1),
      subPath: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("terminal"),
      terminalId: z.string().min(1),
      target: z.discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("thread"), threadId: z.string().min(1) })
          .strict(),
        z
          .object({
            kind: z.literal("environment"),
            environmentId: z.string().min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal("host_path"),
            hostId: z.string().min(1),
            cwd: z.string().min(1),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("diff"),
      projectId: z.string().min(1),
      threadId: z.string().min(1),
    })
    .strict(),
]);

const paneTabSchema = z
  .object({
    tabId: z.string().min(1),
    content: paneContentSchema,
    preview: z.boolean(),
  })
  .strict()
  .superRefine((tab, context) => {
    if (tab.preview && tab.content.kind === "terminal") {
      context.addIssue({
        code: "custom",
        message: "Terminal tabs are never previews",
        path: ["preview"],
      });
    }
  });

const paneNodeSchema: z.ZodType<PaneNode> = z
  .object({
    type: z.literal("pane"),
    paneId: z.string().min(1),
    tabs: z.array(paneTabSchema).min(1).max(MAX_TABS_PER_PANE),
    activeTabId: z.string().min(1),
  })
  .strict()
  .superRefine((pane, context) => {
    if (!pane.tabs.some((tab) => tab.tabId === pane.activeTabId)) {
      context.addIssue({
        code: "custom",
        message: "The active tab must exist in the pane",
        path: ["activeTabId"],
      });
    }
    if (pane.tabs.filter((tab) => tab.preview).length > 1) {
      context.addIssue({
        code: "custom",
        message: "A pane holds at most one preview tab",
        path: ["tabs"],
      });
    }
  });

const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([paneNodeSchema, splitNodeSchema]),
);

const splitNodeSchema: z.ZodType<SplitNode> = z
  .object({
    type: z.literal("split"),
    dir: z.enum(["row", "col"]),
    sizes: z.array(z.number().positive()),
    children: z.array(layoutNodeSchema).min(2),
  })
  .strict()
  .superRefine((split, context) => {
    if (split.sizes.length !== split.children.length) {
      context.addIssue({
        code: "custom",
        message: "Split sizes must match its child count",
        path: ["sizes"],
      });
    }
    const total = split.sizes.reduce((sum, size) => sum + size, 0);
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "Split sizes must sum to 1",
        path: ["sizes"],
      });
    }
  });

const splitLayoutSchema: z.ZodType<SplitLayout> = z
  .object({
    root: layoutNodeSchema,
    focusedPaneId: z.string().min(1),
  })
  .strict()
  .superRefine((layout, context) => {
    const panes = listPanes(layout.root);
    if (countPanes(layout.root) > MAX_PANES) {
      context.addIssue({
        code: "custom",
        message: `A split layout supports at most ${MAX_PANES} panes`,
        path: ["root"],
      });
    }
    if (!panes.some((pane) => pane.paneId === layout.focusedPaneId)) {
      context.addIssue({
        code: "custom",
        message: "The focused pane must exist",
        path: ["focusedPaneId"],
      });
    }
    if (new Set(panes.map((pane) => pane.paneId)).size !== panes.length) {
      context.addIssue({
        code: "custom",
        message: "Pane IDs must be unique",
        path: ["root"],
      });
    }
    const tabIds = panes.flatMap((pane) => pane.tabs.map((tab) => tab.tabId));
    if (new Set(tabIds).size !== tabIds.length) {
      context.addIssue({
        code: "custom",
        message: "Tab IDs must be unique",
        path: ["root"],
      });
    }
  });

const storedSplitLayoutSchema = z
  .object({
    version: z.literal(SPLIT_LAYOUT_SCHEMA_VERSION),
    layout: splitLayoutSchema,
  })
  .strict();

export function serializeSplitLayout(layout: SplitLayout): string {
  return JSON.stringify({ version: SPLIT_LAYOUT_SCHEMA_VERSION, layout });
}

export function deserializeSplitLayout(
  storedValue: string | null,
): SplitLayout | null {
  if (storedValue === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(storedValue);
    const result = storedSplitLayoutSchema.safeParse(parsed);
    return result.success ? result.data.layout : null;
  } catch {
    return null;
  }
}
