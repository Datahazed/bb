// bb-plugin-plugin-api-docs frontend.
//
// The plugin API docs, inside bb. It renders the same product map the docs
// site does, one annotated skeleton of the bb UI at a time, from the shared
// @bb/plugin-api-map package, so the two can never disagree about what bb can
// be extended with. Because this copy runs inside bb, the composer in the
// diagrams is not a mock: the host's real composer renders in place through
// experimental_NewThreadComposer.
//
// One surface, which the map itself documents: `navPanel`, the map as its own
// full-window page in the sidebar. The skeletons want the whole window, so
// there is deliberately no thread-panel tab.
import { firstPartyPluginId, ProductMap } from "@bb/plugin-api-map";
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer,
} from "@get-bb/plugin-sdk/app";

// JSX reads lowercase-first tags as DOM elements, so the experimental_
// export needs a capitalized alias to render as a component.
const LiveNewThreadComposer = experimental_NewThreadComposer;

/**
 * The plugin ids this bb can actually open a page for: the ones installed on
 * this machine, plus the ones its catalog lists. A built-in that is neither
 * (an uninstalled provider, say) has no page, and linking to it would land on
 * "Plugin not found" — so those names stay plain text.
 */
function useResolvablePluginIds(): ReadonlySet<string> | null {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (url: string, pick: (row: never) => string) => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return [];
        const body = (await response.json()) as unknown;
        const rows = Array.isArray(body)
          ? body
          : ((body as { plugins?: unknown[]; results?: unknown[] }).plugins ??
            (body as { results?: unknown[] }).results ??
            []);
        return rows.map((row) => pick(row as never)).filter(Boolean);
      } catch {
        return [];
      }
    };
    void Promise.all([
      read("/api/v1/plugins", (row: { id?: string }) => row.id ?? ""),
      read(
        "/api/v1/plugin-catalog/search?q=",
        (row: { pluginId?: string }) => row.pluginId ?? "",
      ),
    ]).then(([installed, catalog]) => {
      if (!controller.signal.aborted) {
        setIds(new Set([...installed, ...catalog]));
      }
    });
    return () => controller.abort();
  }, []);
  return ids;
}

function PluginApiMapPage() {
  const resolvable = useResolvablePluginIds();
  const pluginPageHref = useCallback(
    (displayName: string) => {
      const id = firstPartyPluginId(displayName);
      if (!id || !resolvable?.has(id)) return null;
      return `/extensions/plugins/${id}`;
    },
    [resolvable],
  );
  return (
    // Full width, no reading-column cap: the wider the page, the more room
    // the annotation cards have to open beside the skeleton instead of below.
    <div className="w-full px-6 py-6">
      <ProductMap
        header={
          // Matches the reference pages' header hierarchy: small eyebrow, one
          // heading step, body copy, then a rule before the map.
          <header className="border-b border-border-hairline pb-5">
            <p className="text-xs font-normal leading-5 text-subtle-foreground/75">
              Plugin API
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              What can a bb plugin do?
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              A diagram of each bb screen with the plugin surfaces marked on it.
              Use the arrows to move between screens, and select a numbered
              marker to read what that surface does and which shipped plugins
              use it.
            </p>
          </header>
        }
        pluginPageHref={pluginPageHref}
        realComposer={
          <LiveNewThreadComposer
            layout="document"
            // A docs page should never create threads; the draft is kept.
            onSubmit={() => {
              throw new Error("Submitting is disabled in the docs preview.");
            }}
          />
        }
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-api",
    title: "Plugin API Docs",
    icon: "Puzzle",
    path: "plugin-api",
    component: PluginApiMapPage,
  });
});
