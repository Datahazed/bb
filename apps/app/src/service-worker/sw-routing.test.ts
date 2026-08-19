import { describe, expect, it } from "vitest";
import { classifyServiceWorkerRequest } from "./sw-routing.js";

const scopeOrigin = "https://bee.getbb.app";
const classify = (url: string, mode = "cors", method = "GET") =>
  classifyServiceWorkerRequest({ method, mode, scopeOrigin, url });

describe("classifyServiceWorkerRequest", () => {
  it("routes app navigations and hashed assets, nothing else", () => {
    expect(classify(`${scopeOrigin}/`, "navigate")).toBe("navigation");
    expect(
      classify(`${scopeOrigin}/threads/thr_1?panel=diff`, "navigate"),
    ).toBe("navigation");
    expect(classify(`${scopeOrigin}/assets/index-AAA.js`)).toBe("asset");
    expect(classify(`${scopeOrigin}/assets/inter-latin-BBB.woff2`)).toBe(
      "asset",
    );
  });

  it("passes through API, realtime, host, connect, plugin, root-file and foreign requests", () => {
    for (const url of [
      `${scopeOrigin}/api/v1/threads`,
      `${scopeOrigin}/api/v1/plugins/tasks/assets/app.js`,
      `${scopeOrigin}/api/v1/plugins/tasks/assets/app.css`,
      `${scopeOrigin}/ws`,
      `${scopeOrigin}/internal/hosts/enroll-key`,
      `${scopeOrigin}/__tunnel`,
      `${scopeOrigin}/sw.js`,
      `${scopeOrigin}/manifest.webmanifest`,
      `${scopeOrigin}/icon-192.png`,
      `${scopeOrigin}/assets/`,
      "https://cdn.example.com/assets/index-AAA.js",
      "not a url",
    ]) {
      expect(classify(url), url).toBe("passthrough");
    }
    expect(classify(`${scopeOrigin}/assets/index-AAA.js`, "cors", "POST")).toBe(
      "passthrough",
    );
  });

  it("never answers a navigation to a non-app path from the shell", () => {
    for (const path of [
      "/api",
      "/api/v1/threads/thr_1/attachments/att_1/download",
      "/ws",
      "/internal/status",
      "/__tunnel",
      "/install.sh",
      "/install/version",
    ]) {
      expect(classify(`${scopeOrigin}${path}`, "navigate"), path).toBe(
        "passthrough",
      );
    }
  });
});
