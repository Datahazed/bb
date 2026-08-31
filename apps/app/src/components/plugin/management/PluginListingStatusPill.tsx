import type { PluginListingLifecycle } from "@bb/server-contract";
import { Pill } from "@bb/shared-ui/pill";

export function PluginListingStatusPill({
  lifecycle,
  includePublished = false,
}: {
  lifecycle: PluginListingLifecycle;
  includePublished?: boolean;
}) {
  if (lifecycle.status === "published") {
    return includePublished ? (
      <Pill
        variant="outline"
        className="border-transparent bg-success/15 text-success"
      >
        Published
      </Pill>
    ) : null;
  }
  if (lifecycle.status === "in-review") {
    return (
      <Pill
        variant="outline"
        className="border-transparent bg-surface-attention text-warning-text"
      >
        In review
      </Pill>
    );
  }
  return (
    <Pill
      variant="outline"
      className="border-border/40 bg-surface-recessed/45 text-subtle-foreground"
    >
      Not published
    </Pill>
  );
}
