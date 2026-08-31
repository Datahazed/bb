import { useState } from "react";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";

export function PluginCreationEmptyState() {
  const [composerRequest, setComposerRequest] = useState<{
    nonce: number;
    seed?: string;
  }>(() => ({ nonce: nextComposerRequestNonce() }));

  const openComposer = (seed?: string) =>
    setComposerRequest({
      nonce: nextComposerRequestNonce(),
      ...(seed === undefined ? {} : { seed }),
    });

  return (
    <div className="space-y-5">
      <BrowseHeroCarousel openRequest={composerRequest} />
      <BrowseArchetypeCards onCreate={openComposer} />
    </div>
  );
}
