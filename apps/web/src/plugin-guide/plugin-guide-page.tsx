import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import {
  renderSurfaceCopy,
  SURFACE_GROUPS,
  type PluginSurface,
} from "@bb/plugin-api-map";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useEffect, useState } from "react";

import { initAnalytics } from "../landing/analytics.js";
import { InstallOptions } from "../landing/cta.js";
import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import { copyPlainText } from "../lib/copy-plain-text.js";
import {
  copyPluginSurfaceReferenceText,
  pluginSurfaceReferenceText,
} from "./copy-surface-reference.js";

type CopyStatus = "idle" | "copied" | "failed";

const LazyProductMap = lazy(() =>
  import("@bb/plugin-api-map").then((module) => ({
    default: module.ProductMap,
  })),
);

function SurfaceReference({ surface }: { surface: PluginSurface }) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const reference = pluginSurfaceReferenceText(surface);

  const copyReference = async () => {
    setStatus(
      (await copyPluginSurfaceReferenceText(surface)) ? "copied" : "failed",
    );
  };

  return (
    <div className="guide-reference">
      <code className="guide-reference-text">{reference}</code>
      <button
        type="button"
        onClick={() => void copyReference()}
        aria-label={`Copy agent reference for ${surface.title}`}
      >
        <HugeiconsIcon
          icon={status === "copied" ? Tick02Icon : Copy01Icon}
          aria-hidden
        />
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed"
            : "Copy"}
      </button>
    </div>
  );
}

function SurfaceArticle({ surface }: { surface: PluginSurface }) {
  return (
    <article id={`surface-${surface.id}`} className="guide-surface-card">
      <div className="guide-surface-title-row">
        <h3>{surface.title}</h3>
        {surface.experimental ? (
          <span className="guide-experimental">Experimental</span>
        ) : null}
      </div>
      <p>{renderSurfaceCopy(surface.summary)}</p>
      <SurfaceReference surface={surface} />
      <div className="guide-symbols">
        <span>SDK symbols</span>
        <ul aria-label={`SDK symbols for ${surface.title}`}>
          {surface.apiSymbols.map((symbol) => (
            <li key={symbol}>
              <code>{symbol}</code>
            </li>
          ))}
        </ul>
      </div>
      {surface.bullets.length > 0 || surface.firstParty?.length ? (
        <details>
          <summary>How it works</summary>
          {surface.bullets.length > 0 ? (
            <ul className="guide-surface-bullets">
              {surface.bullets.map((bullet) => (
                <li key={bullet}>{renderSurfaceCopy(bullet)}</li>
              ))}
            </ul>
          ) : null}
          {surface.firstParty?.length ? (
            <p className="guide-used-by">
              <strong>Used by:</strong> {surface.firstParty.join(", ")}
            </p>
          ) : null}
        </details>
      ) : null}
    </article>
  );
}

export function PluginSurfaceDocument() {
  return (
    <section id="plugin-surfaces" className="guide-document">
      <header className="guide-document-head">
        <h2>Every surface a plugin can use</h2>
        <p>
          Organized by where each surface appears. Copy an agent reference to
          give any coding agent the exact SDK context in plain text.
        </p>
      </header>

      {SURFACE_GROUPS.map((group) => (
        <section
          key={group.id}
          id={`surface-group-${group.id}`}
          className="guide-group"
        >
          <header>
            <h2>{group.title}</h2>
            <p>{group.blurb}</p>
          </header>
          <div className="guide-surface-grid">
            {group.surfaces.map((surface) => (
              <SurfaceArticle key={surface.id} surface={surface} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

export function PluginGuidePage() {
  const [promptStatus, setPromptStatus] = useState<CopyStatus>("idle");
  useEffect(() => {
    initAnalytics();
  }, []);

  const copyCreatePrompt = async () => {
    setPromptStatus(
      (await copyPlainText(CREATE_PLUGIN_PROMPT)) ? "copied" : "failed",
    );
  };

  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="guide-main">
        <header className="plugin-page-head">
          <h1>Build plugins for bb</h1>
          <p>
            Extend the app, the command line, and the agents inside bb. This is
            the complete reference to the product surfaces plugins can use.
          </p>
          <div className="plugin-page-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void copyCreatePrompt()}
            >
              {promptStatus === "copied"
                ? "Build prompt copied"
                : "Build a plugin"}
            </button>
            <a className="btn btn-ghost" href="#get-bb">
              Get bb
            </a>
            <a className="plugin-text-link" href="/marketplace">
              Browse the Marketplace
            </a>
          </div>
          <p className="guide-prompt-status" role="status" aria-live="polite">
            {promptStatus === "copied"
              ? "Copied as plain text. Paste it into any coding agent."
              : promptStatus === "failed"
                ? "Copy failed. Select the prompt below and copy it manually."
                : "Copies the same plain-text prompt bb uses to start a plugin."}
          </p>
          <code className="guide-create-prompt">{CREATE_PLUGIN_PROMPT}</code>
        </header>

        <nav className="guide-index" aria-label="Plugin surface groups">
          {SURFACE_GROUPS.map((group) => (
            <a key={group.id} href={`#surface-group-${group.id}`}>
              {group.title}
              <span>{group.surfaces.length}</span>
            </a>
          ))}
        </nav>

        <section
          className="guide-map-section"
          aria-labelledby="guide-map-title"
        >
          <div className="guide-map-viewport" data-guide-stage-viewport>
            <Suspense
              fallback={
                <div className="guide-map-loading" role="status">
                  Loading the interactive surface map…
                </div>
              }
            >
              <LazyProductMap
                tone="primary"
                onCopyForAgent={copyPluginSurfaceReferenceText}
                header={
                  <header className="guide-map-head">
                    <h2 id="guide-map-title">See where plugins plug in</h2>
                    <p>
                      Move through bb one product surface at a time, then open a
                      marker to inspect the SDK capability behind it.
                    </p>
                  </header>
                }
              />
            </Suspense>
          </div>
        </section>

        <PluginSurfaceDocument />

        <section id="get-bb" className="guide-install">
          <h2>Get bb</h2>
          <p>Free, open source, and local-first. Install in under a minute.</p>
          <InstallOptions placement="plugin-guide" />
        </section>

        <aside className="plugin-cross-link">
          <div>
            <strong>Looking for something ready-made?</strong>
            <span>Explore plugins built by the bb community.</span>
          </div>
          <a className="btn btn-ghost" href="/marketplace">
            Browse the Marketplace
          </a>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
