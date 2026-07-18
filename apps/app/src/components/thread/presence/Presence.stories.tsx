import type { PresenceViewer } from "@bb/server-contract";
import { PresenceAvatarRow } from "./PresenceAvatarRow";
import { SidebarPresenceDots } from "./SidebarPresenceDots";
import { TypingIndicator } from "./TypingIndicator";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/Presence",
};

function viewer(args: {
  handle: string;
  displayName: string;
  imageUrl?: string;
  typing?: boolean;
}): PresenceViewer {
  return {
    handle: args.handle,
    displayName: args.displayName,
    imageUrl: args.imageUrl ?? null,
    typing: args.typing ?? false,
  };
}

const ALICE = viewer({ handle: "alice", displayName: "Alice Chen" });
const BOB = viewer({ handle: "bob", displayName: "Bob" });
const CAROL = viewer({ handle: "carol", displayName: "Carol Q. Vance" });
const DANA = viewer({
  handle: "dana",
  displayName: "Dana",
  imageUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23888'/%3E%3C/svg%3E",
});
const ERIN = viewer({ handle: "erin", displayName: "Erin" });

export function AvatarRow() {
  return (
    <StoryCard>
      <StoryRow label="one viewer">
        <PresenceAvatarRow viewers={[ALICE]} />
      </StoryRow>
      <StoryRow label="initials + image avatar">
        <PresenceAvatarRow viewers={[ALICE, DANA]} />
      </StoryRow>
      <StoryRow label="overflow (+N past four)">
        <PresenceAvatarRow viewers={[ALICE, BOB, CAROL, DANA, ERIN]} />
      </StoryRow>
      <StoryRow label="small size (sidebar-adjacent surfaces)">
        <PresenceAvatarRow viewers={[ALICE, BOB]} size="sm" />
      </StoryRow>
      <StoryRow label="empty roster renders nothing">
        <PresenceAvatarRow viewers={[]} />
      </StoryRow>
    </StoryCard>
  );
}

export function SidebarDots() {
  return (
    <StoryCard>
      <StoryRow label="one viewer">
        <SidebarPresenceDots handles={["alice"]} />
      </StoryRow>
      <StoryRow label="overflow (+N past three)">
        <SidebarPresenceDots handles={["alice", "bob", "carol", "dana"]} />
      </StoryRow>
    </StoryCard>
  );
}

export function Typing() {
  return (
    <StoryCard>
      <StoryRow label="one typist">
        <TypingIndicator handles={["alice"]} />
      </StoryRow>
      <StoryRow label="two typists">
        <TypingIndicator handles={["alice", "bob"]} />
      </StoryRow>
      <StoryRow label="three or more">
        <TypingIndicator handles={["alice", "bob", "carol"]} />
      </StoryRow>
      <StoryRow label="no typists renders nothing">
        <TypingIndicator handles={[]} />
      </StoryRow>
    </StoryCard>
  );
}
