import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { OverflowFade } from "@/components/ui/overflow-fade";

interface MentionInspection {
  title: string;
  /** `null` remains accepted from an older server build. */
  description?: string | null;
  /** `null` remains accepted from an older server build. */
  preview?: { kind: "image"; dataUrl: string; alt: string } | null;
  comments?: readonly string[] | null;
  metadata: string;
}

interface PromptMentionInspectorProps {
  itemId: string;
  label: string;
  onOpenChange(open: boolean): void;
  open: boolean;
  pluginId: string;
  restoreFocus?: () => void;
}

interface InspectorOverflowState {
  above: boolean;
  below: boolean;
}

export function PromptMentionInspector({
  itemId,
  label,
  onOpenChange,
  open,
  pluginId,
  restoreFocus,
}: PromptMentionInspectorProps) {
  const [inspection, setInspection] = useState<MentionInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageExpanded, setImageExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<InspectorOverflowState>({
    above: false,
    below: false,
  });
  const measureOverflow = useCallback((scroll: HTMLDivElement) => {
    const next = {
      above: scroll.scrollTop > 1,
      below: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 1,
    };
    setOverflow((previous) =>
      previous.above === next.above && previous.below === next.below
        ? previous
        : next,
    );
  }, []);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setImageExpanded(false);
      onOpenChange(nextOpen);
      if (!nextOpen && restoreFocus !== undefined) {
        window.setTimeout(restoreFocus, 0);
      }
    },
    [onOpenChange, restoreFocus],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setInspection(null);
    setError(null);
    setImageExpanded(false);
    void fetch("/api/v1/plugins/mentions/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pluginId, itemId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          ok?: boolean;
          inspection?: MentionInspection;
          error?: string;
        };
        if (!response.ok || body.ok !== true || body.inspection === undefined) {
          throw new Error(body.error ?? "Could not inspect this mention");
        }
        setInspection(body.inspection);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not inspect this mention",
          );
        }
      });
    return () => controller.abort();
  }, [itemId, open, pluginId]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!open || inspection === null || scroll === null) return;
    measureOverflow(scroll);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureOverflow(scroll));
    observer.observe(scroll);
    if (contentRef.current !== null) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [inspection, measureOverflow, open]);

  const comments = inspection?.comments ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] max-w-lg gap-0 overflow-hidden p-0 [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0">
          <DialogHeader className="min-w-0 gap-1 border-b border-border-hairline px-5 py-4 pr-12">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <DialogTitle className="min-w-0 text-base leading-snug break-words [overflow-wrap:anywhere]">
                {inspection?.title ?? label}
              </DialogTitle>
              {inspection?.preview && inspection.comments !== undefined ? (
                <span
                  data-mention-inspector-comment-count="true"
                  className="inline-flex w-fit items-center rounded-full bg-muted/70 px-2 py-0.5 text-[11px] leading-4 font-medium text-muted-foreground"
                >
                  {comments.length} comment{comments.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <DialogDescription
              className={
                inspection?.preview && inspection.comments !== undefined
                  ? "sr-only"
                  : "text-xs leading-relaxed"
              }
            >
              {inspection?.preview && inspection.comments !== undefined
                ? `${comments.length} comment${comments.length === 1 ? "" : "s"} attached to this captured selection.`
                : (inspection?.description ??
                  (inspection !== null
                    ? "Captured mention details."
                    : (error ?? "Loading the captured context…")))}
            </DialogDescription>
          </DialogHeader>
          {inspection ? (
            <div className="relative isolate min-h-0 min-w-0 overflow-hidden">
              <div
                ref={scrollRef}
                data-mention-inspector-scroll="true"
                role="region"
                aria-label="Mention details"
                tabIndex={0}
                className="max-h-[min(34rem,calc(100dvh-8rem))] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onScroll={(event) => measureOverflow(event.currentTarget)}
              >
                <div ref={contentRef} className="grid min-w-0 gap-4 px-5 py-4">
                  {inspection.preview ? (
                    <button
                      type="button"
                      className="min-w-0 overflow-hidden rounded-md border border-border-hairline bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Open full-size screenshot: ${inspection.preview.alt}`}
                      onClick={() => setImageExpanded(true)}
                    >
                      <img
                        src={inspection.preview.dataUrl}
                        alt={inspection.preview.alt}
                        className="max-h-72 w-full cursor-zoom-in object-contain"
                        onLoad={() => {
                          if (scrollRef.current !== null) {
                            measureOverflow(scrollRef.current);
                          }
                        }}
                      />
                    </button>
                  ) : null}
                  {inspection.preview && comments.length > 0 ? (
                    <ol aria-label="Comments" className="grid min-w-0 gap-1">
                      {comments.map((comment, index) => (
                        <li
                          key={`${index}:${comment}`}
                          data-mention-inspector-comment="true"
                          className="grid min-w-0 grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-1.5 rounded-lg bg-muted/70 px-2 py-1.5"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex size-[1.125rem] items-center justify-center rounded-full bg-state-hover text-[10px] leading-none font-semibold text-muted-foreground"
                          >
                            {index + 1}
                          </span>
                          <p className="mt-px min-w-0 text-xs leading-[1.35] whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]">
                            {comment}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {!inspection.preview ? (
                    <section aria-labelledby="mention-inspector-metadata-heading">
                      <h3
                        id="mention-inspector-metadata-heading"
                        className="mb-2 text-xs font-medium text-muted-foreground"
                      >
                        Captured metadata
                      </h3>
                      <pre className="rounded-md border border-border-hairline bg-surface-raised/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                        {inspection.metadata}
                      </pre>
                    </section>
                  ) : null}
                </div>
              </div>
              {overflow.above ? (
                <OverflowFade
                  placement="above"
                  tone="background"
                  inset
                  className="z-10"
                />
              ) : null}
              {overflow.below ? (
                <OverflowFade
                  placement="below"
                  tone="background"
                  inset
                  className="z-10"
                />
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {inspection?.preview ? (
        <ImageLightbox
          imageAlt={inspection.preview.alt}
          imageSrc={imageExpanded ? inspection.preview.dataUrl : null}
          onClose={() => setImageExpanded(false)}
          title={`Screenshot preview: ${inspection.title}`}
        />
      ) : null}
    </>
  );
}
