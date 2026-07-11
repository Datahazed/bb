import type {
  DiscoveredSkill,
  HostDaemonOnlineRpcRequestMessage,
} from "@bb/host-daemon-contract";
import { skillListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

interface SkillRpcStub {
  requests: HostDaemonOnlineRpcRequestMessage[];
}

/**
 * Mocks the host online-RPC boundary for the skills commands. `host.list_skills`
 * returns the per-provider raw skill set; `host.delete_skill` echoes a deleted
 * path. Any other command fails loudly.
 */
function registerSkillRpc(
  harness: Parameters<typeof registerHostRpcResponder>[0],
  args: {
    hostId: string;
    sessionId: string;
    skillsByProvider?: Record<string, DiscoveredSkill[]>;
    deletedPath?: string;
    installedFilePath?: string;
  },
): SkillRpcStub {
  const stub: SkillRpcStub = { requests: [] };
  const responder = registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: (request) => {
      if (request.command.type === "host.list_skills") {
        return {
          ok: true,
          result: {
            skills: args.skillsByProvider?.[request.command.providerId] ?? [],
          },
        };
      }
      if (request.command.type === "host.delete_skill") {
        return {
          ok: true,
          result: { deletedPath: args.deletedPath ?? "/deleted" },
        };
      }
      if (request.command.type === "host.install_registry_skill") {
        return {
          ok: true,
          result: {
            filePath:
              args.installedFilePath ??
              "/data/skills/imported-skill/SKILL.md",
          },
        };
      }
      throw new Error(`Unexpected RPC command ${request.command.type}`);
    },
  });
  stub.requests = responder.requests;
  return stub;
}

function discovered(
  name: string,
  rootKind: DiscoveredSkill["rootKind"],
  filePath: string,
): DiscoveredSkill {
  return { name, description: `${name} skill`, rootKind, filePath };
}

describe("public project skills route", () => {
  it("imports a registry package as one host-local bb user skill", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-registry-install",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/registry-install-project",
      });
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        installedFilePath: "/data/skills/find-skills/SKILL.md",
      });

      const response = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "github.com/vercel-labs/skills",
            skillId: "find-skills",
            projectId: project.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        ok: true,
        filePath: "/data/skills/find-skills/SKILL.md",
      });
      expect(stub.requests.map((request) => request.command)).toContainEqual({
        type: "host.install_registry_skill",
        packageRef: "vercel-labs/skills",
        skillId: "find-skills",
      });
    });
  });

  it("rejects obsolete provider install fields", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-registry-invalid",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/registry-invalid-project",
      });

      const response = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "vercel-labs/skills",
            skillId: "find-skills",
            projectId: project.id,
            providers: ["codex"],
          }),
        },
      );

      expect(response.status).toBe(400);
    });
  });

  it("rejects a registry source that could be parsed as a CLI option", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-registry-option-source",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/registry-option-source-project",
      });

      const response = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "--help",
            skillId: "find-skills",
            projectId: project.id,
          }),
        },
      );

      expect(response.status).toBe(400);
    });
  });

  it("maps scope, de-dupes shared bb skills, and sorts the listing", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-skills",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/skills-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/skills-env",
      });
      // The same bb skill (identical filePath) is discovered under both
      // providers; it must be listed once with provider:null.
      const bbSkill = discovered(
        "bb-helper",
        "bb-data-dir",
        "/data/skills/bb-helper/SKILL.md",
      );
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        skillsByProvider: {
          "claude-code": [
            bbSkill,
            discovered(
              "cp",
              "provider-project",
              "/cwd/.claude/skills/cp/SKILL.md",
            ),
            discovered(
              "cu",
              "provider-user",
              "/home/.claude/skills/cu/SKILL.md",
            ),
          ],
          codex: [
            bbSkill,
            discovered(
              "cx",
              "provider-user",
              "/home/.codex/skills/cx/SKILL.md",
            ),
          ],
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills?environmentId=${environment.id}`,
      );

      expect(response.status).toBe(200);
      const body = skillListResponseSchema.parse(await readJson(response));
      expect(body.skills).toEqual([
        {
          name: "bb-helper",
          description: "bb-helper skill",
          provider: null,
          scope: "bb-user",
          filePath: "/data/skills/bb-helper/SKILL.md",
          manageable: true,
        },
        {
          name: "cp",
          description: "cp skill",
          provider: "claude-code",
          scope: "claude-project",
          filePath: "/cwd/.claude/skills/cp/SKILL.md",
          manageable: false,
        },
        {
          name: "cu",
          description: "cu skill",
          provider: "claude-code",
          scope: "claude-user",
          filePath: "/home/.claude/skills/cu/SKILL.md",
          manageable: false,
        },
        {
          name: "cx",
          description: "cx skill",
          provider: "codex",
          scope: "codex",
          filePath: "/home/.codex/skills/cx/SKILL.md",
          manageable: false,
        },
      ]);
      // Queried once per command-surface provider, with the env workspace cwd.
      const listed = stub.requests
        .map((request) => request.command)
        .filter((command) => command.type === "host.list_skills");
      expect(listed.map((command) => command.providerId).sort()).toEqual([
        "claude-code",
        "codex",
      ]);
      for (const command of listed) {
        expect(command).toMatchObject({ cwd: "/tmp/skills-env" });
      }
    });
  });

  it("deletes a bb skill via the confined daemon primitive", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-skill-delete",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/skill-delete-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/skill-delete-env",
      });
      const stub = registerSkillRpc(harness, {
        hostId: host.id,
        sessionId: session.id,
        deletedPath: "/data/skills/bb-helper",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope: "bb-user",
            name: "bb-helper",
            environmentId: environment.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        deletedPath: "/data/skills/bb-helper",
      });
      const deleteCommand = stub.requests
        .map((request) => request.command)
        .find((command) => command.type === "host.delete_skill");
      expect(deleteCommand).toEqual({
        type: "host.delete_skill",
        scope: "bb-user",
        name: "bb-helper",
        cwd: "/tmp/skill-delete-env",
      });
    });
  });

  it("rejects a bb-project delete when no workspace resolves", async () => {
    await withTestHarness(async (harness) => {
      // Primary host A is connected; the project's source lives on host B, so a
      // request without an environment resolves no cwd.
      const { host: hostA } = seedHostSession(harness.deps, {
        id: "host-primary",
      });
      const hostB = seedHost(harness.deps, { id: "host-source" });
      seedPrimaryHost(harness.deps, hostA.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: hostB.id,
        path: "/tmp/other-host-project",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/skills`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope: "bb-project",
            name: "bb-helper",
            environmentId: null,
          }),
        },
      );

      expect(response.status).toBe(409);
    });
  });
});
