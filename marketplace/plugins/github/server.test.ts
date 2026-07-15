import { describe, expect, expectTypeOf, it } from "vitest";
import type { PluginRpcClient, PluginRpcHandlers } from "@bb/plugin-sdk";
import { githubRpcContract } from "./server";

function assertGithubFrontendInference(
  client: PluginRpcClient<typeof githubRpcContract>,
) {
  expectTypeOf(
    client.call("getIssue", { repo: "ymichael/bb", number: 706 }),
  ).toMatchTypeOf<
    Promise<{
      issue: {
        repo: string;
        number: number;
        title: string;
        comments: Array<{ author: string; body: string; createdAt: string }>;
      };
    }>
  >();
  expectTypeOf(
    client.call("startReview", { repo: "ymichael/bb", number: 706 }),
  ).toEqualTypeOf<Promise<{ threadId: string }>>();

  // @ts-expect-error GitHub item numbers are validated as numbers.
  void client.call("getPull", { repo: "ymichael/bb", number: "706" });
  // @ts-expect-error createIssue requires a non-optional title.
  void client.call("createIssue", { repo: "ymichael/bb" });
}

describe("GitHub RPC contract", () => {
  it("infers backend inputs and frontend results", () => {
    type Handlers = PluginRpcHandlers<typeof githubRpcContract>;
    expectTypeOf<Parameters<Handlers["setAssignees"]>[0]>().toEqualTypeOf<{
      repo: string;
      number: number;
      assignees: string[];
    }>();
    expectTypeOf(assertGithubFrontendInference).toBeFunction();
  });

  it("rejects method-specific invalid input and output", async () => {
    const input = await githubRpcContract.getPull.input["~standard"].validate({
      repo: "ymichael/bb",
      number: "706",
    });
    expect(input).toHaveProperty("issues");

    const output = await githubRpcContract.getPull.output["~standard"].validate({
      pull: {
        repo: "ymichael/bb",
        number: 706,
        title: "Schema-driven RPC",
        checks: [{ name: "test", status: "maybe", url: "" }],
      },
    });
    expect(output).toHaveProperty("issues");
  });
});
