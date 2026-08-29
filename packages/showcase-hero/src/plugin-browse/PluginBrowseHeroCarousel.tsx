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

const PLUGIN_RAIL: readonly IconName[] = [
  "MessageSquare",
  "Folder",
  "ListTodo",
];

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
    "Plugins let you extend every part of bb. Install one from the community, or ask an agent to create one for you.",
  tablistLabel: "Plugin examples",
  frameTitlePrefix: "bb — ",
  frameBadge: "Plugin",
};

export interface PluginBrowseHeroCarouselProps {
  initialIndex?: number;
  autoplay?: boolean;
  composerSlot?: ReactNode;
}

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
