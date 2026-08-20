import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { DetailRow } from "@/components/ui/detail-card.js";
import { ThreadStorageBrowser } from "./ThreadStorageBrowser";
import type { ThreadStorageBrowserController } from "./useThreadStorageBrowser";

export interface ThreadStorageMetadataRowProps {
  controller: ThreadStorageBrowserController;
  filesError?: Error | null;
  isFilesLoading: boolean;
}

export function ThreadStorageMetadataRow({
  controller,
  filesError,
  isFilesLoading,
}: ThreadStorageMetadataRowProps) {
  const { isSearchOpen, openSearch } = controller;
  // Render nothing when there is no content to show. With no files there is
  // nothing to browse, so the row would otherwise sit as an empty "No files yet."
  // box competing for panel height. Stay visible on error so load failures still
  // surface.
  if (controller.loadedFiles.length === 0 && filesError == null) {
    return null;
  }
  return (
    <DetailRow
      orientation="vertical"
      className="mt-3 min-h-32 flex-1"
      valueClassName="min-h-0 flex-1 overflow-hidden"
      labelClassName="flex items-center justify-between gap-2"
      label={
        <>
          <span>Thread storage</span>
          {isSearchOpen ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "shrink-0 text-muted-foreground",
              )}
              aria-label="Search files"
              onClick={openSearch}
            >
              <Icon name="Search" />
            </Button>
          )}
        </>
      }
    >
      <ThreadStorageBrowser
        controller={controller}
        filesError={filesError}
        isFilesLoading={isFilesLoading}
      />
    </DetailRow>
  );
}
