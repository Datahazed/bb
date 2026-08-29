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
  initialIndex?: number;
  autoplay?: boolean;
  composerDisabled?: boolean;
  openRequest?: {
    nonce: number;
    seed?: string;
    close?: boolean;
  } | null;
  onComposingChange?: (composing: boolean) => void;
}

export function BrowseHeroCarousel({
  initialIndex = 0,
  autoplay = true,
  composerDisabled = false,
  openRequest = null,
  onComposingChange,
}: BrowseHeroCarouselProps) {
  const navigate = useNavigate();
  const createThread = useCreateThread();
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

  const composingRef = useRef(false);
  const setSeedAndNotify = useCallback(
    (seed: string | null, options?: { replaceDraft?: boolean }) => {
      if (seed !== null && options?.replaceDraft === true) {
        promptDraft.setDraft({
          text: seed,
          mentions: [],
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
