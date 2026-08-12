import { useCallback, useMemo } from "react";
import { buildOpenInEditorHandler } from "@/views/thread-detail/threadWorkspaceOpenPath";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { getFilePreviewLineRangeStart } from "@/lib/file-preview";
import type { SecondaryPanelActiveFileTabs } from "./secondaryPanelSession";

type ActiveFileTargets = Pick<
  SecondaryPanelActiveFileTabs,
  | "activeHostFileLineRange"
  | "activeHostFilePath"
  | "activeStorageFilePath"
  | "activeWorkspaceFileEnvironmentId"
  | "activeWorkspaceFilePath"
  | "activeWorkspaceFileProjectId"
>;

interface UseSecondaryPanelFileOpenersArgs {
  active: ActiveFileTargets;
  canOpenPreferredFileTarget: boolean;
  onOpenPreferredFallback?: () => boolean;
  openPathInPreferredFileTarget: Parameters<
    typeof buildOpenInEditorHandler
  >[0]["openInPreferredTarget"];
  projectRootPath?: string | null;
  storageRootPath: string | null;
  workspaceRootPath: string | null;
}

/**
 * "Open in editor" handlers and absolute copy paths for the panel's active
 * file tab. View-bound on purpose: each view resolves the root paths (and, on
 * root compose, the cross-context project preview) differently.
 */
export function useSecondaryPanelFileOpeners({
  active,
  canOpenPreferredFileTarget,
  onOpenPreferredFallback,
  openPathInPreferredFileTarget,
  projectRootPath = null,
  storageRootPath,
  workspaceRootPath,
}: UseSecondaryPanelFileOpenersArgs) {
  const openWorkspaceFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: workspaceRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      workspaceRootPath,
    ],
  );
  const openProjectFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: projectRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      projectRootPath,
    ],
  );
  const openStorageFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: storageRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      storageRootPath,
    ],
  );
  const openHostFileInEditor = useMemo(() => {
    if (!canOpenPreferredFileTarget) return undefined;
    const lineNumber = getFilePreviewLineRangeStart({
      lineRange: active.activeHostFileLineRange,
    });
    return (path: string) => {
      void openPathInPreferredFileTarget({ lineNumber, path });
    };
  }, [
    canOpenPreferredFileTarget,
    active.activeHostFileLineRange,
    openPathInPreferredFileTarget,
  ]);
  const handleOpenPreferred = useCallback(() => {
    if (
      active.activeWorkspaceFilePath !== null &&
      active.activeWorkspaceFileEnvironmentId !== null &&
      openWorkspaceFileInEditor
    ) {
      openWorkspaceFileInEditor(active.activeWorkspaceFilePath);
      return true;
    }
    if (
      active.activeWorkspaceFilePath !== null &&
      active.activeWorkspaceFileProjectId !== null &&
      openProjectFileInEditor
    ) {
      openProjectFileInEditor(active.activeWorkspaceFilePath);
      return true;
    }
    if (active.activeHostFilePath !== null && openHostFileInEditor) {
      openHostFileInEditor(active.activeHostFilePath);
      return true;
    }
    if (active.activeStorageFilePath !== null && openStorageFileInEditor) {
      openStorageFileInEditor(active.activeStorageFilePath);
      return true;
    }
    return onOpenPreferredFallback?.() ?? false;
  }, [
    active.activeHostFilePath,
    active.activeStorageFilePath,
    active.activeWorkspaceFileEnvironmentId,
    active.activeWorkspaceFilePath,
    active.activeWorkspaceFileProjectId,
    onOpenPreferredFallback,
    openHostFileInEditor,
    openProjectFileInEditor,
    openStorageFileInEditor,
    openWorkspaceFileInEditor,
  ]);
  const workspaceFileCopyPath = active.activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: active.activeWorkspaceFilePath,
        rootPath: workspaceRootPath,
      })
    : null;
  const projectFileCopyPath = active.activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: active.activeWorkspaceFilePath,
        rootPath: projectRootPath,
      })
    : null;
  const storageFileCopyPath = active.activeStorageFilePath
    ? resolveAbsoluteFilePath({
        path: active.activeStorageFilePath,
        rootPath: storageRootPath,
      })
    : null;

  return {
    handleOpenPreferred,
    openHostFileInEditor,
    openProjectFileInEditor,
    openStorageFileInEditor,
    openWorkspaceFileInEditor,
    projectFileCopyPath,
    storageFileCopyPath,
    workspaceFileCopyPath,
  };
}
