import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases";

export default defineConfig({
  resolve: {
    conditions: ["source"],
    alias: workspaceTestAliases,
  },
  test: {
    silent: "passed-only",
    name: "@bb/cli",
    exclude: ["dist/**", "node_modules/**"],
    env: {
      BB_SERVER_URL: "http://127.0.0.1:49161",
    },
  },
});
