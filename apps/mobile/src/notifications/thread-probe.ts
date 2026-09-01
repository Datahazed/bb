import { createMobileFetch } from "@/lib/sdk";

const probeFetch = createMobileFetch((input, init) => fetch(input, init));

/**
 * `GET <serverUrl>/api/v1/threads/:id` → 200? Used to find which saved
 * server a notification's thread lives on when the payload does not say.
 * Connect profiles authenticate through the shared cookie jar.
 */
export async function hasThreadOnServer(
  serverUrl: string,
  threadId: string,
): Promise<boolean> {
  const url = `${serverUrl.replace(/\/+$/u, "")}/api/v1/threads/${encodeURIComponent(threadId)}`;
  const response = await probeFetch(url, {
    method: "GET",
    headers: new Headers({ accept: "application/json" }),
    signal: AbortSignal.timeout(8_000),
  });
  return response.ok;
}
