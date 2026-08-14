import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getWrappedImageIndex,
  ImageLightbox,
} from "@/components/ui/image-lightbox.js";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
import { sdk } from "@/lib/sdk";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";

const MAX_EDITABLE_TEXT_ATTACHMENT_BYTES = 512 * 1024;

function isImageAttachment(attachment: PromptDraftAttachment): boolean {
  return (
    attachment.type === "localImage" ||
    attachment.mimeType?.toLowerCase().startsWith("image/") === true
  );
}

interface AttachmentPreviewProps {
  attachments: PromptDraftAttachment[];
  attachmentProjectId?: string;
  expandedImageIndex: number | null;
  onExpandedImageIndexChange: (index: number | null) => void;
  onRemoveAttachment?: (path: string) => void;
  onReplaceAttachment?: (
    previousPath: string,
    attachment: PromptDraftAttachment,
  ) => void;
}

function isEditableMarkdownAttachment(
  attachment: PromptDraftAttachment,
): boolean {
  const mimeType = attachment.mimeType?.toLowerCase();
  return (
    mimeType === "text/markdown" ||
    mimeType === "text/x-markdown" ||
    attachment.name.toLowerCase().endsWith(".md")
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kibibytes = sizeBytes / 1024;
  return kibibytes < 10
    ? `${kibibytes.toFixed(1)} KB`
    : `${Math.round(kibibytes)} KB`;
}

function markdownSummary(contents: string): string {
  const lines = contents.split(/\r?\n/u);
  const commentIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === "## comment",
  );
  const candidates =
    commentIndex >= 0 ? lines.slice(commentIndex + 1) : lines.slice(0);
  return (
    candidates
      .find((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith("#");
      })
      ?.trim() ?? "Open to preview and edit"
  );
}

interface FileAttachmentCardProps {
  attachment: PromptDraftAttachment;
  projectId?: string;
  onRemoveAttachment?: (path: string) => void;
  onReplaceAttachment?: (
    previousPath: string,
    attachment: PromptDraftAttachment,
  ) => void;
}

function FileAttachmentCard({
  attachment,
  projectId,
  onRemoveAttachment,
  onReplaceAttachment,
}: FileAttachmentCardProps) {
  const editable =
    isEditableMarkdownAttachment(attachment) &&
    projectId !== undefined &&
    projectId.length > 0 &&
    onReplaceAttachment !== undefined &&
    attachment.sizeBytes <= MAX_EDITABLE_TEXT_ATTACHMENT_BYTES;
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editable || projectId === undefined) return;
    const controller = new AbortController();
    setLoadError(null);
    void sdk.projects.attachments
      .read({
        projectId,
        path: attachment.path,
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.sizeBytes > MAX_EDITABLE_TEXT_ATTACHMENT_BYTES) {
          throw new Error("This attachment is too large to edit here.");
        }
        const nextContents = new TextDecoder("utf-8", { fatal: true }).decode(
          result.bytes,
        );
        setContents(nextContents);
        setDraft(nextContents);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load this attachment.",
        );
      });
    return () => controller.abort();
  }, [attachment.path, editable, projectId]);

  const preview = useMemo(
    () => (contents === null ? "Loading preview…" : markdownSummary(contents)),
    [contents],
  );

  const handleSave = useCallback(async () => {
    if (
      projectId === undefined ||
      onReplaceAttachment === undefined ||
      savingRef.current
    ) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const uploaded = await sdk.projects.attachments.upload({
        projectId,
        clientFile: new Blob([draft], { type: "text/markdown" }),
        filename: attachment.name,
        mimeType: "text/markdown",
      });
      if (!mountedRef.current) return;
      setContents(draft);
      setOpen(false);
      onReplaceAttachment(attachment.path, {
        ...uploaded,
        type: "localFile",
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save this attachment.",
      );
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [
    attachment.name,
    attachment.path,
    draft,
    onReplaceAttachment,
    projectId,
  ]);

  const card = (
    <div className="group relative flex h-16 w-60 max-w-full items-center gap-2.5 rounded-md border border-border bg-surface-recessed px-2.5 text-left">
      <span className="flex size-8 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
        <Icon name="File" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">
          {attachment.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
          {loadError ?? preview}
        </span>
        <span className="block text-[10px] leading-3 text-subtle-foreground">
          {formatFileSize(attachment.sizeBytes)}
          {editable ? " · Markdown · Editable" : ""}
        </span>
      </span>
    </div>
  );

  return (
    <>
      <div className="relative max-w-full">
        {editable ? (
          <button
            type="button"
            className="max-w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => setOpen(true)}
            aria-label={`Open and edit ${attachment.name}`}
          >
            {card}
          </button>
        ) : (
          card
        )}
        {onRemoveAttachment ? (
          <button
            type="button"
            onClick={() => onRemoveAttachment(attachment.path)}
            className="absolute right-1 top-1 z-10 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow-sm transition-colors hover:bg-state-hover hover:text-foreground"
            aria-label={`Remove ${attachment.name}`}
          >
            <Icon name="X" className="size-3" />
          </button>
        ) : null}
      </div>

      {editable ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[min(82vh,48rem)] max-w-3xl flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{attachment.name}</DialogTitle>
              <DialogDescription>
                Edit the Markdown context the agent will receive with this
                prompt.
              </DialogDescription>
            </DialogHeader>
            {loadError !== null ? (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                {loadError}
              </div>
            ) : (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label={`Edit ${attachment.name}`}
                spellCheck={false}
                className="min-h-80 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            {saveError !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {saveError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={contents === null || loadError !== null || saving}
              >
                {saving ? "Saving…" : "Save attachment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function AttachmentPreview({
  attachments,
  attachmentProjectId,
  expandedImageIndex,
  onExpandedImageIndexChange,
  onRemoveAttachment,
  onReplaceAttachment,
}: AttachmentPreviewProps) {
  const imageAttachments = attachments.filter(isImageAttachment);
  const nonImageAttachments = attachments.filter(
    (attachment) => !isImageAttachment(attachment),
  );
  const attachmentImageItems = imageAttachments.map((attachment) => ({
    alt: attachment.name,
    src: toUserAttachmentImageSrc(attachment.path, attachmentProjectId),
  }));
  const hasMultipleAttachmentImages = imageAttachments.length > 1;
  const currentAttachmentImage =
    expandedImageIndex !== null
      ? (attachmentImageItems[expandedImageIndex] ?? null)
      : null;

  useEffect(() => {
    if (expandedImageIndex === null) return;
    if (expandedImageIndex < imageAttachments.length) return;
    onExpandedImageIndexChange(null);
  }, [expandedImageIndex, imageAttachments.length, onExpandedImageIndexChange]);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mx-3 mb-1 mt-1">
        {imageAttachments.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-2">
            {imageAttachments.map((attachment, index) => (
              <div key={`${attachment.path}-${index}`} className="relative">
                <button
                  type="button"
                  className="cursor-zoom-in overflow-hidden rounded-md border border-border bg-surface-recessed"
                  onClick={() => onExpandedImageIndexChange(index)}
                  title={attachment.name}
                >
                  <img
                    src={toUserAttachmentImageSrc(
                      attachment.path,
                      attachmentProjectId,
                    )}
                    alt={attachment.name}
                    className="h-16 w-24 object-cover"
                    loading="lazy"
                  />
                </button>
                {onRemoveAttachment ? (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(attachment.path)}
                    className="absolute right-1 top-1 z-10 rounded-full bg-black/55 p-0.5 text-white transition-colors hover:bg-black/70"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <Icon name="X" className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {nonImageAttachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {nonImageAttachments.map((attachment) => (
              <FileAttachmentCard
                key={attachment.path}
                attachment={attachment}
                projectId={attachmentProjectId}
                onRemoveAttachment={onRemoveAttachment}
                onReplaceAttachment={onReplaceAttachment}
              />
            ))}
          </div>
        ) : null}
      </div>

      <ImageLightbox
        imageSrc={currentAttachmentImage?.src ?? null}
        imageAlt={currentAttachmentImage?.alt ?? "Attached image"}
        title="Attached image preview"
        hasMultipleImages={hasMultipleAttachmentImages}
        onPrevious={() => {
          onExpandedImageIndexChange(
            expandedImageIndex === null || attachmentImageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "previous",
                  itemCount: attachmentImageItems.length,
                }),
          );
        }}
        onNext={() => {
          onExpandedImageIndexChange(
            expandedImageIndex === null || attachmentImageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "next",
                  itemCount: attachmentImageItems.length,
                }),
          );
        }}
        onClose={() => onExpandedImageIndexChange(null)}
      />
    </>
  );
}
