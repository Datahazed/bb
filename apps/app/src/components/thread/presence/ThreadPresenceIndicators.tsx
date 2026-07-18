import { useMemo } from "react";
import type { PresenceViewer } from "@bb/server-contract";
import { useClaimedIdentity } from "@/lib/claimed-identity-store";
import { useThreadPresenceViewers } from "@/lib/presence-store";
import { PresenceAvatarRow } from "./PresenceAvatarRow";
import { TypingIndicator } from "./TypingIndicator";

/**
 * The other people looking at this thread: the live roster minus the local
 * viewer's own handle. Without a claimed identity the local viewer is the
 * anonymous local operator, which the server never includes in rosters, so
 * nothing needs excluding.
 */
function useOtherThreadViewers(threadId: string): readonly PresenceViewer[] {
  const viewers = useThreadPresenceViewers(threadId);
  const ownHandle = useClaimedIdentity()?.handle ?? null;
  return useMemo(
    () =>
      ownHandle === null
        ? viewers
        : viewers.filter((viewer) => viewer.handle !== ownHandle),
    [viewers, ownHandle],
  );
}

/** Thread-header avatar row of the other current viewers. */
export function ThreadPresenceHeaderAvatars({ threadId }: { threadId: string }) {
  const others = useOtherThreadViewers(threadId);
  return <PresenceAvatarRow viewers={others} />;
}

/** "@alice is typing…" line for other viewers currently typing. */
export function ThreadTypingIndicator({ threadId }: { threadId: string }) {
  const others = useOtherThreadViewers(threadId);
  const typingHandles = useMemo(
    () => others.filter((viewer) => viewer.typing).map((v) => v.handle),
    [others],
  );
  return <TypingIndicator handles={typingHandles} />;
}
