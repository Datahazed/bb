import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  getAutomationDetailRoutePath,
  getAutomationEditRoutePath,
  getAutomationsRoutePath,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getPopoutRoutePath,
  getPopoutThreadRoutePath,
  getProjectArchivedRoutePath,
  getProjectlessArchivedRoutePath,
  getRegistrySkillDetailRoutePath,
  getSkillDetailRoutePath,
  getSkillsRoutePath,
  getSurfaceAwareThreadRoutePath,
  getThreadRoutePath,
  getToolsRoutePath,
  isRoutePath,
  isProjectlessProjectId,
  LEGACY_AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_AUTOMATIONS_ROUTE_PATH,
  LEGACY_SKILLS_ROUTE_PATH,
  POPOUT_ROUTE_PATH,
  resolveRouteHref,
  ROUTE_PATTERNS,
} from "./route-paths";

describe("route path helpers", () => {
  it("builds and recognizes the canonical projectless archived URL", () => {
    expect(getProjectlessArchivedRoutePath()).toBe("/archived");
    expect(getProjectArchivedRoutePath(PERSONAL_PROJECT_ID)).toBe("/archived");
    expect(isRoutePath({ path: "/archived" })).toBe(true);
  });

  it("builds canonical projectless thread detail URLs", () => {
    expect(
      getThreadRoutePath({
        projectId: PERSONAL_PROJECT_ID,
        threadId: "thr_personal",
      }),
    ).toBe("/threads/thr_personal");
  });

  it("keeps standard project thread detail URLs project scoped", () => {
    expect(
      getThreadRoutePath({
        projectId: "proj_standard",
        threadId: "thr_standard",
      }),
    ).toBe("/projects/proj_standard/threads/thr_standard");
  });

  it("recognizes only the personal project id as projectless", () => {
    expect(isProjectlessProjectId(PERSONAL_PROJECT_ID)).toBe(true);
    expect(isProjectlessProjectId("proj_standard")).toBe(false);
    expect(isProjectlessProjectId(undefined)).toBe(false);
  });

  it("recognizes route paths with query and hash suffixes", () => {
    expect(
      isRoutePath({
        path: "/projects/proj_standard/threads/thr_standard?panel=files#row-1",
      }),
    ).toBe(true);
  });

  it("recognizes the global settings route", () => {
    expect(isRoutePath({ path: "/settings" })).toBe(true);
  });

  it("builds and recognizes the Tools routes", () => {
    expect(getToolsRoutePath()).toBe("/tools");
    expect(getSkillsRoutePath()).toBe("/tools/skills");
    expect(
      getSkillDetailRoutePath({
        scope: "bb-user",
        providerId: null,
        skillName: "review-loop",
      }),
    ).toBe("/tools/skills/installed/bb-user/bb/review-loop");
    expect(
      getRegistrySkillDetailRoutePath({
        registrySkillId: "moss-skills/moss-notes",
      }),
    ).toBe("/tools/skills/registry/moss-skills%2Fmoss-notes");
    expect(getPluginsRoutePath()).toBe("/tools/plugins");
    expect(getPluginDetailRoutePath({ pluginId: "github" })).toBe(
      "/tools/plugins/github",
    );
    expect(getAutomationsRoutePath()).toBe("/tools/automations");
    expect(
      getAutomationDetailRoutePath({
        projectId: "proj_standard",
        automationId: "auto_standard",
      }),
    ).toBe("/tools/automations/proj_standard/auto_standard");
    expect(
      getAutomationEditRoutePath({
        projectId: "proj_standard",
        automationId: "auto_standard",
      }),
    ).toBe("/tools/automations/proj_standard/auto_standard/edit");

    for (const path of [
      "/tools",
      "/tools/skills",
      "/tools/skills/installed/bb-user/bb/review-loop",
      "/tools/skills/registry/moss-skills%2Fmoss-notes",
      "/tools/plugins",
      "/tools/plugins/browse",
      "/tools/plugins/github",
      "/tools/automations",
      "/tools/automations/browse",
      "/tools/automations/proj_standard/auto_standard",
      "/tools/automations/proj_standard/auto_standard/edit",
    ]) {
      expect(isRoutePath({ path })).toBe(true);
    }
  });

  it("keeps old Skills and Automations paths recognizable for redirects", () => {
    expect(LEGACY_SKILLS_ROUTE_PATH).toBe("/skills");
    expect(LEGACY_AUTOMATIONS_ROUTE_PATH).toBe("/automations");
    expect(LEGACY_AUTOMATION_DETAIL_ROUTE_PATH).toBe(
      "/automations/:projectId/:automationId",
    );
    expect(isRoutePath({ path: "/skills" })).toBe(true);
    expect(isRoutePath({ path: "/automations" })).toBe(true);
    expect(
      isRoutePath({ path: "/automations/proj_standard/auto_standard" }),
    ).toBe(true);
  });

  it("recognizes every declared route pattern's concrete example", () => {
    const examplesByPattern = new Map<string, string>([
      ["/", "/"],
      ["/auth/callback", "/auth/callback"],
      ["/popout", "/popout"],
      ["/popout/threads/:threadId", "/popout/threads/thr_personal"],
      [
        "/popout/projects/:projectId/threads/:threadId",
        "/popout/projects/proj_standard/threads/thr_standard",
      ],
      ["/settings", "/settings"],
      ["/settings/:section", "/settings/general"],
      ["/settings/providers/:providerId", "/settings/providers/codex"],
      ["/settings/plugins", "/settings/plugins"],
      ["/settings/plugins/:pluginId", "/settings/plugins/github"],
      ["/tools", "/tools"],
      ["/tools/skills", "/tools/skills"],
      [
        "/tools/skills/installed/:scope/:providerId/:skillName",
        "/tools/skills/installed/bb-user/bb/review-loop",
      ],
      [
        "/tools/skills/registry/:registrySkillId",
        "/tools/skills/registry/moss-skills%2Fmoss-notes",
      ],
      ["/tools/plugins", "/tools/plugins"],
      ["/tools/plugins/browse", "/tools/plugins/browse"],
      ["/tools/plugins/:pluginId", "/tools/plugins/github"],
      ["/tools/automations", "/tools/automations"],
      ["/tools/automations/browse", "/tools/automations/browse"],
      [
        "/tools/automations/:projectId/:automationId",
        "/tools/automations/proj_standard/auto_standard",
      ],
      [
        "/tools/automations/:projectId/:automationId/edit",
        "/tools/automations/proj_standard/auto_standard/edit",
      ],
      ["/skills", "/skills"],
      ["/automations", "/automations"],
      [
        "/automations/:projectId/:automationId",
        "/automations/proj_standard/auto_standard",
      ],
      ["/projects/:projectId", "/projects/proj_standard"],
      ["/archived", "/archived"],
      ["/projects/:projectId/settings", "/projects/proj_standard/settings"],
      ["/projects/:projectId/archived", "/projects/proj_standard/archived"],
      ["/threads/:threadId", "/threads/thr_personal"],
      [
        "/projects/:projectId/threads/:threadId",
        "/projects/proj_standard/threads/thr_standard",
      ],
      ["/plugins/:pluginId/:panelPath/*", "/plugins/github/pulls"],
    ]);

    expect([...examplesByPattern.keys()].sort()).toEqual(
      [...ROUTE_PATTERNS].sort(),
    );
    for (const [pattern, example] of examplesByPattern) {
      expect(isRoutePath({ path: example }), pattern).toBe(true);
    }
  });

  it("recognizes the desktop popout route", () => {
    expect(POPOUT_ROUTE_PATH).toBe("/popout");
    expect(getPopoutRoutePath()).toBe("/popout");
    expect(isRoutePath({ path: "/popout" })).toBe(true);
  });
  it("builds and recognizes popout thread URLs", () => {
    expect(
      getPopoutThreadRoutePath({
        projectId: PERSONAL_PROJECT_ID,
        threadId: "thr_personal",
      }),
    ).toBe("/popout/threads/thr_personal");
    expect(
      getPopoutThreadRoutePath({
        projectId: "proj_standard",
        threadId: "thr_standard",
      }),
    ).toBe("/popout/projects/proj_standard/threads/thr_standard");
    expect(isRoutePath({ path: "/popout/threads/thr_personal" })).toBe(true);
    expect(
      isRoutePath({
        path: "/popout/projects/proj_standard/threads/thr_standard",
      }),
    ).toBe(true);
  });

  it("builds thread URLs for the active surface", () => {
    expect(
      getSurfaceAwareThreadRoutePath({
        projectId: PERSONAL_PROJECT_ID,
        surface: "page",
        threadId: "thr_personal",
      }),
    ).toBe("/threads/thr_personal");
    expect(
      getSurfaceAwareThreadRoutePath({
        projectId: PERSONAL_PROJECT_ID,
        surface: "popout",
        threadId: "thr_personal",
      }),
    ).toBe("/popout/threads/thr_personal");
    expect(
      getSurfaceAwareThreadRoutePath({
        projectId: "proj_standard",
        surface: "popout",
        threadId: "thr_standard",
      }),
    ).toBe("/popout/projects/proj_standard/threads/thr_standard");
  });

  it("does not mistake deeper filesystem-like paths for routes", () => {
    expect(
      isRoutePath({
        path: "/projects/my-repo/src/file.ts",
      }),
    ).toBe(false);
  });

  it("resolves same-origin hrefs to router paths", () => {
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "https://bb.local/projects/proj_standard/threads/thr_standard?q=1",
      }),
    ).toEqual({
      path: "/projects/proj_standard/threads/thr_standard?q=1",
    });
  });

  it("rejects external and protocol-relative route-shaped hrefs", () => {
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "https://example.test/projects/proj_standard/threads/thr_standard",
      }),
    ).toBeNull();
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "//example.test/projects/proj_standard/threads/thr_standard",
      }),
    ).toBeNull();
  });

  it("rejects fragment-only and query-only hrefs", () => {
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "#timeline-row",
      }),
    ).toBeNull();
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "?panel=files",
      }),
    ).toBeNull();
  });
});
