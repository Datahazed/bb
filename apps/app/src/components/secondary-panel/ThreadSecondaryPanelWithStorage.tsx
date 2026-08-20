import { useMemo, type ReactNode } from "react";
import type { WorkspaceFile } from "@bb/server-contract";
import {
  ThreadSecondaryPanel,
  type ThreadSecondaryPanelProps,
} from "./ThreadSecondaryPanel";
import { ThreadStorageMetadataRow } from "./ThreadStorageMetadataRow";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";

export interface ThreadStorageBrowserSource {
  files: readonly WorkspaceFile[] | undefined;
  filesError?: Error | null;
  isFilesLoading: boolean;
  onSelectPath: (path: string) => void;
  selectedPath: string | null;
}

export interface ThreadSecondaryPanelWithStorageProps extends Omit<
  ThreadSecondaryPanelProps,
  "metadataContent"
> {
  renderMetadataContent: (storage: ReactNode) => ReactNode;
  storageBrowser: ThreadStorageBrowserSource;
}

/**
 * Persistent owner for the thread-storage tree model.
 *
 * This component is itself a dynamic-import target. Once the right panel has
 * opened, it stays mounted above the panel's tab switch so Pierre's model and
 * search state survive file-tab covers. Unmounting the owning thread/panel
 * runs useFileTree's cleanup.
 */
export function ThreadSecondaryPanelWithStorage({
  renderMetadataContent,
  storageBrowser,
  ...panelProps
}: ThreadSecondaryPanelWithStorageProps) {
  const controller = useThreadStorageBrowser({
    files: storageBrowser.files,
    onSelectPath: storageBrowser.onSelectPath,
    selectedPath: storageBrowser.selectedPath,
  });
  const storage = useMemo(
    () => (
      <ThreadStorageMetadataRow
        controller={controller}
        filesError={storageBrowser.filesError}
        isFilesLoading={storageBrowser.isFilesLoading}
      />
    ),
    [controller, storageBrowser.filesError, storageBrowser.isFilesLoading],
  );

  return (
    <ThreadSecondaryPanel
      {...panelProps}
      metadataContent={renderMetadataContent(storage)}
    />
  );
}
