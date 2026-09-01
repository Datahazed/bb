import { useState } from "react";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";

type PluginCreationOnboardingMode = "prominent" | "supporting";

export function PluginCreationOnboarding({
  mode,
  onCreate,
}: {
  mode: PluginCreationOnboardingMode;
  onCreate: (prompt: string) => void;
}) {
  const [composerRequest, setComposerRequest] = useState<{
    nonce: number;
    seed?: string;
  }>(() => ({ nonce: nextComposerRequestNonce() }));

  if (mode === "prominent") {
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

  return (
    <section
      className="space-y-3 border-t border-border-seam/60 pt-6"
      aria-labelledby="create-another-plugin-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="create-another-plugin-heading"
          className="text-sm font-semibold text-foreground"
        >
          Create another plugin
        </h2>
      </div>
      <BrowseArchetypeCards
        onCreate={onCreate}
        className="rounded-lg bg-surface-recessed/35 p-3"
      />
    </section>
  );
}
