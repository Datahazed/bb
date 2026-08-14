import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    name: "@bb/provider-driver-helpers",
    include: ["src/**/*.test.ts"],
  },
});
