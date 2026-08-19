import { fileURLToPath } from "node:url";
import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  // vite.config.ts injects this from the target deployment's APP_URL; tests
  // load modules without that config, so they get an obviously-not-real origin.
  define: { __SITE_ORIGIN__: JSON.stringify("https://web.test") },
  // Mirror vite.config.ts's "@" alias so tests can import app modules.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    silent: "passed-only",
    name: "@bb/web",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
