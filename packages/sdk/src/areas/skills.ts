import {
  registrySkillDetailSchema,
  registrySkillInstallRequestSchema,
  registrySkillInstallResponseSchema,
  registrySkillSchema,
  registrySkillsPageSchema,
  type DeleteSkillRequest,
  type DeletableSkillScope,
  type EditableSkillScope,
  type RegistrySkill,
  type RegistrySkillDetail,
  type RegistrySkillInstallResponse,
  type RegistrySkillsPage,
  type SkillContentResponse,
  type SkillFilesResponse,
  type SkillListResponse,
  type SkillScope,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface SkillWorkspaceArgs {
  projectId: string;
  environmentId: string | null;
}

export interface SkillIdentityArgs extends SkillWorkspaceArgs {
  scope: SkillScope;
  name: string;
}

export interface SkillContentArgs extends SkillIdentityArgs {
  path: string;
}

export interface SkillUpdateArgs extends SkillWorkspaceArgs {
  scope: EditableSkillScope;
  name: string;
  content: string;
}

export interface SkillDeleteArgs extends SkillWorkspaceArgs {
  scope: DeletableSkillScope;
  name: string;
}

export interface RegistrySkillsSearchArgs {
  query?: string;
  page?: number;
  perPage?: number;
}

export interface RegistrySkillIdArgs {
  registrySkillId: string;
}

export interface RegistrySkillSourceArgs {
  source: string;
  skillId: string;
}

export interface RegistrySkillInstallArgs extends RegistrySkillIdArgs {
  projectId: string;
}

export interface SkillsRegistryArea {
  detail(args: RegistrySkillSourceArgs): Promise<RegistrySkillDetail>;
  get(args: RegistrySkillIdArgs): Promise<RegistrySkill>;
  install(
    args: RegistrySkillInstallArgs,
  ): Promise<RegistrySkillInstallResponse>;
  search(args?: RegistrySkillsSearchArgs): Promise<RegistrySkillsPage>;
}

export interface SkillsArea {
  getContent(args: SkillContentArgs): Promise<SkillContentResponse>;
  list(args: SkillWorkspaceArgs): Promise<SkillListResponse>;
  listFiles(args: SkillIdentityArgs): Promise<SkillFilesResponse>;
  registry: SkillsRegistryArea;
  remove(args: SkillDeleteArgs): Promise<{ deletedPath: string }>;
  update(args: SkillUpdateArgs): Promise<{ filePath: string }>;
}

export function createSkillsArea(args: CreateSdkAreaArgs): SkillsArea {
  const { transport } = args;

  async function requestParsed<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = transport.baseUrl.replace(/\/$/u, "");
    const response = await transport.resolve(
      transport.fetch(`${baseUrl}${path}`, init),
    );
    return schema.parse(await response.json());
  }

  const registry: SkillsRegistryArea = {
    async detail(input) {
      const query = new URLSearchParams({
        source: input.source,
        skillId: input.skillId,
      });
      return requestParsed(
        `/api/v1/skills-registry/detail?${query.toString()}`,
        registrySkillDetailSchema,
      );
    },
    async get(input) {
      const query = new URLSearchParams({ id: input.registrySkillId });
      return requestParsed(
        `/api/v1/skills-registry/entry?${query.toString()}`,
        registrySkillSchema,
      );
    },
    async install(input) {
      const body = registrySkillInstallRequestSchema.parse(input);
      return requestParsed(
        "/api/v1/skills-registry/install",
        registrySkillInstallResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    },
    async search(input = {}) {
      const query = new URLSearchParams({
        page: String(input.page ?? 0),
        perPage: String(input.perPage ?? 24),
      });
      if (input.query?.trim()) query.set("q", input.query.trim());
      return requestParsed(
        `/api/v1/skills-registry?${query.toString()}`,
        registrySkillsPageSchema,
      );
    },
  };

  return {
    async getContent(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].skills.content.$get({
          param: { id: input.projectId },
          query: {
            scope: input.scope,
            name: input.name,
            path: input.path,
            environmentId: input.environmentId ?? "",
          },
        }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].skills.$get({
          param: { id: input.projectId },
          query: { environmentId: input.environmentId ?? "" },
        }),
      );
    },
    async listFiles(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].skills.files.$get({
          param: { id: input.projectId },
          query: {
            scope: input.scope,
            name: input.name,
            environmentId: input.environmentId ?? "",
          },
        }),
      );
    },
    registry,
    async remove(input) {
      const body: DeleteSkillRequest = {
        scope: input.scope,
        name: input.name,
        environmentId: input.environmentId,
      };
      return transport.readJson(
        transport.api.v1.projects[":id"].skills.$delete({
          param: { id: input.projectId },
          json: body,
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].skills.content.$patch({
          param: { id: input.projectId },
          json: {
            scope: input.scope,
            name: input.name,
            environmentId: input.environmentId,
            content: input.content,
          },
        }),
      );
    },
  };
}
