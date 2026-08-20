import { useLayoutEffect, type RefObject } from "react";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { RenameDialog, RenameDialogContent } from "./RenameDialog";

export interface ProjectRenameDialogTarget {
  id: string;
  currentName: string;
}

interface ProjectRenameDialogProps {
  target: ProjectRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (projectId: string, name: string) => void;
}

export interface ProjectRenameDialogContentProps {
  target: ProjectRenameDialogTarget;
  pending: boolean;
  onRename: (projectId: string, name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Restores autofocus when a lazy body mounts after the shell opened. */
  focusOnMount?: boolean;
}

export function ProjectRenameDialog({
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ProjectRenameDialogProps) {
  return (
    <RenameDialog open={target !== null} onOpenChange={onOpenChange}>
      {(inputRef) =>
        target ? (
          <ProjectRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

export function ProjectRenameDialogContent({
  target,
  pending,
  onRename,
  inputRef,
  focusOnMount = false,
}: ProjectRenameDialogContentProps) {
  const isPointerCoarse = usePointerCoarse();
  useLayoutEffect(() => {
    if (!focusOnMount || isPointerCoarse) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusOnMount, inputRef, isPointerCoarse]);

  return (
    <RenameDialogContent
      entityLabel="project"
      initialName={target.currentName}
      pending={pending}
      autoCapitalize="words"
      onRename={(name) => onRename(target.id, name)}
      inputRef={inputRef}
    />
  );
}
