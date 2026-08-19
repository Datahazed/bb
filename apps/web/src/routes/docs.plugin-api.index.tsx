import { createFileRoute } from "@tanstack/react-router";
import { ProductMap } from "@bb/plugin-api-map";

import { ReferenceOverview } from "../docs-plugin-api/reference-overview";

export const Route = createFileRoute("/docs/plugin-api/")({
  component: DocsPluginApiIndex,
});

function DocsPluginApiIndex() {
  return (
    <div>
      {/* Primary content: the reference itself. */}
      <ReferenceOverview />

      {/* Supporting explainer. The diagram keeps every behavior it had —
          arrow navigation between screens, numbered markers, per-marker
          detail — but sits below the reference and steps down a level in
          heading, type scale, and emphasis, so it reads as an aid to the
          docs rather than the way in. */}
      <section
        aria-labelledby="screen-anatomy"
        className="mt-14 border-t border-border-hairline pt-8"
      >
        <div className="mx-auto max-w-3xl">
          <h2
            id="screen-anatomy"
            className="text-xs font-normal leading-5 text-subtle-foreground/75"
          >
            Screen anatomy
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            A diagram of each bb screen with the plugin surfaces marked on it.
            Use the arrows to move between screens, and select a numbered marker
            to read what that surface does and which shipped plugins use it.
          </p>
        </div>
        <div className="mt-6">
          <ProductMap tone="supporting" />
        </div>
      </section>
    </div>
  );
}
