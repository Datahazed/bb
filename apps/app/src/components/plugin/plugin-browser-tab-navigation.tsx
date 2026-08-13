import { createContext, useContext, type ReactNode } from "react";
import type { BbNavigate } from "@bb/plugin-sdk";

export type PluginBrowserTabOpenHandler = (
  options: Parameters<BbNavigate["experimental_openBrowserTab"]>[0],
) => boolean;

const PluginBrowserTabNavigationContext =
  createContext<PluginBrowserTabOpenHandler | null>(null);

export function PluginBrowserTabNavigationProvider({
  children,
  experimentalOpenBrowserTab,
}: {
  children: ReactNode;
  experimentalOpenBrowserTab: PluginBrowserTabOpenHandler;
}) {
  return (
    <PluginBrowserTabNavigationContext.Provider
      value={experimentalOpenBrowserTab}
    >
      {children}
    </PluginBrowserTabNavigationContext.Provider>
  );
}

export function usePluginBrowserTabOpenHandler(): PluginBrowserTabOpenHandler | null {
  return useContext(PluginBrowserTabNavigationContext);
}
