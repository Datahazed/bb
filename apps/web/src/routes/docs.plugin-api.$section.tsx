import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { PLUGIN_API_MODEL } from "../docs-plugin-api/api-model.generated";
import {
  DOCS_SECTIONS,
  sectionById,
  type DocsSection,
  type DocsSymbolRef,
} from "../docs-plugin-api/content";
import { indexModel, symbolKey } from "../docs-plugin-api/model";
import { DocText } from "../docs-plugin-api/doc-text";
import { SymbolArticle } from "../docs-plugin-api/symbol-article";
import { CodeBlock, DocsEmptyState } from "../docs-plugin-api/ui";

export const Route = createFileRoute("/docs/plugin-api/$section")({
  head: ({ params }) => {
    const section = sectionById(params.section);
    return {
      meta: section
        ? [
            { title: `${section.title} — bb Plugin API` },
            { name: "description", content: section.summary },
          ]
        : [{ title: "Not found — bb Plugin API" }],
    };
  },
  component: DocsSectionRoute,
});

const MODEL_INDEX = indexModel(PLUGIN_API_MODEL);
const MODULE_IMPORT_PATHS = new Map(
  PLUGIN_API_MODEL.modules.map((module) => [module.id, module.importPath]),
);

function UnknownSection({ sectionId }: { sectionId: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <DocsEmptyState
        title="This page doesn't exist"
        description={`There is no plugin API section called “${sectionId}”. It may have moved — every section is listed in the sidebar, or start from the overview.`}
        action={
          <Link
            to="/docs/plugin-api"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium text-foreground hover:bg-state-hover"
          >
            Back to the overview
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
          </Link>
        }
      />
    </div>
  );
}

function SectionPager({ section }: { section: DocsSection }) {
  const index = DOCS_SECTIONS.findIndex((entry) => entry.id === section.id);
  const previous = index > 0 ? DOCS_SECTIONS[index - 1] : null;
  const next =
    index >= 0 && index < DOCS_SECTIONS.length - 1
      ? DOCS_SECTIONS[index + 1]
      : null;
  return (
    <nav
      aria-label="Section pagination"
      className="mt-12 flex gap-2 border-t border-border-hairline pt-4"
    >
      {previous ? (
        <Link
          to="/docs/plugin-api/$section"
          params={{ section: previous.id }}
          className="group flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-state-hover"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-3.5 shrink-0 text-subtle-foreground group-hover:text-foreground"
          />
          <span className="min-w-0">
            <span className="block text-2xs text-subtle-foreground">
              Previous
            </span>
            <span className="block truncate text-xs font-medium text-foreground">
              {previous.title}
            </span>
          </span>
        </Link>
      ) : null}
      <span className="flex-1" />
      {next ? (
        <Link
          to="/docs/plugin-api/$section"
          params={{ section: next.id }}
          className="group flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-right hover:bg-state-hover"
        >
          <span className="min-w-0">
            <span className="block text-2xs text-subtle-foreground">Next</span>
            <span className="block truncate text-xs font-medium text-foreground">
              {next.title}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-3.5 shrink-0 text-subtle-foreground group-hover:text-foreground"
          />
        </Link>
      ) : null}
    </nav>
  );
}

function OnThisPage({ section }: { section: DocsSection }) {
  const refs = section.symbolGroups.flatMap((group) => group.symbols);
  if (refs.length === 0) {
    return null;
  }
  return (
    <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-56 shrink-0 overflow-y-auto pl-8 xl:block">
      <p className="text-xs font-normal leading-5 text-subtle-foreground/75">
        On this page
      </p>
      <ul className="mt-1 space-y-0.5 border-l border-border-hairline">
        {refs.map((ref) => (
          <li key={symbolKey(ref)}>
            <a
              href={`#${ref.name}`}
              className="block truncate border-l-2 border-transparent py-0.5 pl-3 font-mono text-2xs text-muted-foreground hover:border-border hover:text-foreground"
            >
              {ref.name}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function SymbolGroupArticles({
  section,
  refs,
}: {
  section: DocsSection;
  refs: DocsSymbolRef[];
}) {
  return (
    <div className="space-y-10">
      {refs.map((ref) => {
        const symbol = MODEL_INDEX.get(symbolKey(ref));
        if (!symbol) {
          return null; // Impossible per docs-content.test.ts; render nothing.
        }
        return (
          <SymbolArticle
            key={symbolKey(ref)}
            symbol={symbol}
            importPath={MODULE_IMPORT_PATHS.get(ref.module) ?? section.id}
          />
        );
      })}
    </div>
  );
}

function DocsSectionRoute() {
  const { section: sectionId } = Route.useParams();
  const section = sectionById(sectionId);
  if (!section) {
    return <UnknownSection sectionId={sectionId} />;
  }

  return (
    <div className="flex">
      <div className="mx-auto min-w-0 max-w-3xl flex-1">
        <p className="text-xs font-normal leading-5 text-subtle-foreground/75">
          {section.group}
        </p>
        <h1 className="mt-1 text-lg font-semibold">{section.title}</h1>

        <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          {section.intro.map((paragraph, index) => (
            <DocText key={index} text={paragraph} />
          ))}
        </div>

        {section.examples?.map((example) => (
          <CodeBlock
            key={example.title}
            code={example.code}
            lang={example.lang}
            title={example.title}
            className="mt-4"
          />
        ))}

        {section.symbolGroups.map((group, groupIndex) => (
          <section key={group.title ?? groupIndex} className="mt-10">
            {group.title ? (
              <h2 className="border-b border-border-hairline pb-2 text-base font-semibold">
                {group.title}
              </h2>
            ) : null}
            {group.blurb ? (
              <p className="mt-2 text-xs text-subtle-foreground/75">
                {group.blurb}
              </p>
            ) : null}
            <div className={group.title ? "mt-6" : ""}>
              <SymbolGroupArticles section={section} refs={group.symbols} />
            </div>
          </section>
        ))}

        <SectionPager section={section} />
      </div>
      <OnThisPage section={section} />
    </div>
  );
}
