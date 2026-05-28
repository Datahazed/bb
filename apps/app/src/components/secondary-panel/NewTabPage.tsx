import { NewTabFileSearch, type NewTabFileSearchProps } from "./NewTabFileSearch";

export type NewTabPageProps = NewTabFileSearchProps;

/**
 * Browser-style "New Tab" landing page for the secondary panel. It hosts the
 * unified app and file launcher so future entry points can sit beside it
 * without reshaping the tab.
 */
export function NewTabPage(props: NewTabPageProps) {
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pt-1">
      <NewTabFileSearch {...props} />
    </div>
  );
}
