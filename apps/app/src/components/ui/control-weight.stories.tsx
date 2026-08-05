import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { CONTEXT_SELECTION_SURFACE_CLASS } from "./context-selection";

export default { title: "Control weight" };

/**
 * Resting/hover/focus/engaged/disabled for the two control families the
 * toolbar rework touches. Ladle's own light/dark switch drives the two
 * default palettes; custom palettes (Nord, Dracula, …) redefine the whole
 * derived token set, so those are verified in the app with `bb theme set`,
 * not by overriding --canvas/--ink on a wrapper here (derived tokens resolve
 * at :root, so a descendant override would not recompute them).
 */

// The app's one selection surface, shared with sidebar rows and tab pills.
const ENGAGED = `${CONTEXT_SELECTION_SURFACE_CLASS} text-foreground`;

function IconBtn({
  className,
  disabled,
  label,
}: {
  className?: string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled}
      className={`size-8 shrink-0 bg-background p-0 text-muted-foreground ${className ?? ""}`}
    >
      <Icon name="PackageReceive" className="size-4" aria-hidden />
    </Button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/** The toolbar's recessed track, so engaged reads in its real context. */
function Track({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-surface-recessed p-0.5 [&>button]:size-7 [&>button]:rounded-sm">
      {children}
    </div>
  );
}

function Matrix({ name }: { name: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-medium text-foreground">{name}</h2>

      <Row label="icon · default">
        <IconBtn label="default" className="bg-transparent" />
      </Row>
      <Row label="icon · hover">
        <IconBtn label="hover" className="bg-state-hover text-foreground" />
      </Row>
      <Row label="icon · focus">
        <IconBtn label="focus" className="bg-transparent ring-1 ring-ring" />
      </Row>
      <Row label="icon · disabled">
        <IconBtn label="disabled" className="bg-transparent" disabled />
      </Row>

      <Row label="filter · default">
        <Track>
          <IconBtn label="filter default" />
          <IconBtn label="filter sibling" />
        </Track>
      </Row>
      <Row label="filter · hover">
        <Track>
          <IconBtn
            label="filter hover"
            className="bg-state-hover text-foreground"
          />
          <IconBtn label="filter sibling" />
        </Track>
      </Row>
      <Row label="filter · focus">
        <Track>
          <IconBtn label="filter focus" className="ring-1 ring-ring" />
          <IconBtn label="filter sibling" />
        </Track>
      </Row>
      <Row label="filter · engaged">
        <Track>
          <IconBtn label="filter engaged" className={ENGAGED} />
          <IconBtn label="filter sibling" />
        </Track>
      </Row>
      <Row label="filter · disabled">
        <Track>
          <IconBtn label="filter disabled" disabled />
          <IconBtn label="filter sibling" />
        </Track>
      </Row>
    </section>
  );
}

export function ControlWeightStates() {
  return (
    <div className="flex flex-wrap gap-4 p-6">
      <div className="bb-theme-light">
        <Matrix name="Light (default)" />
      </div>
      <div className="dark bb-theme-dark">
        <Matrix name="Dark (default)" />
      </div>
    </div>
  );
}
