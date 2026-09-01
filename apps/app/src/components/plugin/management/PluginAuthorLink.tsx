import type { ComponentProps } from "react";
import { Link, matchPath, useLocation, type To } from "react-router-dom";
import {
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  getPluginAuthorRoutePath,
  getPluginsRoutePath,
} from "@/lib/route-paths";

function pluginAuthorLinkTarget({
  authorId,
  pathname,
  search,
}: {
  authorId: string;
  pathname: string;
  search: string;
}): To {
  if (matchPath(TOOLS_PLUGIN_DETAIL_ROUTE_PATH, pathname) === null) {
    return getPluginAuthorRoutePath({ authorId });
  }
  const nextSearchParams = new URLSearchParams(search);
  nextSearchParams.set("author", authorId);
  return {
    pathname,
    search: `?${nextSearchParams.toString()}`,
  };
}

export function PluginAuthorLink({
  authorId,
  ...props
}: Omit<ComponentProps<typeof Link>, "to"> & { authorId: string }) {
  const location = useLocation();
  return (
    <Link
      {...props}
      to={pluginAuthorLinkTarget({
        authorId,
        pathname: location.pathname,
        search: location.search,
      })}
    />
  );
}

export function PluginAuthorByline({
  authorId,
  name,
}: {
  authorId: string;
  name: string;
}) {
  return (
    <PluginAuthorLink
      authorId={authorId}
      className="pointer-events-auto relative rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="text-2xs text-subtle-foreground">By</span>{" "}
      <span className="text-xs text-foreground/80">{name}</span>
    </PluginAuthorLink>
  );
}

export function PluginAuthorBackLink(
  props: Omit<ComponentProps<typeof Link>, "to">,
) {
  const location = useLocation();
  const nextSearchParams = new URLSearchParams(location.search);
  nextSearchParams.delete("author");
  const search = nextSearchParams.toString();
  const to: To =
    matchPath(TOOLS_PLUGIN_DETAIL_ROUTE_PATH, location.pathname) === null
      ? getPluginsRoutePath()
      : {
          pathname: location.pathname,
          search: search.length === 0 ? "" : `?${search}`,
        };
  return <Link {...props} to={to} />;
}
