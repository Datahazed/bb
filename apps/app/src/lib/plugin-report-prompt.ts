import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/** Catalog metadata wins; a direct git install can still name its own repo. */
export function installedPluginRepositoryUrl(args: {
  plugin: PluginListItem;
  catalogRepositoryUrl?: string | null;
}): string | null {
  if (args.catalogRepositoryUrl != null) {
    try {
      const url = new URL(args.catalogRepositoryUrl);
      // Catalog `repositoryUrl` deliberately also represents a public npm
      // package page. That is useful for browsing code before install, but it
      // is not an issue tracker and cannot satisfy Report to author.
      if (url.hostname !== "npmjs.com" && url.hostname !== "www.npmjs.com") {
        return url.toString();
      }
    } catch {
      return null;
    }
  }
  if (!args.plugin.source.startsWith("git:")) return null;
  const requested = args.plugin.source.slice("git:".length);
  const selectorAt = requested.lastIndexOf("@");
  const urlish = selectorAt <= 0 ? requested : requested.slice(0, selectorAt);
  try {
    const url = new URL(urlish);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Visible composer seed for a user-reviewed repository issue workflow. */
export function buildPluginReportToAuthorPrompt(args: {
  plugin: PluginListItem;
  repositoryUrl: string;
}): string | null {
  const problem = args.plugin.lastProblem;
  if (problem === null) return null;
  const errors = args.plugin.handlerStats.errorCount;
  return [
    `Investigate a failure in the bb plugin "${args.plugin.name ?? args.plugin.id}" (${args.plugin.id}@${args.plugin.version}).`,
    `Repository: ${args.repositoryUrl}`,
    "",
    "Health evidence from bb:",
    `- Runtime class: ${problem.class}`,
    `- Latest problem: ${problem.message}`,
    `- Recorded at: ${new Date(problem.at).toISOString()}`,
    `- Handler errors recorded: ${errors}`,
    "",
    "Reproduce the failure and verify the cause before filing anything. If it is a plugin issue, file a concise repository issue with the reproduction, expected and actual behavior, bb/plugin versions, and this evidence. Do not change code or publish a release unless I ask.",
  ].join("\n");
}
