import { useRef, useState, type ReactNode } from "react";
import {
  EnvironmentRenameDialog,
  type EnvironmentRenameDialogTarget,
} from "@/components/dialogs/EnvironmentRenameDialog";

interface WorktreeNameStoryStateArgs {
  branchName?: string;
  environmentId: string;
  initialName: string | null;
}

interface WorktreeNameStoryState {
  name: string | null;
  onRenameWorktree: () => void;
  renameDialog: ReactNode;
}

export function useWorktreeNameStoryState({
  branchName,
  environmentId,
  initialName,
}: WorktreeNameStoryStateArgs): WorktreeNameStoryState {
  const [name, setName] = useState<string | null>(initialName);
  const [renameTarget, setRenameTarget] =
    useState<EnvironmentRenameDialogTarget | null>(null);
  const renameTriggerRef = useRef<HTMLElement | null>(null);
  const closeRename = () => {
    const renameTrigger = renameTriggerRef.current;
    renameTriggerRef.current = null;
    setRenameTarget(null);
    requestAnimationFrame(() => {
      if (renameTrigger?.isConnected) renameTrigger.focus();
    });
  };
  const onRenameWorktree = () => {
    renameTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setRenameTarget({
      ...(branchName ? { branchName } : {}),
      id: environmentId,
      currentName: name ?? "",
      canClearName: name !== null,
    });
  };

  return {
    name,
    onRenameWorktree,
    renameDialog: (
      <EnvironmentRenameDialog
        target={renameTarget}
        pending={false}
        onOpenChange={(open) => {
          if (!open) closeRename();
        }}
        onRename={(_environmentId, nextName) => {
          setName(nextName);
          closeRename();
        }}
      />
    ),
  };
}
