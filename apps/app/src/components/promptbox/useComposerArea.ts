import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PermissionMode, PromptTextMention } from "@bb/domain";
import type {
  CreateExecutionInputSources,
  ExistingThreadExecutionInputSources,
} from "@bb/server-contract";
import {
  type AttachmentsConfig,
  type PromptBoxAction,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  type ExecutionControlsProps,
  type ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import { withLoopPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
import {
  useThreadCreationOptions,
  type UseThreadCreationOptionsResult,
} from "@/hooks/useThreadCreationOptions";
import type {
  ScopedExecutionInputSources,
  UseComponentLocalCreationOptions,
  UseNewThreadCreationOptions,
} from "@/hooks/thread-creation-options/selection-state";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import {
  usePromptMentions,
  type UsePromptMentionsOptions,
} from "@/hooks/usePromptMentions";
import {
  usePromptDraftStorage,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { promptDraftToInput, type PromptDraftState } from "@/lib/prompt-draft";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

const noop = () => {};

/**
 * How a prompt-box footer wires its execution controls. Read-only footers (the
 * side chat, which inherits the parent thread's model) render the SAME pickers
 * disabled, so every onChange is a no-op. New-thread compose lets the user
 * switch providers; committed-thread follow-ups keep the provider locked.
 */
export interface ComposerAreaExecutionConfig {
  /** Render execution controls read-only: every onChange becomes a no-op. */
  readOnly?: boolean;
  /**
   * Wire the provider picker's onChange to the live setter. Only the new-thread
   * composer switches providers; follow-ups and side chats leave it locked.
   */
  providerSwitchable?: boolean;
}

/**
 * Permission picker shaping, matching the three existing surfaces exactly:
 * - `editable` — new-thread compose (plain value + setter).
 * - `editable-gated` — follow-up, where the value/options are suppressed until
 *   the thread's resolved execution defaults arrive (`resolved`).
 * - `read-only` — side chat, pinned to a constant with a no-op onChange.
 */
export type ComposerAreaPermissionConfig =
  | { kind: "editable" }
  | { kind: "editable-gated"; resolved: boolean }
  | { kind: "read-only"; value: PermissionMode };

export interface ComposerAreaCommandsConfig {
  projectId: string | undefined;
  /**
   * Provider whose commands are discovered. Pass the committed thread's provider
   * for follow-ups/side chats; omit to follow the live provider picker (the
   * new-thread composer, where the user can switch providers).
   */
  providerId?: string;
  /**
   * Environment that scopes command discovery. Committed threads pass a static
   * id; the new-thread composer derives it from the resolved environment, which
   * is itself produced here — so it may instead be a resolver that receives the
   * live `environmentSelectionValue`.
   */
  environmentId:
    | string
    | null
    | ((environmentSelectionValue: string) => string | null);
}

export interface ComposerAreaAttachmentsConfig {
  projectId: string;
  /**
   * How an upload failure is surfaced. `collect` (default) attempts every file
   * and lists the failed names; `first` stops at the first failure and shows
   * that mutation's error message.
   */
  errorMode?: "collect" | "first";
}

export type ComposerAreaMentionsConfig =
  | UsePromptMentionsOptions
  | ((environmentSelectionValue: string) => UsePromptMentionsOptions);

interface UseComposerAreaBaseOptions {
  draftScope: PromptDraftScope;
  /** Project scope for `@`-mention discovery (`undefined` for projectless). */
  mentionsProjectId: string | undefined;
  mentions: ComposerAreaMentionsConfig;
  commands: ComposerAreaCommandsConfig;
  resolveMentionLink: PromptMentionLinkResolver;
  attachments: ComposerAreaAttachmentsConfig;
  execution: ComposerAreaExecutionConfig;
  permission: ComposerAreaPermissionConfig;
}

export interface UseComposerAreaComponentLocalOptions
  extends UseComposerAreaBaseOptions {
  creationOptions: UseComponentLocalCreationOptions;
}

export interface UseComposerAreaNewThreadOptions
  extends UseComposerAreaBaseOptions {
  creationOptions: UseNewThreadCreationOptions;
}

/**
 * Draft-derived composer values shared by every prompt box. The submit handlers
 * and submit/placeholder state stay per-site (they differ by surface), so this
 * exposes the draft, the change handler, and the parsed input the site needs to
 * build its own composer config.
 */
export interface ComposerAreaComposer {
  message: string;
  mentionRanges: readonly PromptTextMention[];
  onChangeMessage: (value: string, mentionRanges: PromptTextMention[]) => void;
  currentPromptDraft: PromptDraftState;
  currentPromptDraftInput: ReturnType<typeof promptDraftToInput>;
  hasPromptDraftInput: boolean;
}

export interface UseComposerAreaResult<TExecutionInputSources> {
  threadCreationOptions: UseThreadCreationOptionsResult<TExecutionInputSources>;
  promptDraft: ReturnType<typeof usePromptDraftStorage>;
  promptActions: readonly PromptBoxAction[];
  providerPromptActionProps: { promptActions: readonly PromptBoxAction[] };
  executionConfig: ExecutionControlsProps;
  permissionConfig: ExecutionPermissionConfig;
  typeaheadConfig: TypeaheadConfig;
  attachmentsConfig: AttachmentsConfig;
  composer: ComposerAreaComposer;
  attachmentError: string | null;
  setAttachmentError: Dispatch<SetStateAction<string | null>>;
}

/**
 * Assembles the prompt-composer wiring shared by every prompt box: thread
 * creation options, the draft store, `@`-mention + command typeahead, attachment
 * upload, and the provider-owned prompt actions — pre-built into the
 * execution/permission/typeahead/attachments configs the box needs. Surfaces
 * differ on the box itself, the submit handler, and their chrome (project /
 * branch pickers, queued-message stacks); those stay per-site.
 */
export function useComposerArea(
  options: UseComposerAreaComponentLocalOptions,
): UseComposerAreaResult<ExistingThreadExecutionInputSources>;
export function useComposerArea(
  options: UseComposerAreaNewThreadOptions,
): UseComposerAreaResult<CreateExecutionInputSources>;
export function useComposerArea(
  options: UseComposerAreaComponentLocalOptions | UseComposerAreaNewThreadOptions,
): UseComposerAreaResult<ScopedExecutionInputSources> {
  const {
    attachments,
    commands,
    creationOptions,
    draftScope,
    execution,
    mentions,
    mentionsProjectId,
    permission,
    resolveMentionLink,
  } = options;

  const threadCreationOptions = useThreadCreationOptions(
    creationOptions as UseNewThreadCreationOptions,
  );
  const {
    selectedProviderId,
    setSelectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedProviderDisplayName,
    selectedProviderComposerActions,
    selectedModel,
    setSelectedModel,
    serviceTier,
    setServiceTier,
    reasoningLevel,
    setReasoningLevel,
    permissionMode,
    setPermissionMode,
    activeModel,
    modelOptions,
    moreModelOptions,
    isLoadingModels,
    modelLoadFailed,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
  } = threadCreationOptions;

  const promptDraft = usePromptDraftStorage(draftScope);
  const resolvedMentions = useMemo(
    () =>
      typeof mentions === "function"
        ? mentions(threadCreationOptions.environmentSelectionValue)
        : mentions,
    [mentions, threadCreationOptions.environmentSelectionValue],
  );
  const promptMentions = usePromptMentions(
    mentionsProjectId,
    resolvedMentions,
  );
  const uploadPromptAttachment = useUploadPromptAttachment();
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions),
    [selectedProviderComposerActions],
  );
  const promptActions = useMemo(
    () => withLoopPromptAction(providerPromptActions.promptActions),
    [providerPromptActions.promptActions],
  );
  const providerPromptActionProps = useMemo(
    () => ({ promptActions }),
    [promptActions],
  );

  const commandEnvironmentId =
    typeof commands.environmentId === "function"
      ? commands.environmentId(threadCreationOptions.environmentSelectionValue)
      : commands.environmentId;
  const commandSuggestions = useCommandSuggestions({
    projectId: commands.projectId,
    providerId: commands.providerId ?? selectedProviderId,
    skillsTrigger: providerPromptActions.skillsTrigger,
    environmentId: commandEnvironmentId,
    query: commandQuery,
  });

  const currentPromptDraft = useMemo<PromptDraftState>(
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
  const hasPromptDraftInput = currentPromptDraftInput.length > 0;

  const attachmentProjectId = attachments.projectId;
  const attachmentErrorMode = attachments.errorMode ?? "collect";
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      setAttachmentError(null);
      if (attachmentErrorMode === "first") {
        for (const file of files) {
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId: attachmentProjectId,
              file,
            });
            promptDraft.addAttachment(uploaded);
          } catch (error) {
            setAttachmentError(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Attachment upload failed",
              }),
            );
            break;
          }
        }
        return;
      }

      const failedFiles: string[] = [];
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId: attachmentProjectId,
            file,
          });
          promptDraft.addAttachment(uploaded);
        } catch {
          failedFiles.push(file.name);
        }
      }
      if (failedFiles.length > 0) {
        setAttachmentError(`Failed to attach: ${failedFiles.join(", ")}`);
      }
    },
    [
      attachmentErrorMode,
      attachmentProjectId,
      promptDraft,
      uploadPromptAttachment,
    ],
  );

  const attachmentsConfig = useMemo<AttachmentsConfig>(
    () => ({
      items: promptDraft.attachments,
      projectId: attachmentProjectId,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
      onAttachFiles: handleAttachFiles,
      onRemove: promptDraft.removeAttachment,
    }),
    [
      attachmentError,
      attachmentProjectId,
      handleAttachFiles,
      promptDraft.attachments,
      promptDraft.removeAttachment,
      uploadPromptAttachment.isPending,
    ],
  );

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        suggestions: promptMentions.suggestions,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
        resolveLink: resolveMentionLink,
      },
      command: {
        trigger: commandSuggestions.trigger,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: setCommandQuery,
      },
    }),
    [
      commandSuggestions.hasMore,
      commandSuggestions.isError,
      commandSuggestions.isLoading,
      commandSuggestions.isLoadingMore,
      commandSuggestions.loadMore,
      commandSuggestions.suggestions,
      commandSuggestions.trigger,
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      resolveMentionLink,
    ],
  );

  const executionReadOnly = execution.readOnly ?? false;
  const providerSwitchable = execution.providerSwitchable ?? false;
  const executionConfig = useMemo<ExecutionControlsProps>(
    () => ({
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        onChange:
          !executionReadOnly && providerSwitchable
            ? setSelectedProviderId
            : undefined,
        hasMultiple: hasMultipleProviders,
        displayName: selectedProviderDisplayName,
      },
      model: {
        active: activeModel,
        selected: selectedModel,
        options: modelOptions,
        moreOptions: moreModelOptions,
        isLoading: isLoadingModels,
        loadFailed: modelLoadFailed,
        loadError: modelLoadError,
        onChange: executionReadOnly ? noop : setSelectedModel,
      },
      serviceTier: {
        value: serviceTier,
        onChange: executionReadOnly ? noop : setServiceTier,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: reasoningLevel,
        options: reasoningOptions,
        onChange: executionReadOnly ? noop : setReasoningLevel,
      },
    }),
    [
      activeModel,
      executionReadOnly,
      hasMultipleProviders,
      isLoadingModels,
      modelLoadError,
      modelLoadFailed,
      modelOptions,
      moreModelOptions,
      providerOptions,
      providerSwitchable,
      reasoningLevel,
      reasoningOptions,
      selectedModel,
      selectedProviderDisplayName,
      selectedProviderId,
      serviceTier,
      serviceTierSupportByProvider,
      setReasoningLevel,
      setSelectedModel,
      setSelectedProviderId,
      setServiceTier,
      supportsServiceTier,
    ],
  );

  const permissionKind = permission.kind;
  const permissionPinnedValue =
    permission.kind === "read-only" ? permission.value : undefined;
  const permissionResolved =
    permission.kind === "editable-gated" ? permission.resolved : false;
  const permissionConfig = useMemo<ExecutionPermissionConfig>(() => {
    if (permissionKind === "read-only") {
      return {
        value: permissionPinnedValue,
        options: permissionModeOptions,
        onChange: noop,
        supported: supportsPermissionModeSelection,
      };
    }
    if (permissionKind === "editable-gated") {
      return {
        value: permissionResolved ? permissionMode : undefined,
        options: permissionResolved ? permissionModeOptions : [],
        onChange: setPermissionMode,
        supported: permissionResolved && supportsPermissionModeSelection,
      };
    }
    return {
      value: permissionMode,
      options: permissionModeOptions,
      onChange: setPermissionMode,
      supported: supportsPermissionModeSelection,
    };
  }, [
    permissionKind,
    permissionMode,
    permissionModeOptions,
    permissionPinnedValue,
    permissionResolved,
    setPermissionMode,
    supportsPermissionModeSelection,
  ]);

  const composer = useMemo<ComposerAreaComposer>(
    () => ({
      message: promptDraft.text,
      mentionRanges: promptDraft.mentions,
      onChangeMessage: promptDraft.setTextAndMentions,
      currentPromptDraft,
      currentPromptDraftInput,
      hasPromptDraftInput,
    }),
    [
      currentPromptDraft,
      currentPromptDraftInput,
      hasPromptDraftInput,
      promptDraft.mentions,
      promptDraft.setTextAndMentions,
      promptDraft.text,
    ],
  );

  return {
    threadCreationOptions,
    promptDraft,
    promptActions,
    providerPromptActionProps,
    executionConfig,
    permissionConfig,
    typeaheadConfig,
    attachmentsConfig,
    composer,
    attachmentError,
    setAttachmentError,
  };
}
