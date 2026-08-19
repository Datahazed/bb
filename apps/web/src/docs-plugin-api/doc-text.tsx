/**
 * Renders JSDoc text from the generated model (and curated intro paragraphs)
 * as React: paragraphs, "- " bullet lists, `code` spans, {@link Symbol}
 * cross-references resolved against the curated section map, and
 * [text](href) links.
 */
import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { SECTION_BY_SYMBOL_NAME } from "./content";

const INLINE_PATTERN =
  /(`[^`]+`)|\{@link\s+([^}|\s]+)(?:\s*\|\s*([^}]+))?\}|\[([^\]]+)\]\(([^)\s]+)\)/g;

function symbolHref(symbolName: string): string | null {
  // {@link Type.member} anchors to the member row on the type's page.
  const [typeName] = symbolName.split(".");
  const sectionId = SECTION_BY_SYMBOL_NAME.get(typeName);
  if (!sectionId) {
    return null;
  }
  return `/docs/plugin-api/${sectionId}#${symbolName}`;
}

export function InlineDocText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const [, codeSpan, linkTarget, linkLabel, mdLabel, mdHref] = match;
    if (codeSpan !== undefined) {
      const code = codeSpan.slice(1, -1);
      const href = symbolHref(code);
      parts.push(
        href ? (
          <Link
            key={key++}
            to={href}
            className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {code}
          </Link>
        ) : (
          <code
            key={key++}
            className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em]"
          >
            {code}
          </code>
        ),
      );
    } else if (linkTarget !== undefined) {
      const href = symbolHref(linkTarget);
      const label = linkLabel?.trim() || linkTarget;
      parts.push(
        href ? (
          <Link
            key={key++}
            to={href}
            className="font-mono text-[0.85em] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {label}
          </Link>
        ) : (
          <code
            key={key++}
            className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em]"
          >
            {label}
          </code>
        ),
      );
    } else if (mdLabel !== undefined && mdHref !== undefined) {
      parts.push(
        mdHref.startsWith("/docs/") ? (
          <Link
            key={key++}
            to={mdHref}
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {mdLabel}
          </Link>
        ) : (
          <a
            key={key++}
            href={mdHref}
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
            {...(mdHref.startsWith("http")
              ? { target: "_blank", rel: "noreferrer" }
              : {})}
          >
            {mdLabel}
          </a>
        ),
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

interface DocBlock {
  kind: "paragraph" | "list";
  lines: string[];
}

function splitBlocks(text: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let current: DocBlock | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      current = null;
      continue;
    }
    const isListItem = /^[-*] /.test(line) || /^\d+\. /.test(line);
    if (isListItem) {
      if (current?.kind !== "list") {
        current = { kind: "list", lines: [] };
        blocks.push(current);
      }
      current.lines.push(line.replace(/^[-*] /, "").replace(/^\d+\. /, ""));
    } else if (current?.kind === "list" && /^\s/.test(rawLine)) {
      // Continuation of the previous list item.
      current.lines[current.lines.length - 1] += ` ${line}`;
    } else if (current?.kind === "paragraph") {
      current.lines[0] += ` ${line}`;
    } else {
      current = { kind: "paragraph", lines: [line] };
      blocks.push(current);
    }
  }
  return blocks;
}

export function DocText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = splitBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, blockIndex) =>
        block.kind === "list" ? (
          <ul
            key={blockIndex}
            className="mb-2 list-disc space-y-1 pl-5 last:mb-0"
          >
            {block.lines.map((line, lineIndex) => (
              <li key={lineIndex}>
                <InlineDocText text={line} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={blockIndex} className="mb-2 last:mb-0">
            <Fragment>
              <InlineDocText text={block.lines[0]} />
            </Fragment>
          </p>
        ),
      )}
    </div>
  );
}
