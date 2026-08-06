import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  RESOURCE_MENU_TRIGGER_ENGAGED_CLASS,
  RESOURCE_MENU_TRIGGER_RESTING_CLASS,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";

export default { title: "Control weight" };

/**
 * Resting/hover/focus/engaged/disabled for a toolbar filter key and a bare
 * icon button.
 *
 * The class strings come from shared-ui's own exports, so editing
 * `RESOURCE_MENU_TRIGGER_*` changes this story — an earlier version
 * hand-copied them and documented a recessed track that had already been
 * deleted. Ladle's light/dark switch drives the two default palettes; custom
 * palettes (Nord, Dracula, …) redefine the whole derived token set, so those
 * are checked in the app with `bb theme set` rather than by overriding
 * --canvas/--ink here (derived tokens resolve at :root, so a descendant
 * override would not recompute them).
 */

/** Mirrors ResourceMenuTrigger's own Button props. */
function TriggerKey({
  className,
  disabled,
  engaged = false,
  label,
}: {
  className?: string;
  disabled?: boolean;
  engaged?: boolean;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "size-8 shrink-0 rounded-md p-0 text-muted-foreground",
        RESOURCE_MENU_TRIGGER_RESTING_CLASS,
        engaged && RESOURCE_MENU_TRIGGER_ENGAGED_CLASS,
        className,
      )}
    >
      <Icon name="SlidersHorizontal" className="size-4" aria-hidden />
    </Button>
  );
}

/** A bare icon button: no resting fill, unlike a toolbar key. */
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
      className={cn("size-8 shrink-0 p-0 text-muted-foreground", className)}
    >
      <Icon name="MoreHorizontal" className="size-4" aria-hidden />
    </Button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

function Matrix({ name }: { name: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-medium text-foreground">{name}</h2>

      <Row label="key · default">
        <TriggerKey label="default" />
        <TriggerKey label="sibling" />
      </Row>
      <Row label="key · hover">
        <TriggerKey label="hover" className="bg-state-hover text-foreground" />
        <TriggerKey label="sibling" />
      </Row>
      <Row label="key · focus">
        <TriggerKey label="focus" className="ring-1 ring-ring" />
        <TriggerKey label="sibling" />
      </Row>
      <Row label="key · engaged">
        <TriggerKey label="engaged" engaged />
        <TriggerKey label="sibling" />
      </Row>
      <Row label="key · disabled">
        <TriggerKey label="disabled" disabled />
        <TriggerKey label="sibling" />
      </Row>

      <Row label="icon · default">
        <IconBtn label="icon default" />
      </Row>
      <Row label="icon · hover">
        <IconBtn
          label="icon hover"
          className="bg-state-hover text-foreground"
        />
      </Row>
      <Row label="icon · focus">
        <IconBtn label="icon focus" className="ring-1 ring-ring" />
      </Row>
      <Row label="icon · disabled">
        <IconBtn label="icon disabled" disabled />
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
