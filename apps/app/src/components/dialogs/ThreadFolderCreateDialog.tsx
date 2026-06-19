import { useId, useState, type FormEvent, type RefObject } from "react";
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
import { normalizeFolderPath } from "@/components/sidebar/folderPath";
import { useNameValidation } from "./useNameValidation.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

interface ThreadFolderCreateDialogProps {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (path: string) => void;
}

interface ThreadFolderCreateDialogContentProps {
  pending: boolean;
  onCreate: (path: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ThreadFolderCreateDialog({
  open,
  pending = false,
  onOpenChange,
  onCreate,
}: ThreadFolderCreateDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {open ? (
          <ThreadFolderCreateDialogContent
            pending={pending}
            onCreate={onCreate}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ThreadFolderCreateDialogContent({
  pending,
  onCreate,
  inputRef,
}: ThreadFolderCreateDialogContentProps) {
  const inputId = useId();
  const [path, setPath] = useState("");
  const [folderPathMessage, setFolderPathMessage] = useState<string | null>(
    null,
  );
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Folder name cannot be empty.",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedPath = validate(path);
    if (trimmedPath === null) return;
    const normalizedPath = normalizeFolderPath(trimmedPath);
    if (normalizedPath === null) {
      setFolderPathMessage("Folder name cannot be empty.");
      return;
    }

    onCreate(normalizedPath);
  };
  const displayedMessage = validationMessage ?? folderPathMessage;

  return (
    <>
      <DialogHeader>
        <DialogTitle>New folder</DialogTitle>
        <DialogDescription>Create a folder for threads.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label="Folder name"
            value={path}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setPath(event.target.value);
              setFolderPathMessage(null);
              clearMessage();
            }}
          />
          {displayedMessage ? (
            <p className="text-sm text-destructive">{displayedMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            Create folder
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
