import { useEffect, useRef } from "react";
import { appToast } from "@/components/ui/app-toast";
import {
  useConsumePluginListingNotice,
  usePluginListings,
} from "@/hooks/queries/plugin-settings-queries";
import { useAppNavigationHost } from "@/lib/app-navigation-host";

export function PluginListingNoticeHost() {
  const listings = usePluginListings({ enabled: true });
  const consume = useConsumePluginListingNotice();
  const navigation = useAppNavigationHost();
  const shownNoticeIds = useRef(new Set<string>());

  useEffect(() => {
    for (const notice of listings.data?.notices ?? []) {
      if (shownNoticeIds.current.has(notice.id)) continue;
      shownNoticeIds.current.add(notice.id);
      if (notice.kind === "published") {
        appToast.success(`${notice.pluginName} is published`, {
          description: "Its listing is now live in BB Community.",
        });
      } else {
        appToast.warning(`${notice.pluginName} submission needs changes`, {
          description: "The marketplace review closed without merging.",
          action: {
            label: "View PR",
            onClick: () => navigation.openUrl({ url: notice.pullRequestUrl }),
          },
        });
      }
      consume.mutate(notice.id);
    }
  }, [consume, listings.data?.notices, navigation]);

  return null;
}
