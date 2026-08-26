import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { PluginBrowseHeroCarousel } from "@bb/showcase-hero";
import { PluginNewThreadComposer } from "@/components/plugin/PluginNewThreadComposer";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { getThreadRoutePath } from "@/lib/route-paths";

const PLUGIN_HERO_COMPOSER = {
  promptPrefix: CREATE_PLUGIN_PROMPT,
  placeholder: "Describe the plugin you want to build…",
  draftKey: "plugins-browse-hero",
} as const;

interface BrowseHeroCarouselProps {
  /** Stories force a slide and disable autoplay to capture a stable frame. */
  initialIndex?: number;
  autoplay?: boolean;
  /** Stories and public hosts render without bb's thread-creating composer. */
  composerDisabled?: boolean;
  /** External open/close request from a card or page-level create button. */
  openRequest?: {
    nonce: number;
    seed?: string;
    close?: boolean;
  } | null;
  onComposingChange?: (composing: boolean) => void;
}

/**
 * App-local adapter around the portable plugin Browse hero.
 *
 * The shared package owns the exact carousel, plugin copy, archetypes, scenes,
 * and motion. This adapter owns everything that only an installed bb can do:
 * saved prompt drafts, external composer requests, thread creation, and route
 * navigation after submit.
 */
export function BrowseHeroCarousel({
  initialIndex = 0,
  autoplay = true,
  composerDisabled = false,
  openRequest = null,
  onComposingChange,
}: BrowseHeroCarouselProps) {
  const navigate = useNavigate();
  const createThread = useCreateThread();
  // The composer restores its saved draft on mount and only falls back to
  // `initialPrompt` when that draft is empty. Explicit example seeds must win
  // over an old draft, so those requests replace the stored text first.
  const promptDraft = useMemo(
    () =>
      getPromptDraftAccessor({
        kind: "plugin-new-thread",
        key: PLUGIN_HERO_COMPOSER.draftKey,
      }),
    [],
  );
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);

  // Notify from the events that change the mode, not from an effect. The ref
  // keeps the callback exactly-once under StrictMode's repeated state work.
  const composingRef = useRef(false);
  const setSeedAndNotify = useCallback(
    (seed: string | null, options?: { replaceDraft?: boolean }) => {
      if (seed !== null && options?.replaceDraft === true) {
        promptDraft.setDraft({
          text: seed,
          mentions: [],
          // A brief replaces the text, not the user's attachments.
          attachments: promptDraft.getCurrent().attachments,
        });
      }
      const willCompose = seed !== null;
      if (composingRef.current !== willCompose) {
        composingRef.current = willCompose;
        onComposingChange?.(willCompose);
      }
      setComposerSeed(seed);
      if (seed !== null) setComposerKey((current) => current + 1);
    },
    [onComposingChange, promptDraft],
  );

  // A repeated nonce is a no-op; each distinct request opens or re-seeds even
  // when the composer is already visible.
  const handledRequestNonce = useRef<number | null>(null);
  useEffect(() => {
    if (composerDisabled) return;
    if (
      openRequest === null ||
      openRequest.nonce === handledRequestNonce.current
    ) {
      return;
    }
    handledRequestNonce.current = openRequest.nonce;
    // This effect is the subscription callback for the external request
    // channel. Applying it during render would update the parent through
    // `onComposingChange` while React is still rendering this child.
    // oxlint-disable-next-line react/set-state-in-effect
    setSeedAndNotify(
      openRequest.close === true
        ? null
        : (openRequest.seed ?? PLUGIN_HERO_COMPOSER.promptPrefix),
      { replaceDraft: !openRequest.close && openRequest.seed !== undefined },
    );
  }, [composerDisabled, openRequest, setSeedAndNotify]);

  return (
    <PluginBrowseHeroCarousel
      initialIndex={initialIndex}
      autoplay={autoplay}
      composerSlot={
        composerSeed === null ? undefined : (
          <PluginNewThreadComposer
            // Remounting per open re-seeds the prompt; the composer treats
            // initialPrompt as a mount-time seed, not a controlled value.
            key={composerKey}
            initialPrompt={composerSeed}
            placeholder={PLUGIN_HERO_COMPOSER.placeholder}
            draftKey={PLUGIN_HERO_COMPOSER.draftKey}
            focusRequest={composerKey}
            onSubmit={async (request) => {
              const thread = await createThread.mutateAsync({
                input: request.input,
                projectId: request.projectId,
                providerId: request.providerId,
                model: request.model,
                reasoningLevel: request.reasoningLevel,
                permissionMode: request.permissionMode,
                ...(request.serviceTier
                  ? { serviceTier: request.serviceTier }
                  : {}),
                executionInputSources: request.executionInputSources,
                environment: request.environment,
              });
              navigate(
                getThreadRoutePath({
                  projectId: thread.projectId ?? request.projectId,
                  threadId: thread.id,
                }),
              );
            }}
          />
        )
      }
    />
  );
}
