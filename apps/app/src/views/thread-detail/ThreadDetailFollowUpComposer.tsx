import { memo, useMemo } from "react";
import {
  usePublishPluginComposerHost,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
  type FollowUpPromptBoxProps,
} from "@/components/promptbox/FollowUpPromptBox";
import type { AttachmentsConfig } from "@/components/promptbox/PromptBoxInternal";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import type { PromptDraftState } from "@/lib/prompt-draft";

/**
 * The reactive half of the thread's bottom composer.
 *
 * `ThreadDetailPromptArea` (~70 hooks) must not re-render per keystroke, so it
 * holds only an imperative `PromptDraftAccessor` and hands the pieces that
 * depend on the live draft — the controlled composer value, the attachment
 * list, and the plugin composer host's `draft` — to this component. It owns the
 * `usePromptDraftStorage` subscription, so a keystroke re-renders it (and the
 * memoized `FollowUpPromptBox` beneath) and nothing above.
 *
 * A pending permission/question is passed straight through as
 * `FollowUpPromptBox`'s `pendingInteraction` (with the reduced `stack`), so
 * the same `FollowUpPromptBox` instance — and its TipTap editor, draft and
 * pickers — stays mounted across every approval instead of being swapped for
 * a different component.
 */

/** Everything a `PluginComposerHost` needs except the reactive `draft`. */
export type PluginComposerHostBinding = Omit<PluginComposerHost, "draft">;

interface UseThreadDetailComposerDraftArgs {
  draftScope: PromptDraftScope;
  hostBinding: PluginComposerHostBinding;
  /**
   * Host of an open inline queued-message editor. While one is open it is the
   * pane's published host (plugin composer hooks act on the edit, not the
   * bottom draft), exactly as before the subscription moved down here.
   */
  inlineEditorHost: PluginComposerHost | null;
}

function useThreadDetailComposerDraft({
  draftScope,
  hostBinding,
  inlineEditorHost,
}: UseThreadDetailComposerDraftArgs): {
  draft: PromptDraftState;
  host: PluginComposerHost;
} {
  const promptDraft = usePromptDraftStorage(draftScope);
  const draft = useMemo<PromptDraftState>(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const host = useMemo<PluginComposerHost>(
    () => ({ ...hostBinding, draft }),
    [draft, hostBinding],
  );
  usePublishPluginComposerHost(inlineEditorHost ?? host);
  return { draft, host };
}

/** The bottom `FollowUpComposerProps` minus the fields derived from the live draft. */
export type ThreadDetailBottomComposerBinding = Omit<
  FollowUpComposerProps,
  "history" | "message" | "mentionRanges" | "onChangeMessage"
> & {
  historyEntries: readonly PromptDraftState[];
  historyResetKey: string;
};

export type ThreadDetailFollowUpComposerProps = Omit<
  FollowUpPromptBoxProps,
  "attachments" | "composer" | "pluginComposerHost" | "pluginComposerScope"
> &
  UseThreadDetailComposerDraftArgs & {
    /** Null hides the composer (archived thread, environment gone) and renders the stack only. */
    composer: ThreadDetailBottomComposerBinding | null;
    attachments: Omit<AttachmentsConfig, "items">;
    /** Writes the composer text (`PromptDraftAccessor.setTextAndMentions`). */
    onChangeMessage: FollowUpComposerProps["onChangeMessage"];
    /** Replaces the whole draft from the history picker (`PromptDraftAccessor.setDraft`). */
    onSelectHistoryEntry: (draft: PromptDraftState) => void;
  };

export const ThreadDetailFollowUpComposer = memo(
  function ThreadDetailFollowUpComposer({
    draftScope,
    hostBinding,
    inlineEditorHost,
    composer,
    attachments,
    onChangeMessage,
    onSelectHistoryEntry,
    ...promptBoxProps
  }: ThreadDetailFollowUpComposerProps) {
    const { draft, host } = useThreadDetailComposerDraft({
      draftScope,
      hostBinding,
      inlineEditorHost,
    });
    const attachmentsConfig = useMemo<AttachmentsConfig>(
      () => ({ ...attachments, items: draft.attachments }),
      [attachments, draft.attachments],
    );
    const composerConfig = useMemo<FollowUpComposerProps | null>(() => {
      if (!composer) {
        return null;
      }
      const { historyEntries, historyResetKey, ...rest } = composer;
      return {
        ...rest,
        history: {
          currentDraft: draft,
          entries: historyEntries,
          onSelectEntry: onSelectHistoryEntry,
          resetKey: historyResetKey,
        },
        message: draft.text,
        mentionRanges: draft.mentions,
        onChangeMessage,
      };
    }, [composer, draft, onChangeMessage, onSelectHistoryEntry]);
    return (
      <FollowUpPromptBox
        {...promptBoxProps}
        attachments={attachmentsConfig}
        composer={composerConfig}
        pluginComposerHost={host}
        pluginComposerScope={host.scope}
      />
    );
  },
);
