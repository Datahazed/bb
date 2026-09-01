import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  forwardRef,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_VIEW_HEADER_LABEL_CLASS,
} from "./sidebarRowClasses";

const SIDEBAR_ROW_GEOMETRY_CLASS =
  "[--sidebar-row-accessory-margin:var(--sidebar-row-column-gap)] [--sidebar-row-action-gap:0.125rem] [--sidebar-row-body-inset:calc(var(--sidebar-row-depth)*var(--sidebar-row-depth-step))] [--sidebar-row-column-gap:0.5rem] [--sidebar-row-content-inset:0px] [--sidebar-row-depth:0] [--sidebar-row-depth-step:0.75rem] [--sidebar-row-disclosure-rail:1.5rem] [--sidebar-row-identity-inset:0px] [--sidebar-row-identity-justify:flex-end] [--sidebar-row-identity-padding:var(--sidebar-row-identity-inset)] [--sidebar-row-identity-rail:1rem] [--sidebar-row-identity-slot-width:100%] [--sidebar-row-inline-padding:0.5rem] [--sidebar-row-status-rail:0.875rem] max-md:pointer-coarse:[--sidebar-row-identity-rail:1.25rem] max-md:pointer-coarse:[--sidebar-row-status-rail:1.25rem]";

const SIDEBAR_TREE_ROW_GRID_CLASS =
  "!grid [grid-template-areas:'status_body_actions_disclosure'] [grid-template-columns:var(--sidebar-row-status-rail)_minmax(0,1fr)_auto_var(--sidebar-row-disclosure-rail)]";

const SIDEBAR_NAVIGATION_ROW_GRID_CLASS =
  "!grid [--sidebar-row-content-inset:0px] [--sidebar-row-identity-inset:0px] [grid-template-areas:'content_accessory_actions'] [grid-template-columns:minmax(0,1fr)_auto_auto] has-[[data-sidebar-row-slot=identity]]:[--sidebar-row-content-inset:var(--sidebar-row-column-gap)] has-[[data-sidebar-row-slot=identity]]:[grid-template-areas:'identity_content_accessory_actions'] has-[[data-sidebar-row-slot=identity]]:[grid-template-columns:var(--sidebar-row-identity-rail)_minmax(0,1fr)_auto_auto]";

export const sidebarRowVariants = cva(
  cn(
    "w-full min-w-0 items-center !gap-0 rounded-md !pr-0 !pl-[var(--sidebar-row-inline-padding)] transition-colors",
    SIDEBAR_ROW_GEOMETRY_CLASS,
  ),
  {
    variants: {
      anatomy: {
        tree: SIDEBAR_TREE_ROW_GRID_CLASS,
        navigation: SIDEBAR_NAVIGATION_ROW_GRID_CLASS,
      },
      variant: {
        item: "text-sm",
        viewHeader: SIDEBAR_VIEW_HEADER_LABEL_CLASS,
        groupLabel: SIDEBAR_GROUP_LABEL_CLASS,
      },
      density: {
        standard: COARSE_POINTER_ROW_HEIGHT_CLASS,
        compact: COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        label: "h-6 max-md:pointer-coarse:h-9",
      },
    },
    defaultVariants: {
      anatomy: "tree",
      variant: "item",
      density: "standard",
    },
  },
);

export type SidebarRowVariant = NonNullable<
  VariantProps<typeof sidebarRowVariants>["variant"]
>;

export type SidebarRowAnatomy = NonNullable<
  VariantProps<typeof sidebarRowVariants>["anatomy"]
>;

type SidebarRowDepthStyle = CSSProperties & {
  "--sidebar-row-depth": number;
};

interface SidebarRowProps
  extends
    ComponentPropsWithoutRef<"div">,
    VariantProps<typeof sidebarRowVariants> {
  asChild?: boolean;
  depth?: number;
}

export const SidebarRow = forwardRef<HTMLDivElement, SidebarRowProps>(
  function SidebarRow(
    {
      asChild = false,
      anatomy,
      className,
      density,
      depth = 0,
      style,
      variant,
      ...props
    },
    ref,
  ) {
    const Component = asChild ? Slot : "div";
    const rowStyle = {
      ...style,
      "--sidebar-row-depth": depth,
    } satisfies SidebarRowDepthStyle;

    return (
      <Component
        ref={ref}
        data-sidebar-row=""
        data-sidebar-row-anatomy={anatomy ?? "tree"}
        data-sidebar-row-density={density ?? "standard"}
        data-sidebar-row-depth={depth}
        data-sidebar-row-variant={variant ?? "item"}
        className={cn(
          sidebarRowVariants({ anatomy, density, variant }),
          className,
        )}
        style={rowStyle}
        {...props}
      />
    );
  },
);

interface SidebarRowRailProps extends ComponentPropsWithoutRef<"span"> {
  asChild?: boolean;
}

function SidebarRowRail({
  asChild = false,
  className,
  ...props
}: SidebarRowRailProps) {
  const Component = asChild ? Slot : "span";
  return <Component className={className} {...props} />;
}

export function SidebarRowStatusRail({
  className,
  ...props
}: SidebarRowRailProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="status"
      className={cn(
        "[grid-area:status] inline-flex h-full w-[var(--sidebar-row-status-rail)] shrink-0 items-center justify-center",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarRowBody({ className, ...props }: SidebarRowRailProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="body"
      className={cn(
        "[--sidebar-row-accessory-margin:0px] [--sidebar-row-content-inset:0px] [--sidebar-row-identity-justify:center] [--sidebar-row-identity-padding:0px] [--sidebar-row-identity-slot-width:var(--sidebar-row-identity-rail)] [grid-area:body] [grid-template-areas:'identity_content_accessory'] [grid-template-columns:var(--sidebar-row-identity-rail)_minmax(0,1fr)_auto] inline-grid h-full min-w-0 items-center gap-[var(--sidebar-row-column-gap)] pl-[var(--sidebar-row-body-inset)]",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarRowIdentityRail({
  className,
  ...props
}: SidebarRowRailProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="identity"
      className={cn(
        "[grid-area:identity] inline-flex h-full w-[var(--sidebar-row-identity-slot-width)] shrink-0 items-center justify-[var(--sidebar-row-identity-justify)] pl-[var(--sidebar-row-identity-padding)]",
        className,
      )}
      {...props}
    />
  );
}

interface SidebarRowContentProps extends SidebarRowRailProps {
  children: ReactNode;
}

export function SidebarRowContent({
  className,
  ...props
}: SidebarRowContentProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="content"
      className={cn(
        "[grid-area:content] min-w-0 flex-1 pl-[var(--sidebar-row-content-inset)]",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarRowAccessory({
  className,
  ...props
}: SidebarRowRailProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="accessory"
      className={cn(
        "[grid-area:accessory] ml-[var(--sidebar-row-accessory-margin)] min-w-0 shrink",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarRowActions({
  className,
  ...props
}: SidebarRowRailProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="actions"
      className={cn(
        "[grid-area:actions] ml-[var(--sidebar-row-column-gap)] inline-flex shrink-0 items-center gap-[var(--sidebar-row-action-gap)]",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarRowDisclosureRail({
  className,
  ...props
}: SidebarRowRailProps) {
  return (
    <SidebarRowRail
      data-sidebar-row-slot="disclosure"
      className={cn(
        "[grid-area:disclosure] inline-flex h-full w-full shrink-0 items-center justify-center",
        className,
      )}
      {...props}
    />
  );
}
