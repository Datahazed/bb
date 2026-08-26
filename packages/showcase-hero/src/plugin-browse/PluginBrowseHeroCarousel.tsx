import {
  BubbleChatIcon,
  ChartColumnIcon,
  CheckListIcon,
  FolderIcon,
  LayoutTwoColumnIcon,
  Mail02Icon,
  PlayIcon,
  TestTube01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { IconName } from "@bb/shared-ui/icon";
import type { ReactNode } from "react";
import {
  ShowcaseHeroCarousel,
  type ShowcaseHeroCopy,
} from "../ShowcaseHeroCarousel";
import { BROWSE_ARCHETYPES } from "./browse-archetypes";
import { MINI_APP_SCENES } from "./MiniAppScenes";

/** bb's own nav rail, which a plugin's panel joins. */
const PLUGIN_RAIL: readonly IconName[] = [
  "MessageSquare",
  "Folder",
  "ListTodo",
];

// The public Guide server-renders the hero. Static artwork keeps the server
// and hydration trees identical; shared-ui's extended registry intentionally
// begins as an empty SVG in a fresh browser and is therefore app-only here.
const PLUGIN_HERO_ICONS: Readonly<Partial<Record<IconName, IconSvgElement>>> = {
  Beaker: TestTube01Icon,
  ChartColumn: ChartColumnIcon,
  Columns2: LayoutTwoColumnIcon,
  Folder: FolderIcon,
  ListTodo: CheckListIcon,
  Mail: Mail02Icon,
  MessageSquare: BubbleChatIcon,
  Play: PlayIcon,
  UserRound: UserIcon,
};

function renderPluginHeroIcon(name: IconName, className: string) {
  const icon = PLUGIN_HERO_ICONS[name];
  if (icon === undefined) {
    throw new Error(`Missing static plugin hero icon: ${name}`);
  }
  return <HugeiconsIcon icon={icon} className={className} data-icon={name} />;
}

export const PLUGIN_HERO_COPY: ShowcaseHeroCopy = {
  ariaLabel: "What you can build with bb plugins",
  headlineLead: "Turn bb into",
  composingNoun: "whatever you need",
  description:
    "Plugins add app surfaces, commands, services, schedules, and skills to bb. Install an official plugin, or describe your own and build it from a prompt.",
  tablistLabel: "Plugin examples",
  frameTitlePrefix: "bb — ",
  frameBadge: "Plugin",
};

export interface PluginBrowseHeroCarouselProps {
  /** Force a slide for stable screenshots or controlled presentations. */
  initialIndex?: number;
  autoplay?: boolean;
  /**
   * Host-owned composer content. Public hosts omit this; the bb app supplies
   * its real new-thread composer through its local adapter.
   */
  composerSlot?: ReactNode;
}

/** The complete portable plugin Browse hero preset. */
export function PluginBrowseHeroCarousel({
  initialIndex = 0,
  autoplay = true,
  composerSlot,
}: PluginBrowseHeroCarouselProps) {
  return (
    <ShowcaseHeroCarousel
      archetypes={BROWSE_ARCHETYPES}
      scenes={MINI_APP_SCENES}
      copy={PLUGIN_HERO_COPY}
      rail={PLUGIN_RAIL}
      initialIndex={initialIndex}
      autoplay={autoplay}
      composerSlot={composerSlot}
      renderIcon={renderPluginHeroIcon}
    />
  );
}
