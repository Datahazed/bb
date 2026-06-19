import { useMemo } from "react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SidebarViewOptionsMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarGroupByAtom,
  sidebarOrganizationModeAtom,
  type SidebarOrganizationMode,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/View options menu",
};

function MenuStory({
  folderGroupingAvailable = true,
  groupBy,
  organizationMode,
  sort,
}: {
  folderGroupingAvailable?: boolean;
  groupBy: "none" | "folder";
  organizationMode: SidebarOrganizationMode;
  sort: "updated" | "created" | "none";
}) {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarChronologicalSortAtom, sort);
    next.set(sidebarGroupByAtom, groupBy);
    next.set(sidebarOrganizationModeAtom, organizationMode);
    return next;
  }, [groupBy, organizationMode, sort]);

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
      <StoryRow label="project" hint="organize by project">
        <MenuStory sort="updated" groupBy="none" organizationMode="project" />
      </StoryRow>
      <StoryRow label="folders" hint="cross-project folder organization">
        <MenuStory
          sort="none"
          groupBy="folder"
          organizationMode="chronological"
        />
      </StoryRow>
      <StoryRow label="no folders" hint="Folder option disabled">
        <MenuStory
          folderGroupingAvailable={false}
          sort="updated"
          groupBy="none"
          organizationMode="project"
        />
      </StoryRow>
    </StoryCard>
  );
}
