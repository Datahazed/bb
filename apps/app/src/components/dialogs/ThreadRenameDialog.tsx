import { useId, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  formatFolderPathLabel,
  parseThreadFolderPath,
} from "@/components/sidebar/folderPath";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

export interface ThreadRenameDialogTarget {
  id: string;
}

interface ThreadRenameDialogProps {
  target: ThreadRenameDialogTarget | null;
  // The draft is lifted into the provider so it survives a rename → first-folder
  // modal → rename round trip; the dialog renders it as a controlled input.
  draft: string;
  validationMessage: string | null;
  pending?: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ThreadRenameDialog({
  target,
  draft,
  validationMessage,
  pending = false,
  onDraftChange,
  onSubmit,
  onOpenChange,
}: ThreadRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <ThreadRenameDialogContent
            draft={draft}
            validationMessage={validationMessage}
            pending={pending}
            onDraftChange={onDraftChange}
            onSubmit={onSubmit}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface ThreadRenameDialogContentProps {
  draft: string;
  validationMessage: string | null;
  pending: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

// Reveals the folder the row normally hides: parses the current draft and shows
// the resulting folder ancestors + leaf, or "No folder" for a single segment.
function RenameFolderPreview({ draft }: { draft: string }) {
  const { folders, leaf } = parseThreadFolderPath(draft);
  if (folders.length === 0) {
    return <p className="text-sm text-muted-foreground">No folder</p>;
  }
  return (
    <p className="text-sm text-muted-foreground">
      Folder:{" "}
      <span className="text-foreground">{formatFolderPathLabel(folders)}</span>
      {" · "}
      Thread: <span className="text-foreground">{leaf}</span>
    </p>
  );
}

export function ThreadRenameDialogContent({
  draft,
  validationMessage,
  pending,
  onDraftChange,
  onSubmit,
  inputRef,
}: ThreadRenameDialogContentProps) {
  const inputId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    onSubmit();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename thread</DialogTitle>
        <DialogDescription>Choose a new name for this thread.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label="Thread name"
            value={draft}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <RenameFolderPreview draft={draft} />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            Rename thread
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
