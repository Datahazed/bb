import { useMemo } from "react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  SidebarOrganizeOptionsMenu,
  SidebarSortOptionsMenu,
} from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  sidebarSortDirectionAtom,
  type SidebarSortDirection,
  type SidebarOrganizationMode,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/View options menu",
};

function MenuStory({
  direction,
  organizationMode,
  sort,
}: {
  direction: SidebarSortDirection;
  organizationMode: SidebarOrganizationMode;
  sort: "updated" | "created" | "alpha";
}) {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarChronologicalSortAtom, sort);
    next.set(sidebarSortDirectionAtom, direction);
    next.set(sidebarOrganizationModeAtom, organizationMode);
    return next;
  }, [direction, organizationMode, sort]);

  return (
    <JotaiProvider store={store}>
      <div className="relative flex h-72 w-80 items-start justify-end gap-1 rounded-md bg-sidebar p-4 text-sidebar-foreground">
        <SidebarOrganizeOptionsMenu open />
        <SidebarSortOptionsMenu />
      </div>
    </JotaiProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="project" hint="organize by project">
        <MenuStory direction="desc" sort="updated" organizationMode="project" />
      </StoryRow>
      <StoryRow label="folders" hint="cross-project folder view">
        <MenuStory
          direction="asc"
          sort="alpha"
          organizationMode="chronological"
        />
      </StoryRow>
    </StoryCard>
  );
}
