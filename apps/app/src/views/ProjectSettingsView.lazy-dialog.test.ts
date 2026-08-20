import { describe, expect, it, vi } from "vitest";

const deferredModules = vi.hoisted(() => ({
  pathDialogLoads: 0,
  remotePathBrowserLoads: 0,
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => {
  deferredModules.pathDialogLoads += 1;
  return {
    ProjectPathDialogContent: () => null,
  };
});

vi.mock("@/components/dialogs/RemotePathBrowser", () => {
  deferredModules.remotePathBrowserLoads += 1;
  return {
    RemotePathBrowser: () => null,
  };
});

describe("ProjectSettingsView project path dialog boundary", () => {
  it("does not load the path dialog body when the route module loads", async () => {
    const route = await import("./ProjectSettingsView");

    expect(route.ProjectSettingsView).toBeTypeOf("function");
    expect(deferredModules).toEqual({
      pathDialogLoads: 0,
      remotePathBrowserLoads: 0,
    });
  });
});
