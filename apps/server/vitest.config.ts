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
    exclude: [
      "dist/**",
      "node_modules/**",
      // Quarantined wire-protocol suites (single-host rebuild, plan §6
      // Phase 1): they drive the unmounted /internal routes and daemon-WS
      // protocol, or the orphaned durable-queue machinery
      // (expired-commands), or assert durable queue-row lifecycle states
      // (thread-lifecycle). Deleted in P1c with the transport modules; the
      // surviving behavior gets new tests with the Phase 2 lifecycle
      // rewrite. Also excluded from typecheck in tsconfig.json.
      "test/internal/**",
      "test/hosts/expired-commands.test.ts",
      "test/threads/thread-lifecycle.test.ts",
    ],
    env: {
      BB_DATA_DIR: "/tmp/bb-server-test",
      BB_SERVER_PORT: "49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
  },
});
