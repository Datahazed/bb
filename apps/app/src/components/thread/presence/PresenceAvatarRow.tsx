import type { PresenceViewer } from "@bb/server-contract";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

const MAX_VISIBLE_AVATARS = 4;

export type PresenceAvatarSize = "sm" | "md";

interface PresenceAvatarRowProps {
  viewers: readonly PresenceViewer[];
  size?: PresenceAvatarSize;
}

interface PresenceAvatarProps {
  viewer: PresenceViewer;
  size: PresenceAvatarSize;
}

function avatarSizeClass(size: PresenceAvatarSize): string {
  return size === "md" ? "size-5 text-[10px]" : "size-4 text-[9px]";
}

export function presenceInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

// A viewer with an avatar renders the image; without one, initials on a
// recessed surface (per the claimed-identity contract, imageUrl null = no
// avatar, render initials).
function PresenceAvatar({ viewer, size }: PresenceAvatarProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="presence-avatar"
          aria-label={`${viewer.displayName} is viewing`}
          className={cn(
            "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-surface-recessed font-medium leading-none text-muted-foreground",
            avatarSizeClass(size),
          )}
        >
          {viewer.imageUrl === null ? (
            presenceInitials(viewer.displayName)
          ) : (
            <img
              src={viewer.imageUrl}
              alt=""
              className="size-full object-cover"
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{viewer.displayName}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Overlapping avatar row of the collaborators currently viewing a thread.
 * Callers pre-filter the roster (e.g. exclude the local viewer); renders
 * nothing when it is empty.
 */
export function PresenceAvatarRow({
  viewers,
  size = "md",
}: PresenceAvatarRowProps) {
  if (viewers.length === 0) {
    return null;
  }
  const visible = viewers.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = viewers.length - visible.length;
  return (
    <span
      data-testid="presence-avatar-row"
      className="inline-flex items-center -space-x-1"
    >
      {visible.map((viewer) => (
        <PresenceAvatar key={viewer.handle} viewer={viewer} size={size} />
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "inline-flex shrink-0 select-none items-center justify-center rounded-full border border-border bg-surface-recessed font-medium leading-none text-muted-foreground",
            avatarSizeClass(size),
          )}
          aria-label={`${overflow} more viewers`}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
