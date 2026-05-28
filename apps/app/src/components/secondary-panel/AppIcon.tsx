import type { AppIcon as ThreadAppIcon } from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

export interface ResolvedAppIconProps {
  icon: ThreadAppIcon;
  className?: string;
}

export function ResolvedAppIcon({ icon, className }: ResolvedAppIconProps) {
  if (icon.kind === "logo") {
    return (
      <img
        src={icon.url}
        alt=""
        className={cn("size-4 shrink-0 rounded-sm object-contain", className)}
      />
    );
  }

  return (
    <Icon
      name={icon.name}
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
      aria-hidden
    />
  );
}
