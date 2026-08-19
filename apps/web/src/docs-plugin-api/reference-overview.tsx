/**
 * The plugin API overview: quickstart, entry points, and every reference
 * section by task. Rendered as the docs landing page's primary content and by
 * the /docs/plugin-api/reference route, so the two can never drift.
 */
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { PLUGIN_API_MODEL } from "./api-model.generated";
import { DOCS_GROUPS, SECTIONS_BY_GROUP } from "./content";
import { CodeBlock } from "./ui";

const QUICKSTART = `bb plugin new hello            # scaffold ./bb-plugin-hello (add --app for a frontend entry)
cd bb-plugin-hello
bb plugin install .            # register the directory in place
bb plugin dev                  # rebuild + reload on every save`;

const MODULE_SECTION_HINTS: Record<string, string> = {
  root: "plugin-factory",
  app: "app-entry",
  host: "host-entry",
  "provider-bridge": "provider-bridge",
  testing: "testing-backend",
  "testing-app": "testing-frontend",
  "testing-host": "testing-host",
};

const MODULE_BLURBS: Record<string, string> = {
  root: "The backend contract server.ts compiles against: BbPluginApi and every registration type.",
  app: "The frontend runtime: definePluginApp, slots, hooks, and the host components.",
  host: "Define a supervised Node worker that runs on enrolled hosts.",
  "provider-bridge": "The authoring surface for agent-provider bridges.",
  testing: "An in-process fake of the bb server's plugin runtime.",
  "testing-app": "Test app.tsx under vitest + jsdom without the bb host.",
  "testing-host": "Drive a bb.host entry's handlers without a daemon.",
};

export function ReferenceOverview() {
  const totalExports = PLUGIN_API_MODEL.modules.reduce(
    (sum, module) => sum + module.exports.length,
    0,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-2xs uppercase tracking-wide text-subtle-foreground">
        Reference · SDK v{PLUGIN_API_MODEL.sdkVersion}
      </p>
      <h1 className="mt-2 text-lg font-semibold">API reference</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        The exact contracts behind every surface on the{" "}
        <Link
          to="/docs/plugin-api"
          className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          product map
        </Link>
        : {totalExports} exported APIs across {PLUGIN_API_MODEL.modules.length}{" "}
        entry points, generated from the plugin SDK&rsquo;s published type
        declarations and organized by task.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/docs/plugin-api/$section"
          params={{ section: "anatomy" }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90"
        >
          Get started
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
        </Link>
        <Link
          to="/docs/plugin-api/$section"
          params={{ section: "plugin-factory" }}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium text-foreground hover:bg-state-hover"
        >
          Backend API
        </Link>
        <Link
          to="/docs/plugin-api/$section"
          params={{ section: "slots" }}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium text-foreground hover:bg-state-hover"
        >
          Frontend slots
        </Link>
      </div>

      <h2 className="mt-10 text-sm font-semibold">Quickstart</h2>
      <p className="mt-1 text-xs text-subtle-foreground/75">
        Scaffold, install in place, and iterate with live reload.
      </p>
      <CodeBlock code={QUICKSTART} lang="sh" />

      <h2 className="mt-10 text-sm font-semibold">Entry points</h2>
      <p className="mt-1 text-xs text-subtle-foreground/75">
        One npm package, seven public subpaths. Types are erased at load time;
        the frontend runtime is shimmed to the host app.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {PLUGIN_API_MODEL.modules.map((module) => (
          <li key={module.id}>
            <Link
              to="/docs/plugin-api/$section"
              params={{ section: MODULE_SECTION_HINTS[module.id] ?? "anatomy" }}
              className="block h-full rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-state-hover"
            >
              <span className="flex items-baseline justify-between gap-2">
                <code className="break-all font-mono text-xs font-semibold text-foreground">
                  {module.importPath}
                </code>
                <span className="shrink-0 font-mono text-2xs text-subtle-foreground">
                  {module.exports.length} exports
                </span>
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {MODULE_BLURBS[module.id]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-semibold">Browse by task</h2>
      {DOCS_GROUPS.map((group) => {
        const sections = SECTIONS_BY_GROUP.get(group) ?? [];
        if (sections.length === 0) {
          return null;
        }
        return (
          <section key={group} className="mt-5">
            <h3 className="text-xs font-normal leading-5 text-subtle-foreground/75">
              {group}
            </h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {sections.map((section) => (
                <li key={section.id}>
                  <Link
                    to="/docs/plugin-api/$section"
                    params={{ section: section.id }}
                    className="block h-full rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-state-hover"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {section.title}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {section.summary}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="mt-10 border-t border-border-hairline pt-4 text-xs leading-relaxed text-subtle-foreground">
        Generated from{" "}
        <code className="font-mono">
          packages/plugin-sdk/bundled-types/*.d.ts
        </code>
        , the same declarations installed with{" "}
        <code className="font-mono">@get-bb/plugin-sdk</code>. Members prefixed{" "}
        <code className="font-mono">experimental_</code> are audited before
        stabilizing; see <code className="font-mono">docs/api_to_audit.md</code>{" "}
        in the{" "}
        <a
          href="https://github.com/get-bb/bb"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          bb repository
        </a>
        .
      </p>
    </div>
  );
}
