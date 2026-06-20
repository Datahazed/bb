import { Buffer } from "node:buffer";
import type { DiscoveredSkill, SkillRootKind } from "@bb/host-daemon-contract";
import type {
  SkillProvider,
  SkillScope,
  SkillSummary,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../hosts/online-rpc.js";
import type { CommandWorkspace } from "../threads/provider-command-typeahead.js";

/**
 * Providers with a skill surface. A bb skill is discovered under each, so the
 * listing queries all of them and de-dupes provider-agnostic bb skills by path.
 */
export const SKILL_COMMAND_SURFACE_PROVIDERS: readonly SkillProvider[] = [
  "claude-code",
  "codex",
];

/** Deterministic page grouping order; also keeps listing output test-stable. */
const SKILL_SCOPE_ORDER: readonly SkillScope[] = [
  "bb-project",
  "bb-user",
  "bb-builtin",
  "claude-project",
  "claude-user",
  "codex",
  "plugin",
];

interface MappedScope {
  scope: SkillScope;
  /** `null` for provider-agnostic bb scopes. */
  provider: SkillProvider | null;
  manageable: boolean;
}

/**
 * Product policy: map the daemon's raw `(provider, rootKind)` to a user-facing
 * scope. bb scopes are provider-agnostic (`provider: null`); `claude-*` split by
 * project/user; Codex collapses to one read-only scope; only bb-user/bb-project
 * are manageable.
 */
export function mapSkillScope(
  provider: SkillProvider,
  rootKind: SkillRootKind,
): MappedScope {
  switch (rootKind) {
    case "bb-project":
      return { scope: "bb-project", provider: null, manageable: true };
    case "bb-data-dir":
      return { scope: "bb-user", provider: null, manageable: true };
    case "bb-builtin":
      return { scope: "bb-builtin", provider: null, manageable: false };
    case "provider-project":
      return provider === "claude-code"
        ? { scope: "claude-project", provider, manageable: false }
        : { scope: "codex", provider, manageable: false };
    case "provider-user":
      return provider === "claude-code"
        ? { scope: "claude-user", provider, manageable: false }
        : { scope: "codex", provider, manageable: false };
    case "plugin":
      return { scope: "plugin", provider, manageable: false };
  }
}

export interface ProviderSkillDiscovery {
  provider: SkillProvider;
  skills: DiscoveredSkill[];
}

function compareSkillSummaries(
  left: SkillSummary,
  right: SkillSummary,
): number {
  const scopeDelta =
    SKILL_SCOPE_ORDER.indexOf(left.scope) -
    SKILL_SCOPE_ORDER.indexOf(right.scope);
  if (scopeDelta !== 0) {
    return scopeDelta;
  }
  const nameDelta = left.name.localeCompare(right.name);
  if (nameDelta !== 0) {
    return nameDelta;
  }
  return left.filePath.localeCompare(right.filePath);
}

/**
 * Assemble the per-provider daemon results into the listing: map each record to
 * its product scope and de-dupe by absolute `filePath` so a bb skill discovered
 * under both providers is listed once. Output is sorted by scope then name.
 */
export function assembleSkillList(
  perProvider: readonly ProviderSkillDiscovery[],
): SkillSummary[] {
  const byPath = new Map<string, SkillSummary>();
  for (const { provider, skills } of perProvider) {
    for (const skill of skills) {
      if (byPath.has(skill.filePath)) {
        continue;
      }
      const mapped = mapSkillScope(provider, skill.rootKind);
      byPath.set(skill.filePath, {
        name: skill.name,
        description: skill.description,
        provider: mapped.provider,
        scope: mapped.scope,
        filePath: skill.filePath,
        manageable: mapped.manageable,
      });
    }
  }
  return [...byPath.values()].sort(compareSkillSummaries);
}

/** Query every skill-surface provider and assemble the de-duped listing. */
export async function listProjectSkills(
  deps: AppDeps,
  args: { workspace: CommandWorkspace },
): Promise<SkillSummary[]> {
  const perProvider = await Promise.all(
    SKILL_COMMAND_SURFACE_PROVIDERS.map(
      async (provider): Promise<ProviderSkillDiscovery> => {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: args.workspace.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_skills",
            providerId: provider,
            cwd: args.workspace.cwd,
            builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
          },
        });
        return { provider, skills: result.skills };
      },
    ),
  );
  return assembleSkillList(perProvider);
}

/**
 * Read any skill's SKILL.md. The path is the server-resolved `filePath` from the
 * authoritative listing — a client never supplies a path — read via the daemon's
 * `host.read_file` primitive.
 */
export async function readProjectSkill(
  deps: AppDeps,
  args: {
    scope: SkillScope;
    name: string;
    workspace: CommandWorkspace;
  },
): Promise<string> {
  const skills = await listProjectSkills(deps, { workspace: args.workspace });
  // scope + name identify the skill (scope determines the provider).
  const match = skills.find(
    (skill) => skill.scope === args.scope && skill.name === args.name,
  );
  if (!match) {
    throw new ApiError(404, "not_found", "Skill not found");
  }
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.workspace.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.read_file", path: match.filePath },
  });
  return result.contentEncoding === "utf8"
    ? result.content
    : Buffer.from(result.content, "base64").toString("utf8");
}

/**
 * Overwrite a bb skill's SKILL.md via the daemon's confined write primitive. The
 * path is resolved host-side from `(scope, name, cwd)` — never a client path.
 * Non-retryable so a transient failure never re-issues the write.
 */
export async function writeProjectSkill(
  deps: AppDeps,
  args: {
    scope: "bb-user" | "bb-project";
    name: string;
    content: string;
    workspace: CommandWorkspace;
  },
): Promise<string> {
  const result = await callHostOnlineRpc(deps, {
    hostId: args.workspace.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.write_skill",
      scope: args.scope,
      name: args.name,
      cwd: args.workspace.cwd,
      content: args.content,
    },
  });
  return result.filePath;
}

/**
 * Delete a bb skill via the daemon's confined write primitive. The path is
 * resolved host-side from `(scope, name, cwd)` — never a client `filePath`. Uses
 * the non-retryable RPC so a transient failure never re-issues the delete.
 */
export async function deleteProjectSkill(
  deps: AppDeps,
  args: {
    scope: "bb-user" | "bb-project";
    name: string;
    workspace: CommandWorkspace;
  },
): Promise<string> {
  const result = await callHostOnlineRpc(deps, {
    hostId: args.workspace.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.delete_skill",
      scope: args.scope,
      name: args.name,
      cwd: args.workspace.cwd,
    },
  });
  return result.deletedPath;
}
