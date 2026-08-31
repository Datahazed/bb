import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  PROJECT_IDS,
  PROJECT_NAMES,
  STORY_PROVIDERS_BY_ID,
  makeThreadListEntry,
} from "../../.ladle/story-fixtures";
import { RootComposeCompactHome } from "./RootComposeCompactHome";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

export default {
  title: "views/Compact Home",
};

const projectNamesById = new Map<string, string>([
  [PROJECT_IDS.bb, PROJECT_NAMES.bb],
  [PROJECT_IDS.pierre, PROJECT_NAMES.pierre],
]);

const HOME_THREADS: ThreadListEntry[] = [
  makeThreadListEntry({
    id: "thr_home_parent",
    title: "Rework folder model",
    titleFallback: "Rework folder model",
    latestAttentionAt: 900,
  }),
  makeThreadListEntry({
    id: "thr_home_child_a",
    parentThreadId: "thr_home_parent",
    providerId: "claude-code",
    title: "Audit folder query paths",
    titleFallback: "Audit folder query paths",
    latestAttentionAt: 880,
  }),
  makeThreadListEntry({
    id: "thr_home_child_b",
    parentThreadId: "thr_home_parent",
    providerId: "acp-cursor",
    title: "Migrate folder fixtures",
    titleFallback: "Migrate folder fixtures",
    latestAttentionAt: 870,
  }),
  makeThreadListEntry({
    id: "thr_home_style",
    providerId: "claude-code",
    title: "Reduce style recalculation",
    titleFallback: "Reduce style recalculation",
    status: "starting",
    latestAttentionAt: 860,
    runtime: { displayStatus: "starting", hostReconnectGraceExpiresAt: null },
  }),
  makeThreadListEntry({
    id: "thr_home_automations",
    title: "Wire up automations CLI",
    titleFallback: "Wire up automations CLI",
    latestAttentionAt: 850,
  }),
  makeThreadListEntry({
    id: "thr_home_daemon",
    projectId: PROJECT_IDS.pierre,
    providerId: "acp-cursor",
    title: "Debug host daemon reconnect",
    titleFallback: "Debug host daemon reconnect",
    latestAttentionAt: 840,
  }),
  makeThreadListEntry({
    id: "thr_home_theme",
    title: "Ship theme preview panel",
    titleFallback: "Ship theme preview panel",
    latestAttentionAt: 830,
  }),
  makeThreadListEntry({
    id: "thr_home_sidebar",
    providerId: "claude-code",
    title: "Trim sidebar re-renders",
    titleFallback: "Trim sidebar re-renders",
    latestAttentionAt: 820,
  }),
  makeThreadListEntry({
    id: "thr_home_release",
    title: "Draft release notes",
    titleFallback: "Draft release notes",
    latestAttentionAt: 810,
  }),
  makeThreadListEntry({
    id: "thr_home_keyboard",
    projectId: PROJECT_IDS.pierre,
    title: "Fix mobile keyboard inset",
    titleFallback: "Fix mobile keyboard inset",
    latestAttentionAt: 800,
  }),
];

function StoryComposer() {
  return (
    <div className="rounded-xl border border-border bg-background shadow-lift">
      <div className="px-3 pt-3 pb-8 text-sm text-muted-foreground">
        Ask anything.
      </div>
      <div className="flex items-center justify-between px-3 pb-3">
        <span className="size-6 rounded-md border border-border-seam" />
        <span className="size-6 rounded-md bg-foreground/80" />
      </div>
    </div>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="root-compose-compact-home-story flex h-[852px] w-[393px] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
      <style>{`
        @media (min-width: 768px) {
          .root-compose-compact-home-story [data-root-compose-mobile-recents] {
            display: block;
          }
        }
      `}</style>
      {children}
    </div>
  );
}

function HomeRecents({ threads }: { threads: ThreadListEntry[] }) {
  return (
    <RootComposeMobileRecents
      highlightedThreadId={null}
      projectNamesById={projectNamesById}
      providersById={STORY_PROVIDERS_BY_ID}
      showCreatingRow={false}
      threads={threads}
    />
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow
        label="composer pinned, recents scroll behind it"
        hint="393×852 with the real recents list. The composer is an overlay at the bottom; rows run underneath it and dissolve into a strong fade rather than stopping at a hard edge."
      >
        <PhoneFrame>
          <RootComposeCompactHome composer={<StoryComposer />}>
            <HomeRecents threads={HOME_THREADS} />
          </RootComposeCompactHome>
        </PhoneFrame>
      </StoryRow>
      <StoryRow
        label="short list"
        hint="with only a few threads the list still rests above the composer instead of stretching to fill"
      >
        <PhoneFrame>
          <RootComposeCompactHome composer={<StoryComposer />}>
            <HomeRecents threads={HOME_THREADS.slice(0, 3)} />
          </RootComposeCompactHome>
        </PhoneFrame>
      </StoryRow>
    </StoryCard>
  );
}
