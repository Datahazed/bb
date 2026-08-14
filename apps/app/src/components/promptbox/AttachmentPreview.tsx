import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  getWrappedImageIndex,
  ImageLightbox,
} from "@/components/ui/image-lightbox.js";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
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
  const [expanded, setExpanded] = useState(false);
  const [contents, setContents] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const editorId = useId();

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
      setExpanded(false);
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

  const cardContents = (
    <>
      <Icon name="File" className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">
          {attachment.name}
        </span>
        <span className="mt-0.5 block text-[10px] leading-3 text-subtle-foreground">
          {formatFileSize(attachment.sizeBytes)}
        </span>
      </span>
    </>
  );

  return (
    <div className="relative w-[28rem] max-w-full rounded-md border border-border bg-surface-recessed/35 transition-colors hover:bg-surface-recessed/50">
      <div className="relative flex h-12 max-w-full items-center gap-2.5 px-2.5 pr-8 text-left">
        {editable ? (
          <button
            type="button"
            className="absolute inset-0 flex max-w-full items-center gap-2.5 rounded-md px-2.5 pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-controls={editorId}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${attachment.name}`}
          >
            {cardContents}
          </button>
        ) : (
          cardContents
        )}
        {onRemoveAttachment ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.path)}
                className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${attachment.name}`}
              >
                <Icon name="X" className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Remove attachment</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {editable && expanded ? (
        <div id={editorId} className="border-t border-border/70 p-2.5 pt-2">
          {loadError !== null ? (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
              role="alert"
            >
              {loadError}
            </div>
          ) : contents === null ? (
            <p className="m-0 py-3 text-center text-xs text-muted-foreground">
              Loading…
            </p>
          ) : (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={`Edit ${attachment.name}`}
              spellCheck={false}
              autoFocus
              className="max-h-72 min-h-48 w-full resize-y rounded-md border border-border bg-background/75 p-2.5 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
          {saveError !== null ? (
            <p className="mb-0 mt-2 text-xs text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Cancel editing ${attachment.name}`}
                  onClick={() => {
                    setDraft(contents ?? "");
                    setSaveError(null);
                    setExpanded(false);
                  }}
                >
                  <Icon name="X" className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Cancel editing</TooltipContent>
            </Tooltip>
            <button
              type="button"
              className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-55"
              onClick={() => void handleSave()}
              disabled={contents === null || loadError !== null || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
