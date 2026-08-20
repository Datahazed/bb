import { Linking } from "react-native";
import { useProfiles } from "@/app-shell";
import type { ServerProfile } from "@/lib/profiles";
import { ListRow, Switch, toast } from "@/ui";
import { usePushRegistration } from "./use-push-registration";

/**
 * Settings → Notifications: one "Push notifications" switch per saved
 * server (the phone registers its Expo token with each server separately),
 * with the registration status underneath. Without an EAS project id the
 * rows are disabled and explain why.
 */
export function PushSettingsRows() {
  const { profiles } = useProfiles();
  if (profiles.length === 0) {
    return (
      <ListRow
        title="Push notifications"
        subtitle="Add a server first"
        leading="Zap"
        disabled
        testID="settings-push-empty"
      />
    );
  }
  return (
    <>
      {profiles.map((profile) => (
        <PushProfileRow key={profile.id} profile={profile} />
      ))}
    </>
  );
}

function PushProfileRow({ profile }: { profile: ServerProfile }) {
  const push = usePushRegistration(profile);
  const blocked = push.enabled === false && push.permission === "denied";
  return (
    <ListRow
      title={profile.label}
      subtitle={push.statusText}
      leading="Zap"
      disabled={!push.available}
      onPress={
        blocked
          ? () => {
              void Linking.openSettings();
            }
          : undefined
      }
      trailing={
        <Switch
          checked={push.enabled}
          disabled={!push.available || push.syncing}
          onCheckedChange={(next) => {
            void push.setEnabled(next).then((outcome) => {
              if (outcome.action === "failed") {
                toast.error(
                  next
                    ? "Could not turn on notifications"
                    : "Could not turn off notifications",
                  { description: outcome.error },
                );
              } else if (next && push.permission === "denied") {
                toast.warning("Notifications are blocked", {
                  description: "Allow them for bb in the system settings.",
                });
              }
            });
          }}
          accessibilityLabel={`Push notifications for ${profile.label}`}
          testID={`settings-push-${profile.id}`}
        />
      }
      testID={`settings-push-row-${profile.id}`}
    />
  );
}
