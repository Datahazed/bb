import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { OverflowFade } from "@/components/ui/overflow-fade";

interface MentionInspection {
  title: string;
  /** `null` remains accepted from an older server build. */
  description?: string | null;
  /** `null` remains accepted from an older server build. */
  preview?: { kind: "image"; dataUrl: string; alt: string } | null;
  metadata: string;
}

interface PromptMentionInspectorProps {
  itemId: string;
  label: string;
  onOpenChange(open: boolean): void;
  open: boolean;
  pluginId: string;
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
}: PromptMentionInspectorProps) {
  const [inspection, setInspection] = useState<MentionInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setInspection(null);
    setError(null);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="gap-1 border-b border-border-hairline px-5 py-4 pr-12">
          <DialogTitle className="text-base leading-snug">
            {inspection?.title ?? label}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {inspection?.description ??
              (inspection !== null
                ? "Captured mention details."
                : (error ?? "Loading the captured context…"))}
          </DialogDescription>
        </DialogHeader>
        {inspection ? (
          <div className="relative isolate min-h-0 overflow-hidden">
            <div
              ref={scrollRef}
              data-mention-inspector-scroll="true"
              className="max-h-[min(34rem,calc(100dvh-8rem))] overflow-x-hidden overflow-y-auto overscroll-contain"
              onScroll={(event) => measureOverflow(event.currentTarget)}
            >
              <div ref={contentRef} className="grid gap-4 px-5 py-4">
                {inspection.preview ? (
                  <div className="overflow-hidden rounded-md border border-border-hairline bg-surface-raised/40 p-2">
                    <img
                      src={inspection.preview.dataUrl}
                      alt={inspection.preview.alt}
                      className="max-h-60 w-full object-contain"
                      onLoad={() => {
                        if (scrollRef.current !== null) {
                          measureOverflow(scrollRef.current);
                        }
                      }}
                    />
                  </div>
                ) : null}
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
  );
}
