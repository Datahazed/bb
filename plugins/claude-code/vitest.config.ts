import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    name: "bb-plugin-claude-code",
    include: ["src/**/*.test.ts"],
  },
});
