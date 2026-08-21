import type { QueryClient } from "@tanstack/react-query";
import {
  applyAppKeybindingOverrides,
  type AppKeybindingOverrides,
  type AppSettings,
} from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";
import { systemConfigQueryKey } from "../queries/query-keys";

export interface KeyboardSettingsCacheTransaction {
  previous: SystemConfigResponse | undefined;
}

interface BeginKeyboardSettingsCacheTransactionArgs {
  overrides: AppKeybindingOverrides;
  queryClient: QueryClient;
}

export async function beginKeyboardSettingsCacheTransaction({
  overrides,
  queryClient,
}: BeginKeyboardSettingsCacheTransactionArgs): Promise<KeyboardSettingsCacheTransaction> {
  const queryKey = systemConfigQueryKey();
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<SystemConfigResponse>(queryKey);
  if (previous !== undefined) {
    queryClient.setQueryData<SystemConfigResponse>(queryKey, {
      ...previous,
      keybindings: applyAppKeybindingOverrides(
        previous.defaultKeybindings,
        overrides,
      ),
      keybindingOverrides: overrides,
    });
  }
  return { previous };
}

interface RollbackKeyboardSettingsCacheTransactionArgs {
  queryClient: QueryClient;
  transaction: KeyboardSettingsCacheTransaction | undefined;
}

export function rollbackKeyboardSettingsCacheTransaction({
  queryClient,
  transaction,
}: RollbackKeyboardSettingsCacheTransactionArgs): void {
  if (transaction?.previous === undefined) return;
  queryClient.setQueryData(systemConfigQueryKey(), transaction.previous);
}

/**
 * The streamer mode value the cache last saw from the server, or undefined
 * when `/system/config` has not resolved in this window.
 */
export function readCachedStreamerMode(
  queryClient: QueryClient,
): boolean | undefined {
  return queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey())
    ?.generalSettings.streamerMode;
}

/** Keep a successful General settings write visible while config refetches. */
export function writeCachedGeneralSettings(
  queryClient: QueryClient,
  generalSettings: AppSettings,
): void {
  queryClient.setQueryData<SystemConfigResponse>(
    systemConfigQueryKey(),
    (current) =>
      current === undefined ? current : { ...current, generalSettings },
  );
}
