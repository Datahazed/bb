import { Pill } from "@bb/shared-ui/pill";
import { ThreadTerminalView } from "@/components/thread/terminal/ThreadTerminalView";
import { useTerminals } from "@/hooks/queries/thread-terminal-queries";
import type { TerminalPaneTarget } from "@/lib/split-layout";

function TerminalPlaceholder({ children }: { children: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function terminalTargetLabel(target: TerminalPaneTarget): string {
  switch (target.kind) {
    case "thread":
      return `Thread ${target.threadId.slice(0, 8)}`;
    case "environment":
      return target.environmentId;
    case "host_path":
      return target.cwd;
  }
}

export function TerminalPaneContent({
  terminalId,
  target,
}: {
  terminalId: string;
  target?: TerminalPaneTarget;
}) {
  const terminalsQuery = useTerminals(target, {
    enabled: target !== undefined,
  });

  if (target === undefined) {
    return (
      <TerminalPlaceholder>
        Terminal unavailable on this surface
      </TerminalPlaceholder>
    );
  }

  if (
    terminalsQuery.data === undefined &&
    (terminalsQuery.isLoading || terminalsQuery.isFetching)
  ) {
    return null;
  }

  const session = terminalsQuery.data?.sessions.find(
    (candidate) => candidate.id === terminalId,
  );
  if (session === undefined || session.status === "exited") {
    return <TerminalPlaceholder>Terminal ended</TerminalPlaceholder>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-7 shrink-0 items-center border-b border-border-seam-vertical/60 bg-surface-recessed px-2">
        <Pill variant="outline" size="sm">
          <span className="max-w-80 truncate">
            {terminalTargetLabel(target)}
          </span>
        </Pill>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ThreadTerminalView isPanelOpen session={session} />
      </div>
    </div>
  );
}
