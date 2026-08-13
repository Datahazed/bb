import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    name: "bb-plugin-github-notifications",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    testTimeout: 20_000,
  },
});
