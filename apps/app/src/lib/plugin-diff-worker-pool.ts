import type { ReactNode } from "react";

/**
 * Wraps plugin slot content in the diff worker pool, published by the plugin
 * runtime chunk.
 *
 * Plugins may render `@pierre/diffs` FileDiff through the runtime shim, and
 * that needs a worker pool in React context. The thread workspace used to
 * supply one at its root, which is what put the diff renderer on the thread
 * route's preload set.
 *
 * `PluginSlotMount` is on the light side and must not import the renderer, so
 * `plugin-frontend` — which already reaches `@pierre/diffs` statically —
 * registers this when it evaluates. A slot can only render after that module
 * has produced a registration, so the lookup is synchronous and no Suspense
 * boundary appears around plugin content.
 *
 * A render function rather than a component type: a component value read from
 * a module during render is what the React Compiler rejects as "creating
 * components during render".
 */
export type PluginDiffWorkerPoolRenderer = (children: ReactNode) => ReactNode;

let pluginDiffWorkerPoolRenderer: PluginDiffWorkerPoolRenderer | null = null;

export function setPluginDiffWorkerPoolRenderer(
  renderer: PluginDiffWorkerPoolRenderer,
): void {
  pluginDiffWorkerPoolRenderer = renderer;
}

export function getPluginDiffWorkerPoolRenderer(): PluginDiffWorkerPoolRenderer | null {
  return pluginDiffWorkerPoolRenderer;
}
