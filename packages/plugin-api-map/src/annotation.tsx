import { cn } from "./cn";

/**
 * The numbered annotation chip. Shared by the skeleton markers and anything
 * that lists surfaces, so the two can never drift apart: same size, same
 * fill, same idle/selected tokens.
 *
 * Idle chips use the prominent ink fill so the affordance reads at a glance;
 * the selected chip switches to the timeline file accent — the same color bb
 * uses for file names in thread timelines — so "selected" borrows an accent
 * the product already owns instead of inventing one.
 */
export function annotationChipClass(active: boolean, className?: string) {
  return cn(
    "flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-2xs leading-none transition-colors",
    active ? "bg-file-accent text-background" : "bg-foreground text-background",
    className,
  );
}

export function ExperimentalBadge() {
  return (
    <span
      className="inline-flex items-center rounded border border-warning/40 bg-warning/10 px-1.5 py-px font-mono text-2xs text-warning-text"
      title="Experimental: audited before stabilizing — see docs/api_to_audit.md in the bb repository."
    >
      experimental
    </span>
  );
}
