import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Environment, JsonValue } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import { ThreadWaitTimeoutError } from "../src/areas/threads.js";
import type { FetchImplementation } from "../src/response.js";

interface CapturedRequest {
  bodyText: string | undefined;
  method: string;
  url: string;
}

interface QueuedJsonResponse {
  body: JsonValue;
  status?: number;
}

interface FetchQueue {
  fetch: FetchImplementation;
  requests: CapturedRequest[];
}

type EnvironmentOverrides = Partial<Environment>;

function makeEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    baseBranch: null,
    branchName: null,
    defaultBranch: null,
    mergeBaseBranch: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function bodyText(init: RequestInit | undefined): string | undefined {
  return typeof init?.body === "string" ? init.body : undefined;
}

function jsonResponse(args: QueuedJsonResponse): Response {
  const status = args.status ?? 200;
  // 204 is a null-body status; the Response constructor throws on a body.
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(args.body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchQueue(
  responses: readonly QueuedJsonResponse[],
): FetchQueue {
  const requests: CapturedRequest[] = [];
  const remaining = [...responses];
  const fetchMock: FetchImplementation = async (input, init) => {
    requests.push({
      bodyText: bodyText(init),
      method: init?.method ?? "GET",
      url: String(input),
    });
    const next = remaining.shift();
    if (!next) {
      throw new Error("No queued SDK test response");
    }
    return jsonResponse(next);
  };
  return { fetch: fetchMock, requests };
}

describe("@bb/sdk", () => {
  it("routes project file APIs and returns portable text/binary DTOs", async () => {
    const requests: CapturedRequest[] = [];
    const responses = [
      jsonResponse({
        body: {
          files: [{ name: "remote.txt", path: "remote.txt" }],
          truncated: false,
        },
      }),
      new Response("remote text", {
        headers: {
          "content-type": "text/plain",
          "x-bb-content-encoding": "utf8",
        },
      }),
      new Response(new Uint8Array([0, 1, 254, 255]), {
        headers: {
          "content-type": "application/octet-stream",
          "x-bb-content-encoding": "base64",
        },
      }),
    ];
    const fetch: FetchImplementation = async (input, init) => {
      requests.push({
        bodyText: bodyText(init),
        method: init?.method ?? "GET",
        url: String(input),
      });
      const response = responses.shift();
      if (!response) throw new Error("No queued project file response");
      return response;
    };
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch,
        runtime: "browser",
      }),
    });

    await expect(
      sdk.projects.files({
        projectId: "proj_remote",
        hostId: "host_remote",
      }),
    ).resolves.toMatchObject({ files: [{ path: "remote.txt" }] });
    await expect(
      sdk.projects.fileContent({
        projectId: "proj_remote",
        environmentId: "env_remote",
        path: "remote.txt",
      }),
    ).resolves.toEqual({
      content: "remote text",
      contentEncoding: "utf8",
      mimeType: "text/plain",
      sizeBytes: 11,
    });
    await expect(
      sdk.projects.fileContent({
        projectId: "proj_remote",
        hostId: "host_remote",
        path: "image.bin",
      }),
    ).resolves.toEqual({
      content: "AAH+/w==",
      contentEncoding: "base64",
      mimeType: "application/octet-stream",
      sizeBytes: 4,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "http://bb.test/api/v1/projects/proj_remote/files?hostId=host_remote",
      "http://bb.test/api/v1/projects/proj_remote/files/content?environmentId=env_remote&path=remote.txt",
      "http://bb.test/api/v1/projects/proj_remote/files/content?hostId=host_remote&path=image.bin",
    ]);
  });

  it("routes provider list and model discovery through portable host selectors", async () => {
    const queue = createFetchQueue([
      { body: [] },
      {
        body: {
          providers: [],
          models: [],
          selectedOnlyModels: [],
          modelLoadError: null,
        },
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.providers.list({ hostId: "host_remote" }),
    ).resolves.toEqual([]);
    await expect(
      sdk.providers.models({
        environmentId: "env_remote",
        providerId: "acp-remote",
      }),
    ).resolves.toMatchObject({ models: [], providers: [] });

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/system/providers?hostId=host_remote",
      },
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/system/execution-options?environmentId=env_remote&providerId=acp-remote",
      },
    ]);
  });

  it("targets provider usage at an explicit machine", async () => {
    const usage = {
      codex: { status: "unauthenticated" as const },
      claudeCode: { status: "unauthenticated" as const },
    };
    const queue = createFetchQueue([{ body: usage }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.system.usageLimits({ hostId: "host_remote" }),
    ).resolves.toEqual(usage);
    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/system/usage-limits?hostId=host_remote",
      },
    ]);
  });

  it("routes thread list calls through the HTTP transport", async () => {
    const queue = createFetchQueue([{ body: [] }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threads.list({ archived: true, projectId: "proj_123" }),
    ).resolves.toEqual([]);

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/threads?projectId=proj_123&archived=true",
      },
    ]);
  });

  it("normalizes HTTP error responses through the transport", async () => {
    const queue = createFetchQueue([
      {
        body: { message: "Thread not found" },
        status: 404,
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(sdk.threads.get({ threadId: "thr_missing" })).rejects.toThrow(
      "HTTP 404: Thread not found",
    );
  });

  it("routes environment pull request calls through the HTTP transport", async () => {
    const response = { pullRequest: null };
    const queue = createFetchQueue([{ body: response }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.environments.pullRequest({ environmentId: "env_pr" }),
    ).resolves.toEqual(response);

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/environments/env_pr/pull-request",
      },
    ]);
  });

  it("updates environment metadata through the HTTP transport", async () => {
    const environment = makeEnvironment({
      id: "env_update",
      name: "Review workspace",
      mergeBaseBranch: "release",
    });
    const queue = createFetchQueue([{ body: environment }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.environments.update({
        environmentId: "env_update",
        mergeBaseBranch: "release",
        name: "Review workspace",
      }),
    ).resolves.toEqual(environment);

    expect(queue.requests).toEqual([
      {
        bodyText: JSON.stringify({
          mergeBaseBranch: "release",
          name: "Review workspace",
        }),
        method: "PATCH",
        url: "http://bb.test/api/v1/environments/env_update",
      },
    ]);
  });

  it("rejects empty environment updates before sending a request", async () => {
    const queue = createFetchQueue([]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      // @ts-expect-error Environment update requires at least one update field.
      sdk.environments.update({ environmentId: "env_update" }),
    ).rejects.toThrow("At least one field must be provided");
    expect(queue.requests).toEqual([]);
  });

  it("fills thread spawn defaults before sending a request", async () => {
    const queue = createFetchQueue([{ body: { id: "thr_1" }, status: 201 }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await sdk.threads.spawn({
      projectId: "proj_123",
      environment: {
        type: "host",
        hostId: "host_123",
        workspace: { type: "unmanaged", path: null },
      },
      prompt: "Ship it",
    });

    expect(queue.requests[0]?.bodyText).toBe(
      JSON.stringify({
        projectId: "proj_123",
        environment: {
          type: "host",
          hostId: "host_123",
          workspace: { type: "unmanaged", path: null },
        },
        input: [{ type: "text", text: "Ship it", mentions: [] }],
        origin: "sdk",
        startedOnBehalfOf: null,
        originKind: null,
        childOrigin: null,
      }),
    );
  });

  it("preserves explicit thread spawn origin for CLI callers", async () => {
    const queue = createFetchQueue([{ body: { id: "thr_1" }, status: 201 }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await sdk.threads.spawn({
      projectId: "proj_123",
      origin: "cli",
      environment: {
        type: "host",
        hostId: "host_123",
        workspace: { type: "unmanaged", path: null },
      },
      input: [{ type: "text", text: "From CLI", mentions: [] }],
    });

    expect(JSON.parse(queue.requests[0]?.bodyText ?? "{}").origin).toBe("cli");
  });

  it("preserves folder assignment in thread updates", async () => {
    const queue = createFetchQueue([
      {
        body: {
          id: "thr_folder",
          projectId: "proj_123",
          status: "idle",
          title: null,
        },
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await sdk.threads.update({
      threadId: "thr_folder",
      folderId: "folder_123",
    });

    expect(queue.requests[0]).toEqual({
      bodyText: JSON.stringify({ folderId: "folder_123" }),
      method: "PATCH",
      url: "http://bb.test/api/v1/threads/thr_folder",
    });
  });

  it("exposes thread folder mutations", async () => {
    const queue = createFetchQueue([
      {
        body: {
          id: "folder_123",
          name: "Review",
          createdAt: 1,
          updatedAt: 1,
        },
        status: 201,
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threadFolders.create({ name: "Review" }),
    ).resolves.toMatchObject({ id: "folder_123", name: "Review" });
    expect(queue.requests[0]).toEqual({
      bodyText: JSON.stringify({ name: "Review" }),
      method: "POST",
      url: "http://bb.test/api/v1/thread-folders",
    });
  });

  it("validates typed plugin RPC results", async () => {
    const queue = createFetchQueue([
      {
        body: {
          ok: true,
          result: { instructions: "Run tests." },
        },
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test/",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.plugins.callRpc({
        pluginId: "custom-instructions",
        method: "getInstructions",
        input: null,
        outputSchema: z.object({ instructions: z.string() }),
      }),
    ).resolves.toEqual({ instructions: "Run tests." });
    expect(queue.requests[0]).toEqual({
      bodyText: "null",
      method: "POST",
      url: "http://bb.test/api/v1/plugins/custom-instructions/rpc/getInstructions",
    });
  });

  it("rejects thread spawn requests with both prompt and input", async () => {
    const queue = createFetchQueue([]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threads.spawn({
        projectId: "proj_123",
        environment: {
          type: "host",
          hostId: "host_123",
          workspace: { type: "unmanaged", path: null },
        },
        prompt: "Ship it",
        // @ts-expect-error Runtime guard rejects callers that bypass the union.
        input: [{ type: "text", text: "Duplicate", mentions: [] }],
      }),
    ).rejects.toThrow("Provide only one of input or prompt.");
    expect(queue.requests).toEqual([]);
  });

  it("waits for a thread status through the shared SDK loop", async () => {
    const queue = createFetchQueue([
      { body: { id: "thr_wait", status: "active" } },
      { body: { id: "thr_wait", status: "idle" } },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threads.wait({
        threadId: "thr_wait",
        status: "idle",
        timeoutMs: 1_000,
        pollIntervalMs: 1,
      }),
    ).resolves.toMatchObject({
      matched: true,
      target: { kind: "status", status: "idle" },
      threadId: "thr_wait",
    });

    expect(queue.requests.map((request) => request.url)).toEqual([
      "http://bb.test/api/v1/threads/thr_wait",
      "http://bb.test/api/v1/threads/thr_wait",
    ]);
  });

  it("throws a typed timeout error from thread wait", async () => {
    const queue = createFetchQueue([
      { body: { id: "thr_wait", status: "active" } },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threads.wait({
        threadId: "thr_wait",
        status: "idle",
        timeoutMs: 0,
        pollIntervalMs: 1,
      }),
    ).rejects.toBeInstanceOf(ThreadWaitTimeoutError);
  });
});
