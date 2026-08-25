import {
  listInReviewPluginListingLifecycles,
  publishPluginListing,
  returnPluginListingToDraft,
  type DbConnection,
} from "@bb/db";
import { z } from "zod";

const githubPullResponseSchema = z
  .object({ state: z.enum(["open", "closed"]), merged: z.boolean() })
  .passthrough();

export interface GithubPullRequestIdentity {
  owner: string;
  repository: string;
  number: number;
}

/** Accept only canonical, credential-free github.com pull request URLs. */
export function parseGithubPullRequestUrl(
  raw: string,
): GithubPullRequestIdentity | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/u.exec(url.pathname);
  if (match === null) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return {
    owner: match[1] ?? "",
    repository: match[2] ?? "",
    number,
  };
}

export async function reconcilePluginListingLifecycles(args: {
  db: DbConnection;
  acceptedEntryIds: ReadonlySet<string>;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  warn?: (message: string) => void;
}): Promise<boolean> {
  let changed = false;
  for (const record of listInReviewPluginListingLifecycles(args.db)) {
    if (record.lifecycle.status !== "in-review") continue;
    if (args.acceptedEntryIds.has(record.lifecycle.entry.id)) {
      publishPluginListing(args.db, record.pluginId, args.now());
      changed = true;
      continue;
    }
    const pull = parseGithubPullRequestUrl(record.lifecycle.pullRequest.url);
    if (
      pull === null ||
      pull.owner !== "get-bb" ||
      pull.repository !== "marketplace"
    ) {
      args.warn?.(`stored listing PR URL is invalid for ${record.pluginId}`);
      continue;
    }
    try {
      const response = await args.fetch(
        `https://api.github.com/repos/${encodeURIComponent(pull.owner)}/${encodeURIComponent(pull.repository)}/pulls/${pull.number}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "bb-plugin-listing-lifecycle",
          },
        },
      );
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const state = githubPullResponseSchema.parse(await response.json());
      if (state.state === "closed" && !state.merged) {
        returnPluginListingToDraft(args.db, record.pluginId, args.now());
        changed = true;
      }
      // A merged PR deliberately stays in review until the catalog carries it.
    } catch (error) {
      args.warn?.(
        `listing PR check failed for ${record.pluginId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return changed;
}
