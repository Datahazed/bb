import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerNotificationCommands } from "../../commands/notifications.js";

const subscription = {
  id: "push_abc123",
  expoPushToken: "ExponentPushToken[abc]",
  platform: "ios",
  deviceLabel: "Sawyer's iPhone",
  createdAt: 1_000,
  lastSeenAt: Date.now(),
};

describe("bb notifications push-subscriptions commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerNotificationCommands(program, () => "http://server");

  it("lists registered devices as a table and as JSON", async () => {
    stubServerApi({
      "v1.notifications.push-subscriptions.$get": vi.fn(async () => ({
        subscriptions: [subscription],
      })),
    });

    await runCommand(["notifications", "push-subscriptions", "list"], register);
    const lines = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(lines).toContain("ID");
    expect(lines).toContain("push_abc123");
    expect(lines).toContain("Sawyer's iPhone");
    expect(lines).toContain("ios");
    expect(lines).toContain("just now");

    vi.mocked(console.log).mockClear();
    await runCommand(
      ["notifications", "push-subscriptions", "list", "--json"],
      register,
    );
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify([subscription], null, 2),
    ]);
  });

  it("prints a hint when no devices are registered", async () => {
    stubServerApi({
      "v1.notifications.push-subscriptions.$get": vi.fn(async () => ({
        subscriptions: [],
      })),
    });

    await runCommand(["notifications", "push-subscriptions", "list"], register);
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "No push devices registered",
    ]);
  });

  it("registers a device and reports created versus refreshed", async () => {
    let calls = 0;
    const post = vi.fn(async ({ json }) => {
      calls += 1;
      return new Response(
        JSON.stringify({ ...subscription, ...json, lastSeenAt: 5 }),
        {
          status: calls === 1 ? 201 : 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    stubServerApi({ "v1.notifications.push-subscriptions.$post": post });

    await runCommand(
      [
        "notifications",
        "push-subscriptions",
        "add",
        "--token",
        "ExponentPushToken[abc]",
        "--platform",
        "ios",
        "--label",
        "Sawyer's iPhone",
      ],
      register,
    );
    await runCommand(
      [
        "notifications",
        "push-subscriptions",
        "add",
        "--token",
        "ExponentPushToken[abc]",
        "--platform",
        "ios",
        "--label",
        "Sawyer's iPhone",
        "--json",
      ],
      register,
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, {
      json: {
        expoPushToken: "ExponentPushToken[abc]",
        platform: "ios",
        deviceLabel: "Sawyer's iPhone",
      },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Registered push device Sawyer's iPhone (push_abc123)",
      JSON.stringify(
        {
          created: false,
          subscription: { ...subscription, lastSeenAt: 5 },
        },
        null,
        2,
      ),
    ]);
  });

  it("rejects unknown platforms before calling the server", async () => {
    const post = vi.fn();
    stubServerApi({ "v1.notifications.push-subscriptions.$post": post });

    await expect(
      runCommand(
        [
          "notifications",
          "push-subscriptions",
          "add",
          "--token",
          "ExponentPushToken[abc]",
          "--platform",
          "web",
          "--label",
          "Browser",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(post).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
      "Invalid platform 'web'",
    );
  });

  it("removes a device by id", async () => {
    const del = vi.fn(async () => ({ ok: true }));
    stubServerApi({ "v1.notifications.push-subscriptions.:id.$delete": del });

    await runCommand(
      ["notifications", "push-subscriptions", "remove", "push_abc123"],
      register,
    );
    await runCommand(
      [
        "notifications",
        "push-subscriptions",
        "remove",
        "push_abc123",
        "--json",
      ],
      register,
    );

    expect(del).toHaveBeenCalledWith({ param: { id: "push_abc123" } });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Removed push device push_abc123",
      JSON.stringify({ id: "push_abc123", ok: true }, null, 2),
    ]);
  });
});
