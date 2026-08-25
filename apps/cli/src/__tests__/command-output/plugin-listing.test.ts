import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

function jsonResponse(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bb plugin listing commands", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("lists only the server-authorized authored records", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        records: [
          {
            pluginId: "author-tools",
            authorship: "path",
            lifecycle: { status: "not-published" },
          },
        ],
        notices: [],
      }),
    );

    await runCommand(["plugin", "listing", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toContain(
      "author-tools  not-published",
    );
  });

  it("computes an omitted submission timestamp when the command runs", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_321);
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: {
          pluginId: "author-tools",
          authorship: "path",
          lifecycle: {
            status: "in-review",
            entry: {
              id: "author-tools",
              displayName: "Author tools",
              description: "Authoring tools.",
              icon: "Toolbox",
              author: { name: "Author" },
              source: {
                git: {
                  url: "https://github.com/author/author-tools.git",
                  range: "^1.0.0",
                },
              },
              category: "plugin-development",
              screenshots: [],
            },
            pullRequest: {
              url: "https://github.com/get-bb/marketplace/pull/42",
              openedAt: 4_321,
            },
          },
        },
      }),
    );

    await runCommand(
      [
        "plugin",
        "listing",
        "record-submission",
        "author-tools",
        "https://github.com/get-bb/marketplace/pull/42",
      ],
      register,
    );

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      pullRequestUrl: "https://github.com/get-bb/marketplace/pull/42",
      openedAt: 4_321,
    });
  });

  it("validates and sends a complete v2 draft entry", async () => {
    const entry = {
      id: "author-tools",
      displayName: "Author tools",
      description: "Authoring tools.",
      icon: "Toolbox",
      author: { name: "Author" },
      source: {
        git: {
          url: "https://github.com/author/author-tools.git",
          range: "^1.0.0",
        },
      },
      category: "plugin-development",
      screenshots: [],
    };
    const directory = await mkdtemp(join(tmpdir(), "bb-listing-cli-"));
    const entryFile = join(directory, "entry.json");
    await writeFile(entryFile, JSON.stringify(entry));
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        record: {
          pluginId: "author-tools",
          authorship: "path",
          lifecycle: { status: "draft", entry },
        },
      }),
    );

    try {
      await runCommand(
        ["plugin", "listing", "save-draft", "author-tools", entryFile],
        register,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ entry });
    expect(collectLogPayloads(vi.mocked(console.log))).toContain(
      "author-tools  draft",
    );
  });

  it("documents the nested state mutation commands and flags in help", async () => {
    const help = await getHelpOutput(["plugin", "listing"], register);
    expect(help).toContain("list");
    expect(help).toContain("save-draft");
    expect(help).toContain("record-submission");
    expect(
      await getHelpOutput(["plugin", "listing", "record-submission"], register),
    ).toContain("--opened-at");
  });
});
