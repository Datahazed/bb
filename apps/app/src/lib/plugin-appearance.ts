import { useMemo } from "react";
import type { ExperimentalPluginAppearance } from "@get-bb/plugin-sdk";
import {
  setPreferredTheme,
  usePreferredTheme,
  useThemePreference,
} from "@/hooks/useTheme";

/** Host implementation of the plugin SDK's client appearance contract. */
export function usePluginAppearance(): ExperimentalPluginAppearance {
  const colorMode = usePreferredTheme();
  const colorModePreference = useThemePreference();
  return useMemo(
    () => ({
      colorMode,
      colorModePreference,
      setColorModePreference: setPreferredTheme,
    }),
    [colorMode, colorModePreference],
  );
}
