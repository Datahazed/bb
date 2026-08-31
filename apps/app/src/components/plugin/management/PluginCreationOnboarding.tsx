import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";

type PluginCreationOnboardingMode = "prominent" | "supporting" | "compact";

export function PluginCreationOnboarding({
  mode,
  onCreate,
}: {
  mode: PluginCreationOnboardingMode;
  onCreate: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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

  const compact = mode === "compact" && !expanded;
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
        {mode === "compact" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show fewer" : "View all examples"}
            <Icon
              name={expanded ? "ChevronDown" : "ChevronRight"}
              className="size-3.5"
              aria-hidden
            />
          </Button>
        ) : null}
      </div>
      <BrowseArchetypeCards
        onCreate={onCreate}
        compact={compact}
        className="rounded-lg bg-surface-recessed/35 p-3"
      />
    </section>
  );
}
