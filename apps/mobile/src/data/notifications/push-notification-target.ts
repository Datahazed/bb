import { z } from "zod";
import { matchProfileForWebLink, type LinkProfileLike } from "@/lib/links";

/**
 * What a bb push notification points at. The server's Expo Push payload
 * carries `data: { threadId, projectId? }` (and may add `serverUrl`); the
 * phone resolves which saved profile the thread lives on — one Expo token
 * serves every profile on the device, so the payload alone cannot name it.
 */
export interface PushNotificationTarget {
  threadId: string;
  projectId: string | null;
  /** Optional server hint (`serverUrl` / `url` in the payload). */
  serverUrl: string | null;
}

const pushDataSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1).nullish(),
  serverUrl: z.string().min(1).nullish(),
  url: z.string().min(1).nullish(),
});

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Lenient read of the notification payload; null when it is not a bb thread. */
export function parsePushNotificationData(
  data: unknown,
): PushNotificationTarget | null {
  const parsed = pushDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const hint = parsed.data.serverUrl ?? parsed.data.url ?? null;
  return {
    threadId: parsed.data.threadId,
    projectId: parsed.data.projectId ?? null,
    serverUrl: hint ? originOf(hint) : null,
  };
}

export interface ResolvePushTargetProfileDeps {
  profiles: readonly LinkProfileLike[];
  activeProfileId: string | null;
  /** True when `threadId` exists on the server (e.g. `GET /threads/:id` is 200). */
  hasThread(serverUrl: string, threadId: string): Promise<boolean>;
}

/**
 * Pick the profile a notification belongs to: the server hint when it names
 * a saved profile, the only profile when there is one, otherwise the active
 * profile first and then the others, probing each for the thread.
 */
export async function resolvePushTargetProfile(
  target: PushNotificationTarget,
  deps: ResolvePushTargetProfileDeps,
): Promise<LinkProfileLike | null> {
  const { profiles } = deps;
  if (profiles.length === 0) return null;
  if (target.serverUrl) {
    const match = matchProfileForWebLink(profiles, target.serverUrl, "/");
    if (match) return match.profile;
  }
  if (profiles.length === 1) return profiles[0] ?? null;
  const ordered = [
    ...profiles.filter((profile) => profile.id === deps.activeProfileId),
    ...profiles.filter((profile) => profile.id !== deps.activeProfileId),
  ];
  for (const profile of ordered) {
    try {
      if (await deps.hasThread(profile.serverUrl, target.threadId)) {
        return profile;
      }
    } catch {
      // Unreachable server: try the next one.
    }
  }
  return null;
}
