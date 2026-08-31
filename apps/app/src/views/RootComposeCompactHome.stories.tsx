import { StoryCard, StoryRow } from "../../.ladle/story-card";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { RootComposeCompactHome } from "./RootComposeCompactHome";
import { MOBILE_RECENT_ROW_HEIGHT_PX } from "./RootComposeMobileRecents";

export default {
  title: "views/Compact Home",
};

const RECENT_TITLES = [
  "Rework folder model",
  "Audit folder query paths",
  "Migrate folder fixtures",
  "Reduce style recalculation",
  "Bisect plugin stylesheets",
  "Wire up automations CLI",
  "Debug host daemon reconnect",
  "Ship theme preview panel",
  "Trim sidebar re-renders",
  "Draft release notes",
  "Fix mobile keyboard inset",
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

function StoryRecents({ count }: { count: number }) {
  return (
    <div>
      <div className="sticky top-0 z-10 mb-1 bg-background px-2">
        <span className="text-xs text-muted-foreground">Recent</span>
        <OverflowFade placement="below" tone="background" size="sm" />
      </div>
      {RECENT_TITLES.slice(0, count).map((title, index) => (
        <div
          key={title}
          className="flex items-center gap-2 px-2"
          style={{ height: MOBILE_RECENT_ROW_HEIGHT_PX }}
        >
          <span className="mt-1 flex size-7 shrink-0 items-center justify-center self-start rounded-md border border-border-seam bg-surface-raised" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm">{title}</span>
            <span className="truncate text-xs text-muted-foreground">
              bb · {index + 1}h ago
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[852px] w-[393px] overflow-hidden rounded-xl border border-border bg-background">
      {children}
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="composer pinned, recents scroll behind it"
        hint="393×852. The composer is an overlay at the bottom; the list runs underneath it and dissolves into a strong fade rather than stopping at a hard edge."
      >
        <PhoneFrame>
          <RootComposeCompactHome composer={<StoryComposer />}>
            <StoryRecents count={RECENT_TITLES.length} />
          </RootComposeCompactHome>
        </PhoneFrame>
      </StoryRow>
      <StoryRow
        label="short list"
        hint="with only a few threads the list still rests above the composer instead of stretching"
      >
        <PhoneFrame>
          <RootComposeCompactHome composer={<StoryComposer />}>
            <StoryRecents count={3} />
          </RootComposeCompactHome>
        </PhoneFrame>
      </StoryRow>
    </StoryCard>
  );
}
