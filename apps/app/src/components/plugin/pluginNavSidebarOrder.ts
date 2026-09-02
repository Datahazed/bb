interface PluginNavPanelIdentity {
  pluginId: string;
  id: string;
}

export const BUILT_IN_SIDEBAR_NAVIGATION_KEYS = {
  newThread: "__bb__/new-thread",
  searchThreads: "__bb__/search-threads",
  extensions: "__bb__/extensions",
  automations: "__bb__/automations",
} as const;

export const DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER = [
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.newThread,
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.searchThreads,
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.extensions,
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.automations,
] as const;

export function getPluginNavPanelKey(panel: PluginNavPanelIdentity): string {
  return `${panel.pluginId}/${panel.id}`;
}

interface ArrangePluginNavPanelsArgs<TPanel extends PluginNavPanelIdentity> {
  panels: readonly TPanel[];
  storedOrder: readonly string[];
}

interface ArrangedPluginNavPanels<TPanel extends PluginNavPanelIdentity> {
  ordered: TPanel[];
  normalizedOrder: string[];
}

interface ArrangePluginNavPanelPreferencesArgs<
  TPanel extends PluginNavPanelIdentity,
> extends ArrangePluginNavPanelsArgs<TPanel> {
  storedVisibleKeys: readonly string[] | null;
  defaultVisibleCount: number;
}

interface ArrangedPluginNavPanelPreferences<
  TPanel extends PluginNavPanelIdentity,
> extends ArrangedPluginNavPanels<TPanel> {
  visible: TPanel[];
  overflow: TPanel[];
  visibleKeys: string[];
  normalizedVisibleKeys: string[] | null;
}

export function arrangePluginNavPanels<TPanel extends PluginNavPanelIdentity>({
  panels,
  storedOrder,
}: ArrangePluginNavPanelsArgs<TPanel>): ArrangedPluginNavPanels<TPanel> {
  const byKey = new Map(
    panels.map((panel) => [getPluginNavPanelKey(panel), panel]),
  );
  const ordered: TPanel[] = [];
  const normalizedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of storedOrder) {
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    const panel = byKey.get(key);
    if (panel) ordered.push(panel);
  }
  for (const panel of panels) {
    const key = getPluginNavPanelKey(panel);
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    ordered.push(panel);
  }

  return { ordered, normalizedOrder };
}

export function arrangePluginNavPanelPreferences<
  TPanel extends PluginNavPanelIdentity,
>({
  panels,
  storedOrder,
  storedVisibleKeys,
  defaultVisibleCount,
}: ArrangePluginNavPanelPreferencesArgs<TPanel>): ArrangedPluginNavPanelPreferences<TPanel> {
  const { ordered, normalizedOrder } = arrangePluginNavPanels({
    panels,
    storedOrder,
  });
  const normalizedVisibleKeys =
    storedVisibleKeys === null
      ? null
      : [...new Set(storedVisibleKeys.filter((key) => key.length > 0))];
  const visibleKeys =
    normalizedVisibleKeys ??
    ordered
      .slice(0, Math.max(0, defaultVisibleCount))
      .map(getPluginNavPanelKey);
  const visibleSet = new Set(visibleKeys);

  return {
    ordered,
    normalizedOrder,
    visible: ordered.filter((panel) =>
      visibleSet.has(getPluginNavPanelKey(panel)),
    ),
    overflow: ordered.filter(
      (panel) => !visibleSet.has(getPluginNavPanelKey(panel)),
    ),
    visibleKeys: ordered
      .map(getPluginNavPanelKey)
      .filter((key) => visibleSet.has(key)),
    normalizedVisibleKeys,
  };
}

export function togglePluginNavPanelVisibility(
  visibleKeys: readonly string[],
  key: string,
  visible: boolean,
): string[] {
  const normalized = [...new Set(visibleKeys.filter((item) => item.length > 0))];
  if (visible) {
    return normalized.includes(key) ? normalized : [...normalized, key];
  }
  return normalized.filter((item) => item !== key);
}

interface ReorderPluginNavPanelsArgs {
  activeKey: string;
  overKey: string;
  order: readonly string[];
  visibleKeys: readonly string[];
}

export function reorderPluginNavPanels({
  activeKey,
  overKey,
  order,
  visibleKeys,
}: ReorderPluginNavPanelsArgs): string[] | null {
  const from = visibleKeys.indexOf(activeKey);
  const to = visibleKeys.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return null;

  const nextVisible = [...visibleKeys];
  const [moved] = nextVisible.splice(from, 1);
  nextVisible.splice(to, 0, moved);

  const visibleSet = new Set(visibleKeys);
  let cursor = 0;
  return order.map((key) =>
    visibleSet.has(key) ? nextVisible[cursor++] : key,
  );
}

export function migrateLegacyHiddenPluginNavPanelOrder(
  order: readonly string[],
  hiddenKeys: readonly string[],
): string[] {
  const uniqueOrder = [
    ...new Set([...order, ...hiddenKeys].filter((key) => key.length > 0)),
  ];
  const hidden = new Set(hiddenKeys);
  return [
    ...uniqueOrder.filter((key) => !hidden.has(key)),
    ...uniqueOrder.filter((key) => hidden.has(key)),
  ];
}

export function havePluginNavPanelOrdersDiverged(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length !== right.length ||
    left.some((key, index) => key !== right[index])
  );
}
