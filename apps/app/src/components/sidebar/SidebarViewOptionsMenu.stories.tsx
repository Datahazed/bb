import { useMemo } from "react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SidebarViewOptionsMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarGroupByAtom,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/View options menu",
};

function MenuStory({
  folderGroupingAvailable = true,
  groupBy,
  sort,
}: {
  folderGroupingAvailable?: boolean;
  groupBy: "none" | "folder";
  sort: "updated" | "created" | "none";
}) {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarChronologicalSortAtom, sort);
    next.set(sidebarGroupByAtom, groupBy);
    return next;
  }, [groupBy, sort]);

  return (
    <JotaiProvider store={store}>
      <div className="relative flex h-72 w-80 items-start justify-end rounded-md bg-sidebar p-4 text-sidebar-foreground">
        <SidebarViewOptionsMenu
          folderGroupingAvailable={folderGroupingAvailable}
          open
        />
      </div>
    </JotaiProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="Updated at + Group by None">
        <MenuStory sort="updated" groupBy="none" />
      </StoryRow>
      <StoryRow label="manual folders" hint="Sort by None + Group by Folder">
        <MenuStory sort="none" groupBy="folder" />
      </StoryRow>
      <StoryRow label="no folders" hint="Folder option disabled">
        <MenuStory
          folderGroupingAvailable={false}
          sort="updated"
          groupBy="none"
        />
      </StoryRow>
    </StoryCard>
  );
}
