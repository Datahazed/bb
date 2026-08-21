import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;
type Owner = string | symbol;

const activeOwnersByAction = new Map<string, Set<Owner>>();
const listenersByAction = new Map<string, Set<Listener>>();

function key(pluginId: string, actionId: string): string {
  return `${pluginId}\0${actionId}`;
}

function notify(actionKey: string): void {
  for (const listener of listenersByAction.get(actionKey) ?? []) listener();
}

export function setPluginSidebarFooterActionActive(
  pluginId: string,
  actionId: string,
  active: boolean,
  owner: Owner = pluginId,
): void {
  const actionKey = key(pluginId, actionId);
  const owners = activeOwnersByAction.get(actionKey) ?? new Set<Owner>();
  const previous = owners.size > 0;
  if (active) {
    owners.add(owner);
    activeOwnersByAction.set(actionKey, owners);
  } else {
    owners.delete(owner);
    if (owners.size === 0) activeOwnersByAction.delete(actionKey);
  }
  if (previous !== owners.size > 0) notify(actionKey);
}

export function clearPluginSidebarFooterActionActiveByOwner(
  owner: Owner,
): void {
  for (const [actionKey, owners] of activeOwnersByAction) {
    const previous = owners.size > 0;
    owners.delete(owner);
    if (owners.size === 0) activeOwnersByAction.delete(actionKey);
    if (previous !== owners.size > 0) notify(actionKey);
  }
}

export function getPluginSidebarFooterActionActive(
  pluginId: string,
  actionId: string,
): boolean {
  return (activeOwnersByAction.get(key(pluginId, actionId))?.size ?? 0) > 0;
}

export function usePluginSidebarFooterActionActive(
  pluginId: string,
  actionId: string,
): boolean {
  const actionKey = key(pluginId, actionId);
  const subscribe = useCallback(
    (listener: Listener) => {
      const listeners = listenersByAction.get(actionKey) ?? new Set<Listener>();
      listeners.add(listener);
      listenersByAction.set(actionKey, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByAction.delete(actionKey);
      };
    },
    [actionKey],
  );
  const getSnapshot = useCallback(
    () => getPluginSidebarFooterActionActive(pluginId, actionId),
    [actionId, pluginId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetPluginSidebarFooterActionActiveForTest(): void {
  activeOwnersByAction.clear();
  for (const actionKey of listenersByAction.keys()) notify(actionKey);
}
