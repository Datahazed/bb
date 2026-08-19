import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // defaultViewTransition routes every client-side navigation through the
  // platform View Transition API. The animation itself is CSS in styles.css
  // (`::view-transition-*`), applied once to the routed content region so
  // persistent chrome neither animates nor re-mounts. Browsers without the
  // API swap instantly, which is also what reduced-motion gets.
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultViewTransition: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
