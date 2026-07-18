import { useEffect, useState, type FormEvent } from "react";
import { normalizeHandle } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { SettingsSection } from "@/components/ui/settings-section";
import {
  clearClaimedIdentity,
  setClaimedDisplayName,
  useClaimedIdentity,
} from "@/lib/claimed-identity-store";

/**
 * Remote-session identity editor: the claimed display name/handle this browser
 * attaches to its requests for attribution and presence. Only offered in the
 * settings nav for remote sessions (desktop/localhost run as the local
 * operator and send no identity).
 */
export function IdentitySettingsSection() {
  const identity = useClaimedIdentity();
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");
  // Re-seed the field when the identity changes elsewhere (first-load dialog,
  // another tab via the storage event).
  useEffect(() => {
    setDisplayName(identity?.displayName ?? "");
  }, [identity?.displayName]);
  const handle = normalizeHandle(displayName);
  const isDirty = displayName.trim() !== (identity?.displayName ?? "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClaimedDisplayName(displayName);
  };

  return (
    <SettingsSection
      title="Identity"
      description="How you appear to other people using this bb: message attribution, presence avatars, and typing indicators. Self-reported — it never grants or restricts access."
    >
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="claimed-identity-display-name"
          >
            Display name
          </label>
          <Input
            id="claimed-identity-display-name"
            value={displayName}
            placeholder="e.g. Alice"
            maxLength={128}
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <p className="text-xs text-subtle-foreground/75">
            {handle.length > 0
              ? `You appear as @${handle}`
              : "No identity claimed — your actions show as the machine owner."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!isDirty || handle.length === 0}>
            Save
          </Button>
          {identity !== null ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                clearClaimedIdentity();
                setDisplayName("");
              }}
            >
              Clear identity
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsSection>
  );
}
