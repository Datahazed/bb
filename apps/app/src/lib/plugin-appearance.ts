import { useSyncExternalStore } from "react";
import type {
  ExperimentalPluginAppearance,
  ExperimentalPluginAppearanceStore,
} from "@get-bb/plugin-sdk";
import {
  getPreferredTheme,
  getThemePreference,
  setPreferredTheme,
  subscribeThemeAppearance,
} from "@/hooks/useTheme";

function setPluginColorModePreference(
  preference: ExperimentalPluginAppearance["colorModePreference"],
): void {
  if (
    preference !== "light" &&
    preference !== "dark" &&
    preference !== "system"
  ) {
    console.warn(
      `plugin appearance: expected "light", "dark", or "system"; received ${String(preference)}`,
    );
    return;
  }
  setPreferredTheme(preference);
}

const serverAppearance: ExperimentalPluginAppearance = {
  colorMode: "light",
  colorModePreference: "system",
  setColorModePreference: setPluginColorModePreference,
};

let cachedAppearance: ExperimentalPluginAppearance | undefined;

function getPluginAppearanceSnapshot(): ExperimentalPluginAppearance {
  if (typeof window === "undefined") return serverAppearance;
  const colorMode = getPreferredTheme();
  const colorModePreference = getThemePreference();
  if (
    cachedAppearance?.colorMode === colorMode &&
    cachedAppearance.colorModePreference === colorModePreference
  ) {
    return cachedAppearance;
  }
  cachedAppearance = {
    colorMode,
    colorModePreference,
    setColorModePreference: setPluginColorModePreference,
  };
  return cachedAppearance;
}

/** Host implementation of the app-wide plugin appearance contract. */
export const pluginAppearanceStore: ExperimentalPluginAppearanceStore = {
  getSnapshot: getPluginAppearanceSnapshot,
  subscribe: subscribeThemeAppearance,
};

/** React convenience wrapper over the app-wide plugin appearance store. */
export function usePluginAppearance(): ExperimentalPluginAppearance {
  return useSyncExternalStore(
    pluginAppearanceStore.subscribe,
    pluginAppearanceStore.getSnapshot,
    () => serverAppearance,
  );
}
