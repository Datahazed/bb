import { createContext, useContext, type ReactNode } from "react";
import type { BbNavigate } from "@bb/plugin-sdk";

export type PluginBrowserTabOpenHandler = (
  options: Parameters<BbNavigate["openBrowserTab"]>[0],
) => boolean;

const PluginBrowserTabNavigationContext =
  createContext<PluginBrowserTabOpenHandler | null>(null);

export function PluginBrowserTabNavigationProvider({
  children,
  openBrowserTab,
}: {
  children: ReactNode;
  openBrowserTab: PluginBrowserTabOpenHandler;
}) {
  return (
    <PluginBrowserTabNavigationContext.Provider value={openBrowserTab}>
      {children}
    </PluginBrowserTabNavigationContext.Provider>
  );
}

export function usePluginBrowserTabOpenHandler(): PluginBrowserTabOpenHandler | null {
  return useContext(PluginBrowserTabNavigationContext);
}
