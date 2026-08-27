/**
 * Ordering logic for the traditional plugin panel rows in the sidebar.
 *
 * Panels arrive from the slot registry in a fixed registration order (plugin id
 * then declaration order). One persisted order determines both the first five
 * rows and positional overflow. Preferences are keyed by
 * `<pluginId>/<panelId>`, so an uninstalled-and-reinstalled plugin keeps its
 * place and a renamed panel id starts fresh at the end of the list.
 */

interface PluginNavPanelIdentity {
  pluginId: string;
  id: string;
}

export function getPluginNavPanelKey(panel: PluginNavPanelIdentity): string {
  return `${panel.pluginId}/${panel.id}`;
}

interface ArrangePluginNavPanelsArgs<TPanel extends PluginNavPanelIdentity> {
  /** Registered panels, in registry order. */
  panels: readonly TPanel[];
  /** Persisted key order; may name panels that no longer exist. */
  storedOrder: readonly string[];
}

interface ArrangedPluginNavPanels<TPanel extends PluginNavPanelIdentity> {
  /** Registered panels in user order. */
  ordered: TPanel[];
  /**
   * `storedOrder` with duplicates dropped and never-ordered panels appended.
   * Callers persist this so newly installed panels get a slot.
   *
   * Keys of panels that are not registered right now keep their position. A
   * plugin frontend can register late — the sidebar mounts before every plugin
   * has loaded — so treating "absent" as "removed" would save a shortened order
   * during startup and lose the user's arrangement. Keeping the key also makes
   * an uninstalled-and-reinstalled plugin return to its old slot.
   */
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
    // Skip duplicates (corrupted storage). An unregistered key keeps its slot
    // in the order but contributes no row.
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    const panel = byKey.get(key);
    if (panel) ordered.push(panel);
  }
  // Panels the user has never ordered — newly installed plugins — land last, in
  // registry order, rather than jumping to the top of a customized list.
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
  /** Full persisted order, including temporarily unregistered panels. */
  order: readonly string[];
  /** Registered keys in display order. */
  visibleKeys: readonly string[];
}

/**
 * Moves `activeKey` to `overKey`'s slot among registered rows and folds the
 * result back into the full order. Temporarily unregistered keys keep their
 * index so late plugin registration cannot erase the user's arrangement.
 *
 * Returns `null` when the drag is a no-op.
 */
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

/**
 * Converts the old hide preference into position: previously visible keys
 * keep their relative order, followed by previously hidden keys. Unknown keys
 * stay in the order so a late-registering or reinstalled plugin retains its
 * slot.
 */
export function migrateLegacyHiddenPluginNavPanelOrder(
  order: readonly string[],
  hiddenKeys: readonly string[],
): string[] {
  const uniqueOrder = [
    ...new Set(
      [...order, ...hiddenKeys].filter((key) => key.length > 0),
    ),
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
