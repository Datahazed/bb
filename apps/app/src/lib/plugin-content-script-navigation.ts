import type { ExperimentalPluginComposeNavigationOptions } from "@get-bb/plugin-sdk";

type ComposeNavigator = (
  options: ExperimentalPluginComposeNavigationOptions,
) => void;

let composeNavigator: ComposeNavigator | null = null;

/** Install the current app window's React Router-backed compose navigator. */
export function setPluginContentScriptComposeNavigator(
  navigator: ComposeNavigator,
): () => void {
  composeNavigator = navigator;
  return () => {
    if (composeNavigator === navigator) composeNavigator = null;
  };
}

/** Navigate on behalf of a content script without exposing React Router. */
export function navigatePluginContentScriptToCompose(
  options: ExperimentalPluginComposeNavigationOptions = {},
): boolean {
  const navigator = composeNavigator;
  if (navigator === null) return false;
  navigator(options);
  return true;
}

export function resetPluginContentScriptComposeNavigatorForTest(): void {
  composeNavigator = null;
}
