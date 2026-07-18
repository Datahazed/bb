const MAX_VISIBLE_DOTS = 3;

/**
 * Compact viewer markers for sidebar thread rows: one initial-dot per remote
 * viewer handle from the presence summary. Purely decorative — the row's own
 * link handles navigation (clicking a dot follows/jumps to the thread).
 */
export function SidebarPresenceDots({
  handles,
}: {
  handles: readonly string[];
}) {
  if (handles.length === 0) {
    return null;
  }
  const visible = handles.slice(0, MAX_VISIBLE_DOTS);
  const overflow = handles.length - visible.length;
  return (
    <span
      data-testid="sidebar-presence-dots"
      aria-label={`Viewing: ${handles.map((handle) => `@${handle}`).join(", ")}`}
      className="pointer-events-none inline-flex shrink-0 items-center -space-x-0.5"
    >
      {visible.map((handle) => (
        <span
          key={handle}
          title={`@${handle}`}
          className="inline-flex size-3.5 select-none items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-[8px] font-medium uppercase leading-none text-sidebar-accent-foreground"
        >
          {handle[0] ?? "?"}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex size-3.5 select-none items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-[8px] font-medium leading-none text-sidebar-accent-foreground">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
