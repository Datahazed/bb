import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("bundled plugin SDK declarations", () => {
  it("use portable named SDK results without workspace imports", async () => {
    const declarations = await readFile(
      new URL("../../bundled-types/bb-plugin-sdk.d.ts", import.meta.url),
      "utf8",
    );

    expect(declarations).not.toMatch(/from ['"]@bb\//u);
    expect(declarations).not.toContain("PublicApiOutput");
    expect(declarations).not.toContain("PublicApiSchema");
    expect(declarations).toContain("type ThreadSpawnResult = ThreadResponse;");
    expect(declarations).toContain(
      "type FileReadResult = HostFileReadResponse;",
    );
    expect(declarations).toContain("type ProjectGetResult = ProjectResponse;");
    expect(declarations).toContain(
      "type EnvironmentStatusResult = EnvironmentStatusResponse;",
    );
    expect(declarations).toContain("interface PluginMarketplacesArea");
    expect(declarations).toContain("installFromMarketplace(");
    expect(declarations).toContain("getSource(args: PluginIdArgs)");
    expect(declarations).toContain("checkUpdates(");
    expect(declarations).toContain("applyUpdate(args: PluginIdArgs)");

    const appDeclarations = await readFile(
      new URL("../../bundled-types/bb-plugin-sdk-app.d.ts", import.meta.url),
      "utf8",
    );
    expect(appDeclarations).not.toContain("PluginMarketplacesArea");
    expect(appDeclarations).not.toContain("installFromMarketplace");
    expect(appDeclarations).not.toContain("applyUpdate(args: PluginIdArgs)");
  });
});
