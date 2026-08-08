// @vitest-environment jsdom

import { QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { createAppQueryClient } from "@/lib/query-client";
import { HttpError } from "@/lib/api";
import {
  fetchSidebarNavigation,
  sidebarNavigationQueryKey,
} from "./sidebar-navigation-query";

const DATABASE_READ_QUEUE_CAPACITY = 32;

function makeSidebarBootstrapResponse(): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [],
    personalProject: {
      id: "proj_personal",
      kind: "personal",
      name: "Personal",
      gitRemoteUrl: null,
      createdAt: 1,
      updatedAt: 1,
      sources: [],
      threads: [],
      defaultExecutionOptions: null,
    },
  };
}

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sidebar navigation retry", () => {
  it("recovers after a full database read queue without a reload", async () => {
    const sidebar = makeSidebarBootstrapResponse();
    let pendingDatabaseReads = DATABASE_READ_QUEUE_CAPACITY;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (pendingDatabaseReads === DATABASE_READ_QUEUE_CAPACITY) {
        pendingDatabaseReads--;
        return jsonResponse(
          {
            code: "database_read_unavailable",
            message: "The database read queue is full. Try again later.",
            retryable: true,
          },
          { status: 503 },
        );
      }
      return jsonResponse(sidebar, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
      showMutationErrorToasts: false,
    });
    const queryKey = sidebarNavigationQueryKey();
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: ({ signal }) => fetchSidebarNavigation(signal),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual(sidebar);
    expect(observer.getCurrentResult().isStale).toBe(false);
    expect(queryClient.getQueryData(queryKey)).toEqual(sidebar);

    unsubscribe();
    queryClient.clear();
  });

  it.each([
    {
      name: "a non-retryable server error",
      response: () =>
        jsonResponse(
          {
            code: "database_read_unavailable",
            message: "Database read failed.",
            retryable: false,
          },
          { status: 503 },
        ),
      status: 503,
    },
    {
      name: "a client-closed response",
      response: () => new Response(null, { status: 499 }),
      status: 499,
    },
  ])("does not retry $name", async ({ response, status }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => response());
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
      showMutationErrorToasts: false,
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: ["sidebarNavigation", status],
      queryFn: ({ signal }) => fetchSidebarNavigation(signal),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isError).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().error).toBeInstanceOf(HttpError);
    expect(observer.getCurrentResult().error).toMatchObject({
      retryable: false,
      status,
    });

    unsubscribe();
    queryClient.clear();
  });
});
