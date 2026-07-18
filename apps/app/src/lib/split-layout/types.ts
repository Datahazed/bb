/** Mirrors the terminal-session target scopes in `@bb/server-contract`. */
export type TerminalPaneTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; hostId: string; cwd: string };

export type PaneContent =
  | {
      kind: "thread";
      projectId: string;
      threadId: string;
    }
  | {
      kind: "new-thread";
    }
  | {
      kind: "plugin-panel";
      pluginId: string;
      panelPath: string;
      subPath: string;
    }
  | {
      kind: "terminal";
      terminalId: string;
      /** Explicit context binding, fixed at creation: which scope owns the
       * PTY. The pane needs it to look up its session (sessions list by
       * scope, not id) and to badge its chrome. Absent only on URL-derived
       * content (`/terminals/:id` can't carry it) — reveal intents that never
       * open a new tab; persisted tabs always carry it. */
      target?: TerminalPaneTarget;
    }
  | {
      kind: "diff";
      projectId: string;
      threadId: string;
    };

/**
 * One view in a tab group. `preview` marks the group's at-most-one preview tab
 * (VS Code-style): the next preview open replaces it in place, and commit
 * gestures (double-click, drag) clear the flag. Stateful kinds (terminal)
 * never carry it.
 */
export interface PaneTab {
  tabId: string;
  content: PaneContent;
  preview: boolean;
}

/**
 * A leaf of the layout tree: a tab group holding one or more views. The pane
 * renders its active tab; `paneId` is the stable identity drag/focus/commands
 * address, `tabId` addresses a view within it.
 */
export interface PaneNode {
  type: "pane";
  paneId: string;
  tabs: PaneTab[];
  activeTabId: string;
}

export interface SplitNode {
  type: "split";
  dir: "row" | "col";
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface SplitLayout {
  root: LayoutNode;
  focusedPaneId: string;
}

export type SplitSide = "left" | "right" | "top" | "bottom";
export type SplitPath = readonly number[];
