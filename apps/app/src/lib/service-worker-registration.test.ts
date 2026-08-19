import { describe, expect, it } from "vitest";
import { shouldRegisterServiceWorker } from "./service-worker-registration";

const enabled = {
  hasServiceWorkerApi: true,
  isDesktopShell: false,
  isProduction: true,
  isSecureContext: true,
};

describe("shouldRegisterServiceWorker", () => {
  it("registers only for a production build on a secure origin outside the desktop shell", () => {
    expect(shouldRegisterServiceWorker(enabled)).toBe(true);
    // Dev serves unbundled source modules; nothing to precache and a stale
    // worker would shadow HMR.
    expect(
      shouldRegisterServiceWorker({ ...enabled, isProduction: false }),
    ).toBe(false);
    // Plain http on a LAN address: the browser would reject the registration
    // and log an error on every boot.
    expect(
      shouldRegisterServiceWorker({ ...enabled, isSecureContext: false }),
    ).toBe(false);
    expect(
      shouldRegisterServiceWorker({ ...enabled, hasServiceWorkerApi: false }),
    ).toBe(false);
    // Electron reads the bundle from disk; a worker only adds an update seam.
    expect(
      shouldRegisterServiceWorker({ ...enabled, isDesktopShell: true }),
    ).toBe(false);
  });
});
