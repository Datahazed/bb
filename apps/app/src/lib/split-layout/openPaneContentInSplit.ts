import { splitLayoutAtom } from "./atoms";
import {
  countPanes,
  findPaneByContent,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "./index";
import { withRootComposeDraftSlotId } from "../root-compose-location-state";

interface SplitLayoutStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
}

export interface OpenPaneContentInSplitArgs {
  store: SplitLayoutStore;
  navigate: (
    route: string,
    options?: { replace?: boolean; state?: Record<string, unknown> },
  ) => void | Promise<void>;
  content: PaneContent;
  route: string;
  enabled: boolean;
}

export function openPaneContentInSplit({
  store,
  navigate,
  content,
  route,
  enabled,
}: OpenPaneContentInSplitArgs): void {
  const navigationState =
    content.kind === "new-thread"
      ? withRootComposeDraftSlotId(null, content.draftSlotId)
      : undefined;
  const layout = store.get(splitLayoutAtom);
  if (!enabled || layout === null) {
    if (navigationState === undefined) {
      void navigate(route);
    } else {
      void navigate(route, { state: navigationState });
    }
    return;
  }
  const existing = findPaneByContent(layout.root, content);
  const next =
    existing !== null
      ? setFocus(layout, existing.paneId)
      : countPanes(layout.root) >= MAX_PANES
        ? replacePaneContent(layout, layout.focusedPaneId, content)
        : splitPane(layout, layout.focusedPaneId, "right", content);
  if (next !== layout) store.set(splitLayoutAtom, next);
  if (existing === null && navigationState === undefined) {
    void navigate(route);
  } else {
    void navigate(route, {
      ...(existing !== null ? { replace: true as const } : {}),
      ...(navigationState === undefined ? {} : { state: navigationState }),
    });
  }
}

export function holdsPluginDetailPane(
  layout: SplitLayout | null,
  pluginId: string,
): boolean {
  if (layout === null) return false;
  return (
    findPaneByContent(layout.root, { kind: "plugin-detail", pluginId }) !== null
  );
}
