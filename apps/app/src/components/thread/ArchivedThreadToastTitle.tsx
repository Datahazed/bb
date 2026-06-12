interface ArchivedThreadToastTitleProps {
  onOpenThread: () => void;
  threadTitle: string;
}

/**
 * Rendered inside the Sonner toaster, which mounts outside the router —
 * navigation must come from the caller via onOpenThread rather than a <Link>.
 */
export function ArchivedThreadToastTitle({
  onOpenThread,
  threadTitle,
}: ArchivedThreadToastTitleProps) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden whitespace-nowrap">
      <span className="shrink-0">Archived</span>{" "}
      <button
        type="button"
        className="min-w-0 truncate underline underline-offset-2"
        title={threadTitle}
        onClick={onOpenThread}
      >
        {threadTitle}
      </button>
    </span>
  );
}
