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
 * registers this when it evaluates.
 *
 * The ordering is what makes a synchronous read safe, and it is worth stating
 * plainly. `plugin-frontend` is the only writer of plugin slot registrations,
 * and it sets this renderer at module evaluation, before it can write any. A
 * slot renders only from a registration, so by then the renderer is already
 * here. The value therefore never flips from null to set between two renders
 * of a mounted slot, which would change the tree shape around plugin content
 * and remount it. A Suspense boundary would avoid that hazard but introduce
 * its own: it delays every composer banner and message directive by a frame.
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
