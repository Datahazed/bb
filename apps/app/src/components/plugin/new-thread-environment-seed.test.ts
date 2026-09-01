import { describe, expect, it } from "vitest";
import type {
  CreateThreadEnvironmentArgs,
  SystemEnvironmentTarget,
} from "@bb/server-contract";
import {
  readEnvironmentTargetConfigurationHostId,
  resolveRootComposeThreadEnvironment,
} from "@/views/root-compose-thread-environment";
import { newThreadEnvironmentArgsToSeed } from "./new-thread-environment-seed";

const PROJECT_ID = "proj_1";

const ENVIRONMENT_TARGETS: SystemEnvironmentTarget[] = [
  {
    pluginId: "worktree",
    targetId: "worktree",
    title: "New worktree",
    icon: "GitBranch",
    hostScoped: true,
    defaultConfiguration: null,
  },
  {
    pluginId: "docker-sandbox",
    targetId: "container",
    title: "Docker container",
    icon: "Container",
    hostScoped: false,
    defaultConfiguration: { image: "ghcr.io/get-bb/sandbox:node-22" },
  },
];

function roundTrip(
  environment: CreateThreadEnvironmentArgs,
): CreateThreadEnvironmentArgs | null {
  const seed = newThreadEnvironmentArgsToSeed(environment);
  expect(seed).not.toBeNull();
  if (seed === null) return null;
  return resolveRootComposeThreadEnvironment({
    defaultBranch: undefined,
    defaultWorktreeBaseBranch: undefined,
    environmentValue: seed.selectionValue,
    projectId: PROJECT_ID,
    selectedBranch: seed.branch,
    environmentTargets: ENVIRONMENT_TARGETS,
    targetHostId:
      seed.targetConfiguration === undefined
        ? null
        : readEnvironmentTargetConfigurationHostId(seed.targetConfiguration),
    ...(seed.targetConfiguration === undefined
      ? {}
      : { targetConfiguration: seed.targetConfiguration }),
  });
}

describe("newThreadEnvironmentArgsToSeed round trip", () => {
  it("reuse", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "reuse",
      environmentId: "env_1",
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("managed worktree with a named base branch", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "release" },
      },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("managed worktree with the default base branch", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("unmanaged with an existing branch", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "unmanaged",
        path: null,
        branch: { kind: "existing", name: "feature" },
      },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("unmanaged with a new branch", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "unmanaged",
        path: null,
        branch: { kind: "new", baseBranch: "main" },
      },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("unmanaged without a branch pick", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: null },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("worktree target with a named base branch", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "plugin-target",
      pluginId: "worktree",
      targetId: "worktree",
      configuration: {
        hostId: "host_1",
        baseBranch: { kind: "named", name: "release" },
      },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("worktree target with the default base branch", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "plugin-target",
      pluginId: "worktree",
      targetId: "worktree",
      configuration: { hostId: "host_1", baseBranch: { kind: "default" } },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("plugin target keeps its configuration verbatim", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "plugin-target",
      pluginId: "docker-sandbox",
      targetId: "container",
      configuration: { image: "custom:latest" },
    };
    expect(roundTrip(environment)).toEqual(environment);
  });

  it("plugin target for an unregistered target resolves to no environment", () => {
    const seed = newThreadEnvironmentArgsToSeed({
      type: "plugin-target",
      pluginId: "gone",
      targetId: "gone",
      configuration: null,
    });
    expect(seed).not.toBeNull();
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: undefined,
        defaultWorktreeBaseBranch: undefined,
        environmentValue: seed?.selectionValue ?? "",
        projectId: PROJECT_ID,
        selectedBranch: null,
        environmentTargets: ENVIRONMENT_TARGETS,
        targetHostId: null,
        targetConfiguration: null,
      }),
    ).toBeNull();
  });

  it("personal workspace keeps its host", () => {
    const environment: CreateThreadEnvironmentArgs = {
      type: "host",
      hostId: "host_1",
      workspace: { type: "personal" },
    };
    const seed = newThreadEnvironmentArgsToSeed(environment);
    expect(seed).toEqual({ selectionValue: "host:host_1:local", branch: null });
  });

  it("documented limits: unrepresentable variants seed nothing", () => {
    expect(
      newThreadEnvironmentArgsToSeed({ type: "project-default" }),
    ).toBeNull();
    expect(
      newThreadEnvironmentArgsToSeed({
        type: "host",
        workspace: { type: "personal" },
      }),
    ).toBeNull();
  });

  it("documented limit: an unmanaged path is not representable", () => {
    const seed = newThreadEnvironmentArgsToSeed({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/somewhere/else" },
    });
    expect(seed).toEqual({ selectionValue: "host:host_1:local", branch: null });
  });
});
