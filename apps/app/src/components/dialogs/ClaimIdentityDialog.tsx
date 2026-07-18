import { useState, type FormEvent } from "react";
import { normalizeHandle } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import {
  isRemoteAppContext,
  setClaimedDisplayName,
  useClaimedIdentity,
} from "@/lib/claimed-identity-store";

// Session-scoped so "Not now" doesn't nag again until the next visit, while a
// fresh session still offers the prompt to an unidentified remote viewer.
const DISMISSED_SESSION_KEY = "bb.claimedIdentity.promptDismissed";

function wasPromptDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function markPromptDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_SESSION_KEY, "true");
  } catch {
    // Best-effort; worst case the prompt reappears on reload.
  }
}

/**
 * First-load identity prompt for remote sessions: asks for a display name so
 * this viewer's actions are attributed (claimed identity — presence and
 * attribution only, never authorization). Desktop/localhost sessions never see
 * it; they run as the local operator.
 */
export function ClaimIdentityDialog() {
  const identity = useClaimedIdentity();
  const [dismissed, setDismissed] = useState(wasPromptDismissedThisSession);
  const [displayName, setDisplayName] = useState("");
  const open = isRemoteAppContext() && identity === null && !dismissed;
  if (!open) {
    return null;
  }
  const handle = normalizeHandle(displayName);

  const dismiss = () => {
    markPromptDismissed();
    setDismissed(true);
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setClaimedDisplayName(displayName) !== null) {
      dismiss();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : dismiss())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who's here?</DialogTitle>
          <DialogDescription>
            You're viewing this bb remotely. Add a display name so your
            messages and presence are attributed to you — everyone with access
            can see it.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Input
              aria-label="Display name"
              value={displayName}
              placeholder="e.g. Alice"
              maxLength={128}
              autoFocus
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            {handle.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                You'll appear as @{handle}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dismiss}>
              Not now
            </Button>
            <Button type="submit" disabled={handle.length === 0}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
