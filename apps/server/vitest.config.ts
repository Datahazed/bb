import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases";

export default defineConfig({
  resolve: {
    conditions: ["source"],
    alias: workspaceTestAliases,
  },
  benchmark: {
    include: ["test/**/*.bench.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
  test: {
    silent: "passed-only",
    name: "@bb/server",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    env: {
      BB_DATA_DIR: "/tmp/bb-server-test",
      BB_SERVER_PORT: "49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
  },
});
