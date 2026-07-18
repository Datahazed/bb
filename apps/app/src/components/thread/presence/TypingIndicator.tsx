export function typingIndicatorLabel(
  handles: readonly string[],
): string | null {
  if (handles.length === 0) {
    return null;
  }
  if (handles.length === 1) {
    return `@${handles[0]} is typing…`;
  }
  if (handles.length === 2) {
    return `@${handles[0]} and @${handles[1]} are typing…`;
  }
  return `@${handles[0]} and ${handles.length - 1} others are typing…`;
}

/**
 * One-line composer-adjacent typing readout for other collaborators. Renders
 * nothing when no one else is typing.
 */
export function TypingIndicator({ handles }: { handles: readonly string[] }) {
  const label = typingIndicatorLabel(handles);
  if (label === null) {
    return null;
  }
  return (
    <p
      data-testid="thread-typing-indicator"
      aria-live="polite"
      className="px-2 text-xs text-muted-foreground"
    >
      {label}
    </p>
  );
}
