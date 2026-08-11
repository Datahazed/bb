import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-thread-hover-cards",
    include: ["test/*.test.{ts,mjs}"],
    exclude: ["node_modules/**"],
  },
});
