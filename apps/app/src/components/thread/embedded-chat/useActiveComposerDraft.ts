import { useCallback, useMemo } from "react";
import type { PromptTextMention } from "@bb/domain";
import {
  usePromptDraftStorage,
  type PromptDraftAccessor,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { promptDraftToInput } from "@/lib/prompt-draft";
import type { PromptDraftState } from "@/lib/prompt-draft";
import type { PromptInput } from "@bb/domain";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";

interface UseActiveComposerDraftArgs {
  draftScope: PromptDraftScope;
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (
    next: InlineQueuedMessageEditState | null,
  ) => void;
}

export interface UseActiveComposerDraftResult {
  promptDraft: ReturnType<typeof usePromptDraftStorage>;
  /** The persisted bottom-composer draft, independent of any inline edit. */
  currentPromptDraft: PromptDraftState;
  currentPromptDraftInput: PromptInput[];
  /** The inline edit draft when present, otherwise the bottom draft. */
  activeComposerDraft: PromptDraftState;
  activeComposerDraftInput: PromptInput[];
  setActiveComposerDraft: (draft: PromptDraftState) => void;
  handleChangeMessage: (text: string, mentions: PromptTextMention[]) => void;
  removeActiveComposerAttachment: (path: string) => void;
}

interface UseActiveComposerDraftWritersArgs {
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (
    next: InlineQueuedMessageEditState | null,
  ) => void;
  storedDraft: Pick<
    PromptDraftAccessor,
    "setDraft" | "setTextAndMentions" | "removeAttachment"
  >;
}

export interface ActiveComposerDraftWriters {
  setActiveComposerDraft: (draft: PromptDraftState) => void;
  handleChangeMessage: (text: string, mentions: PromptTextMention[]) => void;
  removeActiveComposerAttachment: (path: string) => void;
}

/**
 * Writers for "whichever draft is active": the inline queued-message edit
 * while one is open, otherwise the stored bottom draft. Reads the inline edit
 * through its ref so back-to-back plugin composer actions in one event observe
 * each other's updates. Needs no draft subscription, so a caller that must not
 * re-render per keystroke can use it with `usePromptDraftAccessor`.
 */
export function useActiveComposerDraftWriters({
  inlineEditingQueuedMessageRef,
  commitInlineQueuedMessage,
  storedDraft,
}: UseActiveComposerDraftWritersArgs): ActiveComposerDraftWriters {
  const setStoredPromptDraft = storedDraft.setDraft;
  const setStoredPromptTextAndMentions = storedDraft.setTextAndMentions;
  const removeStoredPromptAttachment = storedDraft.removeAttachment;

  const setActiveComposerDraft = useCallback(
    (draft: PromptDraftState) => {
      const current = inlineEditingQueuedMessageRef.current;
      if (current) {
        commitInlineQueuedMessage({ ...current, draft });
        return;
      }
      setStoredPromptDraft(draft);
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      setStoredPromptDraft,
    ],
  );
  const handleChangeMessage = useCallback(
    (text: string, mentions: PromptTextMention[]) => {
      const current = inlineEditingQueuedMessageRef.current;
      if (current) {
        commitInlineQueuedMessage({
          ...current,
          draft: { ...current.draft, mentions, text },
        });
        return;
      }
      setStoredPromptTextAndMentions(text, mentions);
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      setStoredPromptTextAndMentions,
    ],
  );
  const removeActiveComposerAttachment = useCallback(
    (path: string) => {
      const current = inlineEditingQueuedMessageRef.current;
      if (current) {
        commitInlineQueuedMessage({
          ...current,
          draft: {
            ...current.draft,
            attachments: current.draft.attachments.filter(
              (attachment) => attachment.path !== path,
            ),
          },
        });
        return;
      }
      removeStoredPromptAttachment(path);
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      removeStoredPromptAttachment,
    ],
  );

  return {
    setActiveComposerDraft,
    handleChangeMessage,
    removeActiveComposerAttachment,
  };
}

/**
 * Exposes the persisted bottom draft plus an active draft view for the inline
 * queued-message editor and the currently published plugin host. Active writes
 * route through the inline-edit ref so back-to-back plugin composer actions in
 * one event observe each other's updates.
 */
export function useActiveComposerDraft({
  draftScope,
  inlineEditingQueuedMessage,
  inlineEditingQueuedMessageRef,
  commitInlineQueuedMessage,
}: UseActiveComposerDraftArgs): UseActiveComposerDraftResult {
  const promptDraft = usePromptDraftStorage(draftScope);

  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const currentPromptDraftInput = useMemo(
    () => promptDraftToInput(currentPromptDraft),
    [currentPromptDraft],
  );
  const activeComposerDraft =
    inlineEditingQueuedMessage?.draft ?? currentPromptDraft;
  const activeComposerDraftInput = useMemo(
    () => promptDraftToInput(activeComposerDraft),
    [activeComposerDraft],
  );
  const {
    setActiveComposerDraft,
    handleChangeMessage,
    removeActiveComposerAttachment,
  } = useActiveComposerDraftWriters({
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    storedDraft: promptDraft,
  });

  return {
    promptDraft,
    currentPromptDraft,
    currentPromptDraftInput,
    activeComposerDraft,
    activeComposerDraftInput,
    setActiveComposerDraft,
    handleChangeMessage,
    removeActiveComposerAttachment,
  };
}
