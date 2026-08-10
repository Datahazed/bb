import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageExport {
  source: string;
  types: string;
  import: string;
  default: string;
}

describe("packed plugin SDK exports", () => {
  it("maps every packed subpath to runtime JavaScript and portable declarations", async () => {
    const packageRoot = new URL("../../", import.meta.url);
    const packageJson = JSON.parse(
      await readFile(new URL("package.json", packageRoot), "utf8"),
    ) as {
      bugs: { url: string };
      dependencies: Record<string, string>;
      description: string;
      files: string[];
      homepage: string;
      license: string;
      name: string;
      private?: boolean;
      publishConfig: { access: string };
      repository: { directory: string; type: string; url: string };
      exports: Record<string, PackageExport>;
    };

    expect(packageJson.name).toBe("@bb/plugin-sdk");
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.description).toBeTruthy();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.homepage).toBe(
      "https://github.com/get-bb/bb/tree/main/packages/plugin-sdk#readme",
    );
    expect(packageJson.bugs.url).toBe("https://github.com/get-bb/bb/issues");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/get-bb/bb.git",
      directory: "packages/plugin-sdk",
    });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.dependencies).toEqual({
      "cron-parser": "^5.5.0",
      hono: "^4.11.9",
    });
    expect(packageJson.files).toEqual(["bundled-types", "dist", "README.md"]);
    expect(Object.keys(packageJson.exports)).toEqual([
      ".",
      "./app",
      "./internal/composer-customization-validation",
      "./internal/composer-view",
      "./testing",
      "./testing/app",
    ]);

    for (const entry of Object.values(packageJson.exports)) {
      expect(entry.import).toMatch(/^\.\/dist\/.*\.js$/u);
      expect(entry.default).toBe(entry.import);
      expect(entry.types).toMatch(/^\.\/bundled-types\/.*\.d\.ts$/u);
      await expect(
        access(new URL(entry.types.slice(2), packageRoot)),
      ).resolves.toBeUndefined();
      expect(entry.source).toMatch(/^\.\/src\//u);
    }
  });
});
