import type { ComponentProps } from "react";
import { Link, matchPath, useLocation, type To } from "react-router-dom";
import {
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  getPluginAuthorRoutePath,
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
