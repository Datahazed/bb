import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  SearchRemoveIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { highlight } from "sugar-high";

import { cn } from "@/lib/utils";

// One definition, shared with the skeleton markers.
export { annotationChipClass, ExperimentalBadge } from "@bb/plugin-api-map";

export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions, insecure context): stay quiet.
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        className={cn("size-3.5", copied && "text-success")}
      />
    </button>
  );
}

export function CodeBlock({
  code,
  lang,
  title,
  className,
}: {
  code: string;
  lang?: string;
  title?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "my-3 overflow-hidden rounded-md border border-border bg-surface-recessed-solid",
        className,
      )}
    >
      <figcaption className="flex items-center gap-2 border-b border-border-hairline px-3 py-1.5">
        {title ? (
          <span className="truncate text-xs font-medium text-foreground">
            {title}
          </span>
        ) : null}
        <span className="font-mono text-2xs uppercase tracking-wide text-subtle-foreground">
          {lang ?? "ts"}
        </span>
        <span className="flex-1" />
        <CopyButton text={code} label="Copy code" />
      </figcaption>
      <pre className="bb-code-highlight overflow-x-auto px-3 py-2.5">
        <code
          className="font-mono text-xs leading-relaxed"
          // sugar-high output is built from the escaped code text.
          dangerouslySetInnerHTML={{ __html: highlight(code) }}
        />
      </pre>
    </figure>
  );
}

const KIND_LABELS: Record<string, string> = {
  interface: "interface",
  type: "type",
  function: "function",
  class: "class",
  const: "const",
  enum: "enum",
};

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center rounded border border-border px-1.5 py-px font-mono text-2xs text-muted-foreground">
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

export function DocsEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <HugeiconsIcon
        icon={SearchRemoveIcon}
        className="size-6 text-subtle-foreground"
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
