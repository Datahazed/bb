import { useState } from "react";

import {
  renderSurfaceCopy,
  SURFACE_GROUPS,
  type PluginSurface,
} from "@bb/plugin-api-map";

import {
  copyPluginSurfaceReferenceText,
  pluginSurfaceReferenceText,
} from "./copy-surface-reference";

type CopyStatus = "idle" | "copied" | "failed";

function SurfaceReference({ surface }: { surface: PluginSurface }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const reference = pluginSurfaceReferenceText(surface);

  const copyReference = async () => {
    setCopyStatus(
      (await copyPluginSurfaceReferenceText(surface)) ? "copied" : "failed",
    );
  };

  return (
    <div className="plugin-guide-surface-reference">
      <div>
        <span className="plugin-guide-surface-label">Agent reference</span>
        <code
          className="plugin-guide-surface-reference-text select-text"
          data-plugin-surface-reference
        >
          {reference}
        </code>
      </div>
      <button
        type="button"
        className="plugin-guide-copy-reference"
        onClick={copyReference}
        aria-label={`Copy agent reference for ${surface.title}`}
      >
        {copyStatus === "copied"
          ? "Copied"
          : copyStatus === "failed"
            ? "Copy failed"
            : "Copy reference"}
      </button>
    </div>
  );
}

function SurfaceArticle({ surface }: { surface: PluginSurface }) {
  return (
    <article
      id={`plugin-surface-${surface.id}`}
      className="plugin-guide-surface-card"
      data-plugin-surface-id={surface.id}
    >
      <h4>{surface.title}</h4>
      <p className="plugin-guide-surface-summary">
        {renderSurfaceCopy(surface.summary)}
      </p>

      <SurfaceReference surface={surface} />

      <div className="plugin-guide-surface-api">
        <span className="plugin-guide-surface-label">SDK symbols</span>
        <ul aria-label={`SDK symbols for ${surface.title}`}>
          {surface.apiSymbols.map((symbol) => (
            <li key={symbol}>
              <code className="select-text">{symbol}</code>
            </li>
          ))}
        </ul>
      </div>

      {(surface.bullets.length > 0 ||
        (surface.firstParty && surface.firstParty.length > 0)) && (
        <details className="plugin-guide-surface-details">
          <summary>More about this surface</summary>
          {surface.bullets.length > 0 && (
            <ul>
              {surface.bullets.map((bullet) => (
                <li key={bullet}>{renderSurfaceCopy(bullet)}</li>
              ))}
            </ul>
          )}
          {surface.firstParty && surface.firstParty.length > 0 && (
            <p>
              <strong>Used by:</strong> {surface.firstParty.join(", ")}
            </p>
          )}
        </details>
      )}
    </article>
  );
}

/**
 * The durable, server-rendered Plugin Guide document. ProductMap enhances the
 * same canonical inventory; this section remains complete without JavaScript.
 */
export function PluginSurfaceDocument() {
  return (
    <section
      className="plugin-guide-document"
      aria-labelledby="plugin-guide-document-title"
      data-plugin-surface-document
    >
      <header className="plugin-guide-document-header">
        <p className="plugin-guide-eyebrow">Complete reference</p>
        <h2 id="plugin-guide-document-title">Every surface a plugin can use</h2>
        <p>
          Browse the full SDK surface by where it appears in bb. References and
          symbols are plain text you can copy into any coding agent.
        </p>
      </header>

      {SURFACE_GROUPS.map((group) => (
        <section
          key={group.id}
          id={`plugin-surface-group-${group.id}`}
          className="plugin-guide-surface-group"
          aria-labelledby={`plugin-surface-group-${group.id}-title`}
        >
          <header className="plugin-guide-surface-group-header">
            <h3 id={`plugin-surface-group-${group.id}-title`}>{group.title}</h3>
            <p>{group.blurb}</p>
          </header>
          <div className="plugin-guide-surface-grid">
            {group.surfaces.map((surface) => (
              <SurfaceArticle key={surface.id} surface={surface} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
