import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";

interface MentionInspection {
  title: string;
  description: string | null;
  preview: { kind: "image"; dataUrl: string; alt: string } | null;
  metadata: string;
}

interface PromptMentionInspectorProps {
  itemId: string;
  label: string;
  onOpenChange(open: boolean): void;
  open: boolean;
  pluginId: string;
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

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setInspection(null);
    setError(null);
    const params = new URLSearchParams({ pluginId, itemId });
    void fetch(`/api/v1/plugins/mentions/inspect?${params.toString()}`, {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(46rem,calc(100vh-2rem))] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border-hairline px-5 py-4 pr-12">
          <DialogTitle>{inspection?.title ?? label}</DialogTitle>
          <DialogDescription>
            {inspection?.description ??
              (inspection !== null
                ? "Captured mention details."
                : (error ?? "Loading the captured context…"))}
          </DialogDescription>
        </DialogHeader>
        {inspection ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
            {inspection.preview ? (
              <img
                src={inspection.preview.dataUrl}
                alt={inspection.preview.alt}
                className="max-h-72 w-full rounded-md border border-border-hairline bg-surface-raised object-contain"
              />
            ) : null}
            <section aria-labelledby="mention-inspector-metadata-heading">
              <h3
                id="mention-inspector-metadata-heading"
                className="mb-2 text-xs font-medium text-muted-foreground"
              >
                Captured metadata
              </h3>
              <pre className="max-h-80 overflow-auto rounded-md border border-border-hairline bg-surface-raised/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                {inspection.metadata}
              </pre>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
