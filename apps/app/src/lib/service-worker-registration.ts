import { getBbDesktopInfo } from "./bb-desktop";

/** Root-relative URL the build writes the worker to (see vite-service-worker.ts). */
export const SERVICE_WORKER_SCRIPT_URL = "/sw.js";

export interface ServiceWorkerRegistrationEnvironment {
  /** Production build: dev serves source modules that the worker cannot precache. */
  isProduction: boolean;
  /** `window.isSecureContext`: https or loopback. Browsers refuse to register otherwise. */
  isSecureContext: boolean;
  hasServiceWorkerApi: boolean;
  /** The Electron shell reads the app from local disk; a worker adds nothing there. */
  isDesktopShell: boolean;
}

export function shouldRegisterServiceWorker(
  env: ServiceWorkerRegistrationEnvironment,
): boolean {
  return (
    env.isProduction &&
    env.isSecureContext &&
    env.hasServiceWorkerApi &&
    !env.isDesktopShell
  );
}

/**
 * Registers the app-shell service worker after the page has finished loading,
 * so the precache install never competes with the boot fetches it will later
 * serve. No-op in dev, on insecure origins (plain http on a LAN address),
 * without the API, and inside the desktop shell.
 */
export function registerAppServiceWorker(): void {
  if (
    !shouldRegisterServiceWorker({
      hasServiceWorkerApi: "serviceWorker" in navigator,
      isDesktopShell: getBbDesktopInfo() !== null,
      isProduction: import.meta.env.PROD,
      isSecureContext: window.isSecureContext,
    })
  ) {
    return;
  }
  const register = (): void => {
    navigator.serviceWorker
      .register(SERVICE_WORKER_SCRIPT_URL, { scope: "/" })
      .catch((error: unknown) => {
        console.warn("[bb] service worker registration failed", error);
      });
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
