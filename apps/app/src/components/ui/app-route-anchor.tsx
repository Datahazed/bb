import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { isRoutePath, resolveRouteHref } from "@/lib/route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";

export interface RouteNavigationProviderProps {
  children: ReactNode;
}

export interface RouteAnchorProps extends Omit<
  ComponentPropsWithoutRef<"a">,
  "href"
> {
  href: string | undefined;
}

interface ShouldHandleRouteAnchorClickArgs {
  event: ReactMouseEvent<HTMLAnchorElement>;
}

interface RouteNavigation {
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /**
   * Opens a route beside the focused pane, the way cmd-click on a sidebar
   * row does. Returns false — and does nothing — when the route is not pane
   * content or splits are off, so the caller can fall back to the browser.
   */
  openInSplit: (path: string) => boolean;
}

const RouteNavigationContext = createContext<RouteNavigation | null>(null);

function currentOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

function shouldHandleRouteAnchorClick({
  event,
}: ShouldHandleRouteAnchorClickArgs): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  const target = event.currentTarget.getAttribute("target");
  return target === null || target === "" || target === "_self";
}

export function RouteNavigationProvider({
  children,
}: RouteNavigationProviderProps) {
  const navigate = useNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  const navigateRoute = useCallback<RouteNavigation["navigate"]>(
    (path, options) => {
      void navigate(path, options?.replace ? { replace: true } : undefined);
    },
    [navigate],
  );
  const openInSplit = useCallback<RouteNavigation["openInSplit"]>(
    (path) => {
      const content = paneContentForPathname(path.split(/[?#]/)[0] ?? path);
      if (content === null) return false;
      openPaneContentInSplit({
        store,
        navigate: navigateRoute,
        content,
        route: path,
        enabled: !isCompact,
      });
      return true;
    },
    [isCompact, navigateRoute, store],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    return browserApi.onOpenTab(({ url }) => {
      if (!isRoutePath({ path: url })) {
        return;
      }
      navigateRoute(url);
    });
  }, [navigateRoute]);

  const value = useMemo<RouteNavigation>(
    () => ({ navigate: navigateRoute, openInSplit }),
    [navigateRoute, openInSplit],
  );
  return (
    <RouteNavigationContext.Provider value={value}>
      {children}
    </RouteNavigationContext.Provider>
  );
}

/**
 * A click handler for a container whose descendants may include anchors to
 * app routes — plugin-rendered UI, chiefly. Plain clicks on such anchors
 * navigate client-side, so the app's Back button keeps working; cmd/ctrl
 * clicks open the route beside the focused pane when it can live in one.
 * Links to a plugin's own page (its Extensions detail) open beside on any
 * click: that page is a companion to whatever you are reading, and the
 * Extensions list will open it the same way. Every other click, and every
 * anchor to anywhere else, is left to the browser. Outside a
 * RouteNavigationProvider it does nothing.
 */
export function useRouteAnchorDelegate(): (
  event: ReactMouseEvent<HTMLElement>,
) => void {
  const navigation = useContext(RouteNavigationContext);
  return useCallback(
    (event) => {
      if (navigation === null || event.defaultPrevented) return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (anchor === null || !event.currentTarget.contains(anchor)) return;
      const target = anchor.getAttribute("target");
      if (target !== null && target !== "" && target !== "_self") return;
      if (event.button !== 0 || event.altKey || event.shiftKey) return;
      const origin = currentOrigin();
      if (origin === null) return;
      const route = resolveRouteHref({
        currentOrigin: origin,
        href: anchor.getAttribute("href") ?? "",
      });
      if (route === null) return;
      const opensBeside =
        event.metaKey ||
        event.ctrlKey ||
        paneContentForPathname(route.path.split(/[?#]/)[0] ?? route.path)
          ?.kind === "plugin-detail";
      if (opensBeside) {
        if (navigation.openInSplit(route.path)) event.preventDefault();
        return;
      }
      event.preventDefault();
      navigation.navigate(route.path);
    },
    [navigation],
  );
}

export function RouteAnchor({
  href,
  onClick,
  rel,
  target,
  ...anchorProps
}: RouteAnchorProps) {
  const navigation = useContext(RouteNavigationContext);
  const route = useMemo(() => {
    const origin = currentOrigin();
    return origin === null || href === undefined
      ? null
      : resolveRouteHref({ currentOrigin: origin, href });
  }, [href]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event);
      if (
        route === null ||
        navigation === null ||
        !shouldHandleRouteAnchorClick({ event })
      ) {
        return;
      }

      event.preventDefault();
      navigation.navigate(route.path);
    },
    [navigation, onClick, route],
  );

  return (
    <a
      {...anchorProps}
      href={href}
      rel={route === null ? rel : undefined}
      target={route === null ? target : undefined}
      onClick={handleClick}
    />
  );
}
