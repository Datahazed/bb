import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerManagerCommands } from "../../commands/manager.js";

describe("bb manager command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerManagerCommands(program, () => "http://server");

  it("bb manager exits with a removal message", async () => {
    await expect(runCommand(["manager"], register)).rejects.toThrow(
      "process.exit:1",
    );

    const error = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(error).toContain("Manager commands were removed.");
    expect(error).toContain("bb thread spawn");
  });

  it("bb manager subcommands exit with the same removal message", async () => {
    await expect(
      runCommand(["manager", "list", "project-123"], register),
    ).rejects.toThrow("process.exit:1");

    const error = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(error).toContain("Manager commands were removed.");
    expect(error).toContain("bb thread list");
  });
});
