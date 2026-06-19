import { useMemo } from "react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SidebarViewOptionsMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  type SidebarOrganizationMode,
} from "./sidebarCollapsedAtoms";

export default {
  title: "sidebar/View options menu",
};

function MenuStory({
  organizationMode,
  sort,
}: {
  organizationMode: SidebarOrganizationMode;
  sort: "updated" | "created";
}) {
  const store = useMemo(() => {
    const next = createStore();
    next.set(sidebarChronologicalSortAtom, sort);
    next.set(sidebarOrganizationModeAtom, organizationMode);
    return next;
  }, [organizationMode, sort]);

  return (
    <JotaiProvider store={store}>
      <div className="relative flex h-72 w-80 items-start justify-end rounded-md bg-sidebar p-4 text-sidebar-foreground">
        <SidebarViewOptionsMenu open />
      </div>
    </JotaiProvider>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="project" hint="organize by project">
        <MenuStory sort="updated" organizationMode="project" />
      </StoryRow>
      <StoryRow label="folders" hint="cross-project folder view">
        <MenuStory sort="created" organizationMode="chronological" />
      </StoryRow>
    </StoryCard>
  );
}
