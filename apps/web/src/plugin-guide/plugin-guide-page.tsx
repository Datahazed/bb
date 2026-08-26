import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { ProductMap } from "@bb/plugin-api-map";
import { PluginBrowseHeroCarousel } from "@bb/showcase-hero";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { initAnalytics } from "../landing/analytics.js";
import { InstallOptions } from "../landing/cta.js";
import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import {
  copyPlainText,
  copyPluginSurfaceReferenceText,
} from "./copy-surface-reference.js";
import { PluginSurfaceDocument } from "./surface-document.js";

type PromptCopyStatus = "idle" | "copied" | "failed";

export function PluginGuidePage() {
  const [promptCopyStatus, setPromptCopyStatus] =
    useState<PromptCopyStatus>("idle");

  useEffect(() => {
    initAnalytics();
  }, []);

  const copyCreatePrompt = async () => {
    setPromptCopyStatus(
      (await copyPlainText(CREATE_PLUGIN_PROMPT)) ? "copied" : "failed",
    );
  };

  return (
    <div className="wrap plugin-guide-wrap">
      <SiteNav />
      <main className="plugin-guide-main">
        <header className="plugin-guide-page-header">
          <p className="plugin-guide-eyebrow">Plugin SDK</p>
          <h1>Build a bb plugin</h1>
          <p>
            Add product surfaces, commands, tools, services, and agent skills
            without forking bb. This is the complete map of what a plugin can
            change today.
          </p>
          <div className="plugin-guide-primary-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void copyCreatePrompt()}
            >
              {promptCopyStatus === "copied"
                ? "Build prompt copied"
                : "Build a plugin"}
            </button>
            <a className="btn btn-ghost" href="#get-bb">
              Get bb
            </a>
            <Link className="plugin-guide-catalog-link" to="/marketplace">
              Browse the marketplace →
            </Link>
          </div>
          <p
            className="plugin-guide-copy-status"
            role="status"
            aria-live="polite"
          >
            {promptCopyStatus === "copied"
              ? "Copied as plain text. Paste it into bb, Claude Code, or Cursor."
              : promptCopyStatus === "failed"
                ? "Copy failed. Select the prompt below and copy it manually."
                : "Copies the same plain-text prompt bb uses to start a plugin."}
          </p>
          <code className="plugin-guide-create-prompt select-text">
            {CREATE_PLUGIN_PROMPT}
          </code>
        </header>

        <div className="plugin-guide-showcase">
          <PluginBrowseHeroCarousel />
        </div>

        <section
          className="plugin-guide-map-section"
          aria-labelledby="plugin-guide-map-title"
        >
          <div
            data-guide-stage-viewport
            className="plugin-guide-map-viewport [container-type:size] [--guide-stage-gap:3cqh]"
          >
            <ProductMap
              tone="primary"
              onCopyForAgent={copyPluginSurfaceReferenceText}
              header={
                <header className="plugin-guide-map-header">
                  <p className="plugin-guide-eyebrow">Interactive map</p>
                  <h2 id="plugin-guide-map-title">See where plugins plug in</h2>
                  <p>
                    Move through bb one surface at a time. Select a numbered
                    marker to inspect it, then copy its plain-text reference
                    into any coding agent.
                  </p>
                </header>
              }
            />
          </div>
        </section>

        <PluginSurfaceDocument />

        <section
          id="get-bb"
          className="plugin-guide-install"
          aria-labelledby="plugin-guide-install-title"
        >
          <p className="plugin-guide-eyebrow">Start building</p>
          <h2 id="plugin-guide-install-title">Get bb</h2>
          <p>Free, open source, and local-first. Install in under a minute.</p>
          <InstallOptions placement="plugin-guide" />
        </section>

        <aside className="plugin-guide-marketplace-return">
          <span>Looking for something ready-made?</span>
          <Link to="/marketplace">Browse the plugin marketplace</Link>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
