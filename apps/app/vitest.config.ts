import path from "path";
import {
  defineWorkspaceTestConfig,
  findIsolationRequiringTests,
} from "../../vitest.shared.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

const include = ["src/**/*.test.ts", "src/**/*.test.tsx"];
const isolationTests = findIsolationRequiringTests(__dirname, ["src"], {
  stubsRestoredAfterEachTest: true,
});

export default defineWorkspaceTestConfig({
  plugins: [sharedUiEnvSeam(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    silent: "passed-only",
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 15_000,
    // Stubs and spies never outlive their test, so `vi.stubGlobal`/
    // `vi.stubEnv` files can share a worker (see `findIsolationRequiringTests`)
    // and a `vi.spyOn(window, "requestAnimationFrame")` left behind by one
    // file cannot stall every file that follows it in the same worker.
    unstubGlobals: true,
    unstubEnvs: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "@bb/app",
          include,
          exclude: ["dist/**", "node_modules/**", ...isolationTests],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "@bb/app:isolated",
          include: isolationTests,
        },
      },
    ],
  },
});
