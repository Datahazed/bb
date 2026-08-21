import { useMemo } from "react";
import type { ExperimentalPluginAppearance } from "@get-bb/plugin-sdk";
import {
  getPreferredTheme,
  getThemePreference,
  setPreferredTheme,
  usePreferredTheme,
  useThemePreference,
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

/** Current semantic appearance for plugin callbacks outside React. */
export function getPluginAppearance(): ExperimentalPluginAppearance {
  return {
    colorMode: getPreferredTheme(),
    colorModePreference: getThemePreference(),
    setColorModePreference: setPluginColorModePreference,
  };
}

/** Host implementation of the plugin SDK's client appearance contract. */
export function usePluginAppearance(): ExperimentalPluginAppearance {
  const colorMode = usePreferredTheme();
  const colorModePreference = useThemePreference();
  return useMemo(
    () => ({
      colorMode,
      colorModePreference,
      setColorModePreference: setPluginColorModePreference,
    }),
    [colorMode, colorModePreference],
  );
}
