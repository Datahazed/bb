import { createContext, useContext, type ReactNode } from "react";
import type { BbNavigate } from "@bb/plugin-sdk";

export type PluginRightPanelOpenHandler = (
  request: Parameters<BbNavigate["experimental_openRightPanel"]>[0],
) => boolean;

const PluginRightPanelNavigationContext =
  createContext<PluginRightPanelOpenHandler | null>(null);

export function PluginRightPanelNavigationProvider({
  children,
  experimentalOpenRightPanel,
}: {
  children: ReactNode;
  experimentalOpenRightPanel: PluginRightPanelOpenHandler;
}) {
  return (
    <PluginRightPanelNavigationContext.Provider
      value={experimentalOpenRightPanel}
    >
      {children}
    </PluginRightPanelNavigationContext.Provider>
  );
}

export function usePluginRightPanelOpenHandler(): PluginRightPanelOpenHandler | null {
  return useContext(PluginRightPanelNavigationContext);
}
