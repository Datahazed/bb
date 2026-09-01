interface PluginNavPanelIdentity {
  pluginId: string;
  id: string;
}

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

export function movePluginNavPanelToTop(
  order: readonly string[],
  key: string,
): string[] {
  if (order[0] === key) return [...order];
  return [key, ...order.filter((candidate) => candidate !== key)];
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
