import type {
  CommandListResponse,
  CreateProjectRequest,
  CreateProjectSourceRequest,
  ProjectBranchesResponse,
  ProjectBranchesQuery,
  ProjectCommandsQuery,
  ProjectResponse,
  ProjectWithThreadsResponse,
  ProjectListQuery,
  ProjectPathsQuery,
  PromptHistoryResponse,
  PromptHistoryQuery,
  ReorderProjectRequest,
  UpdateProjectRequest,
  UpdateProjectSourceRequest,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import type { ProjectExecutionDefaults, ProjectSource } from "@bb/domain";
import type { CreateSdkAreaArgs } from "./common.js";

export interface ProjectListArgs extends ProjectListQuery {}

export interface ProjectCreateArgs extends CreateProjectRequest {}

export interface ProjectGetArgs {
  projectId: string;
}

export interface ProjectUpdateArgs extends UpdateProjectRequest {
  projectId: string;
}

export interface ProjectDeleteArgs {
  projectId: string;
}

export interface ProjectReorderArgs extends ReorderProjectRequest {
  projectId: string;
}

export interface ProjectPromptHistoryArgs extends PromptHistoryQuery {
  projectId: string;
}

export interface ProjectPathsArgs extends ProjectPathsQuery {
  projectId: string;
}

export interface ProjectCommandsArgs extends ProjectCommandsQuery {
  projectId: string;
}

export interface ProjectBranchesArgs extends ProjectBranchesQuery {
  projectId: string;
}

export interface ProjectDefaultExecutionOptionsArgs {
  projectId: string;
}

export type ProjectSourceAddArgs = CreateProjectSourceRequest & {
  projectId: string;
};

export interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
  projectId: string;
  sourceId: string;
}

export interface ProjectSourceDeleteArgs {
  projectId: string;
  sourceId: string;
}

export type ProjectBranchesResult = ProjectBranchesResponse;
export type ProjectCommandsResult = CommandListResponse;
export type ProjectCreateResult = ProjectResponse;
export type ProjectDefaultExecutionOptionsResult =
  ProjectExecutionDefaults | null;
export type ProjectDeleteResult = { ok: true };
export type ProjectGetResult = ProjectResponse;
export type ProjectListResult =
  | ProjectResponse[]
  | ProjectWithThreadsResponse[];
export type ProjectPathsResult = WorkspacePathListResponse;
export type ProjectPromptHistoryResult = PromptHistoryResponse;
export type ProjectReorderResult = ProjectResponse[];
export type ProjectSourceAddResult = ProjectSource;
export type ProjectSourceDeleteResult = { ok: true };
export type ProjectSourceUpdateResult = ProjectSource;
export type ProjectUpdateResult = ProjectResponse;

export interface ProjectSourcesArea {
  add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
  delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
  update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}

export interface ProjectsArea {
  branches(args: ProjectBranchesArgs): Promise<ProjectBranchesResult>;
  commands(args: ProjectCommandsArgs): Promise<ProjectCommandsResult>;
  create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
  defaultExecutionOptions(
    args: ProjectDefaultExecutionOptionsArgs,
  ): Promise<ProjectDefaultExecutionOptionsResult>;
  delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
  get(args: ProjectGetArgs): Promise<ProjectGetResult>;
  list(args?: ProjectListArgs): Promise<ProjectListResult>;
  paths(args: ProjectPathsArgs): Promise<ProjectPathsResult>;
  promptHistory(
    args: ProjectPromptHistoryArgs,
  ): Promise<ProjectPromptHistoryResult>;
  reorder(args: ProjectReorderArgs): Promise<ProjectReorderResult>;
  sources: ProjectSourcesArea;
  update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

function projectUpdateJson(args: ProjectUpdateArgs): UpdateProjectRequest {
  return {
    name: args.name,
  };
}

function projectSourceAddJson(
  args: ProjectSourceAddArgs,
): CreateProjectSourceRequest {
  if (args.type === "local_path") {
    return { hostId: args.hostId, path: args.path, type: args.type };
  }
  return {
    hostId: args.hostId,
    type: args.type,
    ...(args.remoteUrl !== undefined ? { remoteUrl: args.remoteUrl } : {}),
    ...(args.targetPath !== undefined ? { targetPath: args.targetPath } : {}),
  };
}

function projectSourceUpdateJson(
  args: ProjectSourceUpdateArgs,
): UpdateProjectSourceRequest {
  return {
    isDefault: args.isDefault,
    path: args.path,
    type: args.type,
  };
}

export function createProjectsArea(args: CreateSdkAreaArgs): ProjectsArea {
  const { transport } = args;
  const sources: ProjectSourcesArea = {
    async add(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].sources.$post({
          param: { id: input.projectId },
          json: projectSourceAddJson(input),
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.projects[":id"].sources[":sourceId"].$delete({
          param: { id: input.projectId, sourceId: input.sourceId },
        }),
      );
      return { ok: true };
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].sources[":sourceId"].$patch({
          param: { id: input.projectId, sourceId: input.sourceId },
          json: projectSourceUpdateJson(input),
        }),
      );
    },
  };

  return {
    async branches(input) {
      const { projectId, ...query } = input;
      return transport.readJson(
        transport.api.v1.projects[":id"].branches.$get({
          param: { id: projectId },
          query,
        }),
      );
    },
    async commands(input) {
      const { projectId, ...query } = input;
      return transport.readJson(
        transport.api.v1.projects[":id"].commands.$get({
          param: { id: projectId },
          query,
        }),
      );
    },
    async create(input) {
      return transport.readJson(
        transport.api.v1.projects.$post({
          json: input,
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.projects[":id"].$delete({
          param: { id: input.projectId },
        }),
      );
      return { ok: true };
    },
    async defaultExecutionOptions(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"]["default-execution-options"].$get({
          param: { id: input.projectId },
          query: {},
        }),
      );
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].$get({
          param: { id: input.projectId },
        }),
      );
    },
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.projects.$get({
          query: input,
        }),
      );
    },
    async paths(input) {
      const { projectId, ...query } = input;
      return transport.readJson(
        transport.api.v1.projects[":id"].paths.$get({
          param: { id: projectId },
          query,
        }),
      );
    },
    async promptHistory(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"]["prompt-history"].$get({
          param: { id: input.projectId },
          query: { limit: input.limit },
        }),
      );
    },
    async reorder(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].order.$patch({
          param: { id: input.projectId },
          json: {
            previousProjectId: input.previousProjectId,
            nextProjectId: input.nextProjectId,
          },
        }),
      );
    },
    sources,
    async update(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].$patch({
          param: { id: input.projectId },
          json: projectUpdateJson(input),
        }),
      );
    },
  };
}
