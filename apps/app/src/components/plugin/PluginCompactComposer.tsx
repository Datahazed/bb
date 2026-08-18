import { useCallback, useMemo } from "react";
import type {
  CompactComposerProps,
  CompactComposerValue,
} from "@get-bb/plugin-sdk";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { useThread } from "@/hooks/queries/thread-queries";
import { usePromptMentions } from "@/hooks/usePromptMentions";

const HOST_PROVIDER_PREFIX = "bb:";

function compactProviderForResource(resource: PromptMentionResource): string {
  switch (resource.kind) {
    case "thread":
    case "project":
    case "section":
      return `${HOST_PROVIDER_PREFIX}${resource.kind}`;
    case "path":
      return `${HOST_PROVIDER_PREFIX}path:${resource.source}:${resource.entryKind}`;
    case "command":
      return `${HOST_PROVIDER_PREFIX}command:${resource.trigger}:${resource.source}:${resource.origin}`;
    case "plugin":
      return `${HOST_PROVIDER_PREFIX}plugin:${encodeURIComponent(resource.pluginId)}`;
  }
}

function compactIdForResource(resource: PromptMentionResource): string {
  switch (resource.kind) {
    case "thread":
      return resource.threadId;
    case "project":
      return resource.projectId;
    case "section":
      return resource.sectionId;
    case "path":
      return resource.path;
    case "command":
      return resource.name;
    case "plugin":
      return resource.itemId;
  }
}

/** Convert the private editor resource into the stable public value. */
export function compactComposerValueFromPrompt(
  text: string,
  mentions: readonly PromptTextMention[],
): CompactComposerValue {
  return {
    text,
    mentions: mentions.map((mention) => ({
      from: mention.start,
      to: mention.end,
      provider: compactProviderForResource(mention.resource),
      id: compactIdForResource(mention.resource),
      label: mention.resource.label,
    })),
  };
}

function parseHostProvider(
  provider: string,
  id: string,
  label: string,
): PromptMentionResource | null {
  if (provider === "bb:thread" || provider === "thread") {
    return { kind: "thread", threadId: id, label };
  }
  if (provider === "bb:project" || provider === "project") {
    return { kind: "project", projectId: id, label };
  }
  if (provider === "bb:section" || provider === "section") {
    return { kind: "section", sectionId: id, label };
  }
  if (provider === "path") {
    return {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: id,
      label,
    };
  }

  const pathMatch =
    /^bb:path:(workspace|thread-storage):(file|directory)$/u.exec(provider);
  if (pathMatch) {
    return {
      kind: "path",
      source: pathMatch[1] as "workspace" | "thread-storage",
      entryKind: pathMatch[2] as "file" | "directory",
      path: id,
      label,
    };
  }

  const commandMatch =
    /^bb:command:(\/):(skill|command):(builtin|project|user)$/u.exec(provider);
  if (commandMatch) {
    return {
      kind: "command",
      trigger: "/",
      name: id,
      source: commandMatch[2] as "skill" | "command",
      origin: commandMatch[3] as "builtin" | "project" | "user",
      label,
      argumentHint: null,
    };
  }

  const pluginPrefix = "bb:plugin:";
  if (provider.startsWith(pluginPrefix)) {
    try {
      return {
        kind: "plugin",
        pluginId: decodeURIComponent(provider.slice(pluginPrefix.length)),
        itemId: id,
        label,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/** Rehydrate only host-issued provider tokens; invalid ranges remain plain text. */
export function promptMentionsFromCompactComposerValue(
  value: CompactComposerValue,
): PromptTextMention[] {
  return value.mentions.flatMap((mention) => {
    if (
      !Number.isInteger(mention.from) ||
      !Number.isInteger(mention.to) ||
      mention.from < 0 ||
      mention.to <= mention.from ||
      mention.to > value.text.length
    ) {
      return [];
    }
    const resource = parseHostProvider(
      mention.provider,
      mention.id,
      mention.label,
    );
    return resource === null
      ? []
      : [{ start: mention.from, end: mention.to, resource }];
  });
}

/**
 * Host adapter for the public controlled compact composer. The plugin owns the
 * value and mutation; BB owns the real editor, @ menu, focus, and keyboard.
 */
export function PluginCompactComposer({
  threadId,
  value,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting = false,
  disabled = false,
  validationMessage,
  placeholder = "Write a comment. @ to mention files, folders, or threads",
  autoFocus = false,
  focusRequest,
  accessibleLabel,
  submitLabel = "Submit",
  className,
}: CompactComposerProps) {
  const threadQuery = useThread(threadId, { enabled: threadId.length > 0 });
  const thread = threadQuery.data;
  const promptMentions = usePromptMentions(thread?.projectId, {
    currentThreadId: threadId,
    threadStorageThreadId: threadId,
    environmentId: thread?.environmentId ?? null,
  });
  const mentionRanges = useMemo(
    () => promptMentionsFromCompactComposerValue(value),
    [value],
  );
  const typeahead = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: promptMentions.triggers,
        suggestions: promptMentions.suggestions,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
      },
      command: INERT_TYPEAHEAD_COMMAND_CONFIG,
    }),
    [promptMentions],
  );
  const handleChange = useCallback(
    (text: string, mentions: PromptTextMention[]) => {
      onChange(compactComposerValueFromPrompt(text, mentions));
    },
    [onChange],
  );
  const handleSubmit = useCallback(() => {
    void onSubmit(value);
  }, [onSubmit, value]);

  return (
    <div className={cn("w-full", className)}>
      <PromptBoxInternal
        value={value.text}
        mentionRanges={mentionRanges}
        onChange={handleChange}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        placeholder={placeholder}
        accessibleLabel={accessibleLabel}
        autoFocus={autoFocus}
        focusEndKey={focusRequest}
        minHeight={44}
        mentionMenuPlacement="top"
        typeahead={typeahead}
        submission={{
          isSubmitting,
          disabled,
          title: submitLabel,
        }}
        compact={{ isCompact: false, placeholder }}
        suppressPluginComposerCustomizations
        className="rounded-lg shadow-none"
      />
      {validationMessage ? (
        <p role="alert" className="mt-1 px-1 text-xs text-destructive">
          {validationMessage}
        </p>
      ) : null}
    </div>
  );
}
