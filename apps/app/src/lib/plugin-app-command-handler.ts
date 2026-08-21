import type {
  ExperimentalPluginAppCommandHandler,
  ExperimentalPluginAppCommandId,
} from "@get-bb/plugin-sdk";

type Owner = string | symbol;

interface Registration {
  command: ExperimentalPluginAppCommandId;
  handler: ExperimentalPluginAppCommandHandler;
  owner: Owner;
  pluginId: string;
}

let activeRegistration: Registration | null = null;

export function registerPluginAppCommandHandler(
  command: ExperimentalPluginAppCommandId,
  handler: ExperimentalPluginAppCommandHandler,
  pluginId: string,
  owner: Owner,
): () => void {
  const registration = { command, handler, owner, pluginId };
  activeRegistration = registration;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (activeRegistration === registration) activeRegistration = null;
  };
}

export function clearPluginAppCommandHandlerByOwner(owner: Owner): void {
  if (activeRegistration?.owner === owner) activeRegistration = null;
}

export function runPluginAppCommandHandler(
  command: string,
  warn: (message: string) => void = console.warn,
): boolean {
  const registration = activeRegistration;
  if (registration === null || registration.command !== command) return false;
  const report = (error: unknown) =>
    warn(
      `[plugin:${registration.pluginId}] app command "${command}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  try {
    const result = registration.handler();
    if (result instanceof Promise) result.catch(report);
  } catch (error) {
    report(error);
  }
  return true;
}

export function resetPluginAppCommandHandlerForTest(): void {
  activeRegistration = null;
}
