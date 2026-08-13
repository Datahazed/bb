import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import {
  useThreadTerminalController,
  type ThreadTerminalTarget,
} from "./useThreadTerminalController";
import type { TerminalFixedPanelTarget } from "@/lib/fixed-panel-tabs-state";

interface ThreadTerminalPanelProps {
  autoFocus?: boolean;
  canCreateTerminal: boolean;
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
  fixedPanelTarget?: TerminalFixedPanelTarget;
  fixedTerminalId?: string;
  onAutoFocusHandled?: () => void;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
  panelStateId?: string;
  target: ThreadTerminalTarget;
}

export function ThreadTerminalPanel({
  autoFocus = false,
  canCreateTerminal,
  isPanelOpen,
  isPanelPersistedOpen,
  fixedPanelTarget,
  fixedTerminalId,
  onAutoFocusHandled,
  onOpenLink,
  onSelectionAddToChat,
  panelStateId,
  target,
}: ThreadTerminalPanelProps) {
  const terminalController = useThreadTerminalController({
    canCreateTerminal,
    isPanelOpen,
    isPanelPersistedOpen,
    fixedPanelTarget,
    fixedTerminalId,
    panelStateId,
    target,
  });

  return (
    <section
      aria-label="Terminal"
      data-app-terminal=""
      className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar"
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-sidebar">
        <ThreadTerminalContent
          autoFocus={autoFocus}
          controller={terminalController}
          onAutoFocusHandled={onAutoFocusHandled}
          onOpenLink={onOpenLink}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      </div>
    </section>
  );
}
