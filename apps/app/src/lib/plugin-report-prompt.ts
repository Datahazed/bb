import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import { untrustedPromptDataBlock } from "./untrusted-prompt-data";

const MAX_IDENTITY_LENGTH = 200;
const MAX_REPOSITORY_URL_LENGTH = 1_024;
const MAX_PROBLEM_MESSAGE_LENGTH = 2_000;

function publicRepositoryUrl(
  value: string,
  options: { stripGitSelector: boolean },
): string | null {
  const parse = (candidate: string): string | null => {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;

      if (options.stripGitSelector) {
        const selectorAt = url.pathname.lastIndexOf("@");
        const finalSlashAt = url.pathname.lastIndexOf("/");
        if (selectorAt > finalSlashAt) {
          url.pathname = url.pathname.slice(0, selectorAt);
        }
      }

      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  };

  const parsed = parse(value);
  if (parsed !== null) return parsed;

  const selectorAt = value.lastIndexOf("@");
  const finalSlashAt = value.lastIndexOf("/");
  return options.stripGitSelector && selectorAt > finalSlashAt
    ? parse(value.slice(0, selectorAt))
    : null;
}

export function installedPluginRepositoryUrl(args: {
  plugin: PluginListItem;
  catalogRepositoryUrl?: string | null;
}): string | null {
  if (args.catalogRepositoryUrl != null) {
    const repositoryUrl = publicRepositoryUrl(args.catalogRepositoryUrl, {
      stripGitSelector: false,
    });
    if (repositoryUrl === null) return null;
    const hostname = new URL(repositoryUrl).hostname;
    if (hostname !== "npmjs.com" && hostname !== "www.npmjs.com") {
      return repositoryUrl;
    }
  }
  if (!args.plugin.source.startsWith("git:")) return null;
  const requested = args.plugin.source.slice("git:".length);
  return publicRepositoryUrl(requested, { stripGitSelector: true });
}

export function buildPluginReportToAuthorPrompt(args: {
  plugin: PluginListItem;
  repositoryUrl: string;
}): string | null {
  const problem = args.plugin.lastProblem;
  if (problem === null) return null;
  const errors = args.plugin.handlerStats.errorCount;
  const repositoryUrl =
    publicRepositoryUrl(args.repositoryUrl, { stripGitSelector: false }) ??
    "Unavailable";
  return [
    "Investigate the bb plugin failure described in the evidence below.",
    "",
    "Do not copy the block verbatim into a public issue. Omit credentials, tokens, secrets, local paths, and unrelated sensitive data from anything you file.",
    ...untrustedPromptDataBlock({
      delimiterLabel: "PLUGIN EVIDENCE",
      sourceDescription: "a plugin or registry",
      fields: [
        {
          label: "Plugin name",
          value: args.plugin.name ?? args.plugin.id,
          maxLength: MAX_IDENTITY_LENGTH,
        },
        {
          label: "Plugin ID",
          value: args.plugin.id,
          maxLength: MAX_IDENTITY_LENGTH,
        },
        {
          label: "Plugin version",
          value: args.plugin.version,
          maxLength: MAX_IDENTITY_LENGTH,
        },
        {
          label: "Repository URL",
          value: repositoryUrl,
          maxLength: MAX_REPOSITORY_URL_LENGTH,
        },
        {
          label: "Runtime class",
          value: problem.class,
          maxLength: MAX_IDENTITY_LENGTH,
        },
        {
          label: "Latest problem",
          value: problem.message,
          maxLength: MAX_PROBLEM_MESSAGE_LENGTH,
        },
        {
          label: "Recorded at",
          value: new Date(problem.at).toISOString(),
          maxLength: MAX_IDENTITY_LENGTH,
        },
        {
          label: "Handler errors recorded",
          value: String(errors),
          maxLength: MAX_IDENTITY_LENGTH,
        },
      ],
    }),
    "",
    "Reproduce the failure and verify the cause before filing anything. If it is a plugin issue, file a concise repository issue with the reproduction, expected and actual behavior, bb/plugin versions, and this evidence. Do not change code or publish a release unless I ask.",
  ].join("\n");
}
