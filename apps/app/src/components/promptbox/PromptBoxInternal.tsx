import { lazy, Suspense } from "react";
import type { PromptBoxInternalProps } from "./PromptBoxInternalImpl";

const LazyPromptBoxInternal = lazy(() =>
  import("./PromptBoxInternalImpl").then((module) => ({
    default: module.PromptBoxInternal,
  })),
);

function PromptBoxFallback({
  className,
  compact,
  header,
  minHeight = 68,
  placeholder = "Ask anything. @ to mention files, folders, or sections",
}: PromptBoxInternalProps) {
  const isCompact = compact?.isCompact === true;
  return (
    <div
      data-promptbox=""
      data-promptbox-loading=""
      aria-busy="true"
      className={`relative w-full rounded-xl border border-border bg-background shadow-lift ${className ?? ""}`}
    >
      {header && !isCompact ? (
        <div className="pl-4 pr-14 pt-3">{header}</div>
      ) : null}
      <div
        className="px-4 pb-1 pr-14 pt-3 text-base font-light leading-relaxed text-subtle-foreground opacity-70"
        style={{ minHeight: isCompact ? 48 : minHeight }}
      >
        {placeholder}
      </div>
    </div>
  );
}

export function PromptBoxInternal(props: PromptBoxInternalProps) {
  return (
    <Suspense fallback={<PromptBoxFallback {...props} />}>
      <LazyPromptBoxInternal {...props} />
    </Suspense>
  );
}

export {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  suppressPromptEditorAnchorActivation,
} from "./prompt-box-runtime";
export type {
  AttachmentsConfig,
  HistoryConfig,
  MentionMenuPlacement,
  PromptBoxCompactConfig,
  PromptBoxHandle,
  PromptBoxInternalProps,
  PromptBoxSubmissionConfig,
  PromptBoxZenModeConfig,
  PromptVoiceConfig,
  PromptVoiceState,
  TypeaheadCommandConfig,
  TypeaheadConfig,
  TypeaheadMentionConfig,
} from "./PromptBoxInternalImpl";
export type { PromptBoxAction } from "./PromptBoxActionsMenu";
