import { Buffer } from "node:buffer";
import path from "node:path";
import type { DiscoveredSkill, SkillRootKind } from "@bb/host-daemon-contract";
import type {
  EditableSkillScope,
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
import type { ProjectCommandWorkspace as CommandWorkspace } from "../projects/project-workspace.js";

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
  "codex-project",
  "codex-user",
  "plugin",
];

function hostPathDirname(filePath: string): string {
  return /^[a-zA-Z]:[\\/]/u.test(filePath)
    ? path.win32.dirname(filePath)
    : path.posix.dirname(filePath);
}

function hostPathBasename(filePath: string): string {
  return /^[a-zA-Z]:[\\/]/u.test(filePath)
    ? path.win32.basename(filePath)
    : path.posix.basename(filePath);
}

function isBundledProviderSkill(filePath: string): boolean {
  return /(^|[\\/])\.system([\\/]|$)/u.test(filePath);
}

interface MappedScope {
  scope: SkillScope;
  /** `null` for provider-agnostic bb scopes. */
  provider: SkillProvider | null;
  manageable: boolean;
}

/**
 * Product policy: map the daemon's raw `(provider, rootKind)` to a user-facing
 * scope. bb scopes are provider-agnostic (`provider: null`); provider roots
 * retain project/user identity. User-owned provider roots are manageable;
 * bundled provider and plugin roots remain protected.
 */
export function mapSkillScope(
  provider: SkillProvider,
  rootKind: SkillRootKind,
  filePath: string,
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
        ? { scope: "claude-project", provider, manageable: true }
        : { scope: "codex-project", provider, manageable: true };
    case "provider-user":
      if (isBundledProviderSkill(filePath)) {
        return provider === "claude-code"
          ? { scope: "claude-user", provider, manageable: false }
          : { scope: "codex-user", provider, manageable: false };
      }
      return provider === "claude-code"
        ? { scope: "claude-user", provider, manageable: true }
        : { scope: "codex-user", provider, manageable: true };
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
      const mapped = mapSkillScope(provider, skill.rootKind, skill.filePath);
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

async function resolveProjectSkill(
  deps: AppDeps,
  args: {
    scope: SkillScope;
    name: string;
    workspace: CommandWorkspace;
  },
): Promise<SkillSummary> {
  const skills = await listProjectSkills(deps, { workspace: args.workspace });
  const match = skills.find(
    (skill) => skill.scope === args.scope && skill.name === args.name,
  );
  if (!match) {
    throw new ApiError(404, "not_found", "Skill not found");
  }
  return match;
}

export async function listProjectSkillFiles(
  deps: AppDeps,
  args: {
    scope: SkillScope;
    name: string;
    workspace: CommandWorkspace;
  },
): Promise<{ files: string[]; truncated: boolean }> {
  const skill = await resolveProjectSkill(deps, args);
  const rootPath = hostPathDirname(skill.filePath);
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.workspace.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.list_files", path: rootPath, limit: 200 },
  });
  const files = result.files
    .map((file) => file.path)
    .sort((left, right) => {
      if (left === "SKILL.md") return -1;
      if (right === "SKILL.md") return 1;
      return left.localeCompare(right);
    });
  return { files, truncated: result.truncated };
}

/**
 * Read a selected file inside an authoritative skill root. The client supplies
 * only a relative path; the daemon confines it to the server-resolved skill
 * directory and rejects traversal or denied dotfiles.
 */
export async function readProjectSkill(
  deps: AppDeps,
  args: {
    scope: SkillScope;
    name: string;
    path: string;
    workspace: CommandWorkspace;
  },
): Promise<string> {
  const skill = await resolveProjectSkill(deps, args);
  const rootPath = hostPathDirname(skill.filePath);
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.workspace.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.read_file_relative",
      rootPath,
      path: args.path,
      dotfiles: "deny",
    },
  });
  return result.contentEncoding === "utf8"
    ? result.content
    : Buffer.from(result.content, "base64").toString("utf8");
}

/** Overwrite an editable local SKILL.md through a confined host write. */
export async function writeProjectSkill(
  deps: AppDeps,
  args: {
    scope: EditableSkillScope;
    name: string;
    content: string;
    workspace: CommandWorkspace;
  },
): Promise<string> {
  if (args.scope !== "bb-user" && args.scope !== "bb-project") {
    const skill = await resolveProjectSkill(deps, args);
    if (isBundledProviderSkill(skill.filePath) || skill.scope === "plugin") {
      throw new ApiError(
        403,
        "forbidden",
        "Bundled skills cannot be edited in bb",
      );
    }
    const result = await callHostOnlineRpc(deps, {
      hostId: args.workspace.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.write_file",
        path: skill.filePath,
        rootPath: hostPathDirname(skill.filePath),
        content: args.content,
        contentEncoding: "utf8",
        createParents: false,
      },
    });
    if (result.outcome !== "written") {
      throw new ApiError(409, "conflict", "Skill changed before it was saved");
    }
    return skill.filePath;
  }
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
 * Delete a user-owned local skill via the daemon's confined primitive. bb roots
 * are resolved host-side from scope; provider roots come from the authoritative
 * server-side listing and are re-confined by the daemon. Uses the non-retryable
 * RPC so a transient failure never re-issues the delete.
 */
export async function deleteProjectSkill(
  deps: AppDeps,
  args: {
    scope: EditableSkillScope;
    name: string;
    workspace: CommandWorkspace;
  },
): Promise<string> {
  let daemonName = args.name;
  let rootPath: string | null = null;
  if (args.scope !== "bb-user" && args.scope !== "bb-project") {
    const skill = await resolveProjectSkill(deps, args);
    if (isBundledProviderSkill(skill.filePath) || skill.scope === "plugin") {
      throw new ApiError(
        403,
        "forbidden",
        "Bundled skills cannot be deleted in bb",
      );
    }
    const skillDirPath = hostPathDirname(skill.filePath);
    daemonName = hostPathBasename(skillDirPath);
    rootPath = hostPathDirname(skillDirPath);
  }
  const result = await callHostOnlineRpc(deps, {
    hostId: args.workspace.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.delete_skill",
      scope: args.scope,
      name: daemonName,
      cwd: args.workspace.cwd,
      rootPath,
    },
  });
  return result.deletedPath;
}
