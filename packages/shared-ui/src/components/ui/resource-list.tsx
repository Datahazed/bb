import type { ComponentProps, ReactNode } from "react";
import { CHROME_SECTION_LABEL_CLASS } from "./chrome-style-tokens";
import { Button, type ButtonProps } from "./button";
import { EmptyStatePanel } from "./empty-state";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Icon, type IconName } from "./icon";
import { Input } from "./input";
import { Skeleton } from "./skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "../../lib/utils";

export type ResourceStatusTone = "success" | "warning" | "error" | "muted";

function targetsResourceAction(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, [data-row-action]") !== null
  );
}

export function ResourceState({
  tone,
  showLabel = true,
  children,
}: {
  tone: ResourceStatusTone;
  showLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "error" && "bg-destructive",
          tone === "muted" && "bg-muted-foreground/50",
        )}
      />
      {showLabel ? <span className="truncate">{children}</span> : null}
    </span>
  );
}

export const ResourceStatus = ResourceState;

export function ResourceMeta({
  items,
}: {
  items: readonly (ReactNode | null | undefined | false)[];
}) {
  const visibleItems = items.filter(Boolean);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {visibleItems.map((item, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-subtle-foreground">
              ·
            </span>
          ) : null}
          <span className="min-w-0 truncate">{item}</span>
        </span>
      ))}
    </span>
  );
}

export function ResourceCardStat({
  icon,
  iconClassName,
  accessibleLabel,
  children,
}: {
  icon: IconName;
  iconClassName?: string;
  accessibleLabel?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={accessibleLabel}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-surface-recessed-soft-solid px-1.5 py-1 text-muted-foreground"
    >
      <Icon
        name={icon}
        className={cn("size-3 shrink-0", iconClassName)}
        aria-hidden
      />
      <span>{children}</span>
    </span>
  );
}

export function ResourceToolbar({
  searchValue,
  searchPlaceholder,
  searchLabel,
  onSearchChange,
  controls,
  controlsClassName,
  action,
}: {
  searchValue: string;
  searchPlaceholder: string;
  searchLabel?: string;
  onSearchChange: (value: string) => void;
  controls?: ReactNode;
  controlsClassName?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel ?? searchPlaceholder}
          className="h-8 pl-8"
        />
      </div>
      {controls ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            controlsClassName,
          )}
        >
          {controls}
        </div>
      ) : null}
      {action}
    </div>
  );
}

export function ResourceTabDescription({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-2xl px-1 text-sm leading-5 text-muted-foreground">
      {children}
    </p>
  );
}

export interface ResourceOption {
  id: string;
  label: string;
  disabled?: boolean;
}

function ResourceMenuTrigger({
  label,
  icon,
  active = false,
}: {
  label: string;
  icon: IconName;
  active?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-8 shrink-0 p-0 text-muted-foreground",
                active && "bg-state-active text-foreground",
              )}
              aria-label={label}
            >
              <Icon name={icon} className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ResourceOptionMenu({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: IconName;
  value: string;
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <ResourceMenuTrigger label={label} icon={icon} />
      <DropdownMenuContent align="end" mobileTitle={label} className="min-w-40">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
          {label}
        </DropdownMenuLabel>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <DropdownMenuItem
              key={option.id}
              disabled={option.disabled}
              onSelect={(event) => {
                if (selected || option.disabled) {
                  event.preventDefault();
                  return;
                }
                onChange(option.id);
              }}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate text-xs">{option.label}</span>
              <Icon
                name="Check"
                aria-hidden
                className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceMultiSelectMenu({
  label,
  icon,
  selectedValues,
  options,
  onChange,
}: {
  label: string;
  icon: IconName;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
}) {
  const selected = new Set(selectedValues);
  const activeSelectedCount = options.filter(
    (option) => !option.disabled && selected.has(option.id),
  ).length;
  const triggerLabel =
    activeSelectedCount === 0
      ? label
      : `${label}: ${activeSelectedCount} selected`;

  function updateValue(option: ResourceOption, checked: boolean) {
    if (option.disabled) return;
    const next = new Set(selectedValues);
    if (checked) {
      next.add(option.id);
    } else {
      next.delete(option.id);
    }
    const enabledOptionIds = new Set(
      options.filter((candidate) => !candidate.disabled).map(({ id }) => id),
    );
    onChange([...next].filter((id) => enabledOptionIds.has(id)));
  }

  return (
    <DropdownMenu>
      <ResourceMenuTrigger
        label={triggerLabel}
        icon={icon}
        active={activeSelectedCount > 0}
      />
      <DropdownMenuContent align="end" mobileTitle={label} className="min-w-44">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
          {triggerLabel}
        </DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selected.has(option.id)}
            disabled={option.disabled}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => updateValue(option, checked === true)}
          >
            <span className="truncate text-xs">{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceSortMenu({
  value,
  direction,
  options,
  onChange,
}: {
  value: string;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <ResourceMenuTrigger label="Sort" icon="ArrowUpDown" />
      <DropdownMenuContent align="end" mobileTitle="Sort" className="min-w-40">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
          Sort by
        </DropdownMenuLabel>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <DropdownMenuItem
              key={option.id}
              disabled={option.disabled}
              onSelect={(event) => {
                event.preventDefault();
                if (option.disabled) return;
                onChange(option.id);
              }}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate text-xs">{option.label}</span>
              <Icon
                name={direction === "asc" ? "ArrowUp" : "ArrowDown"}
                aria-hidden
                className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceToolbarAction({
  label,
  icon = "Plus",
  disabled = false,
  onClick,
}: {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      className="shrink-0"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

export interface ResourceCreateTemplate {
  label: string;
  description: string;
  prompt: string;
}

export function ResourceCreateButton({
  label,
  templates,
  templateMenuLabel = "Start from an example",
  onCreate,
}: {
  label: string;
  templates: readonly ResourceCreateTemplate[];
  templateMenuLabel?: string;
  onCreate: (prompt?: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <Button
        type="button"
        size="sm"
        className="rounded-r-none"
        onClick={() => onCreate()}
      >
        <Icon name="Plus" className="size-4" aria-hidden />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-label={`${label} from a template`}
            className="rounded-l-none px-1.5"
          >
            <Icon name="ChevronDown" className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72"
          mobileTitle={templateMenuLabel}
        >
          <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
            {templateMenuLabel}
          </DropdownMenuLabel>
          {templates.map((template) => (
            <DropdownMenuItem
              key={template.label}
              onSelect={() => onCreate(template.prompt)}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-foreground">
                  {template.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {template.description}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type ResourceOverflowMenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: IconName;
      tone?: "default" | "destructive";
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator" };

export function ResourceOverflowMenu({
  label,
  disabled = false,
  items,
}: {
  label: string;
  disabled?: boolean;
  items: readonly ResourceOverflowMenuItem[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 p-0 text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={disabled}
        >
          <Icon name="MoreHorizontal" className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-max min-w-32 max-w-64"
        mobileTitle={label}
      >
        {items.map((item, index) =>
          item.kind === "separator" ? (
            <DropdownMenuSeparator key={`separator-${index}`} />
          ) : (
            <DropdownMenuItem
              key={item.label}
              variant={item.tone === "destructive" ? "destructive" : "default"}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {item.icon ? (
                <Icon
                  name={item.icon}
                  className="size-4 shrink-0"
                  aria-hidden
                />
              ) : null}
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceActionButton({
  label,
  tooltipLabel,
  tooltipSide,
  icon,
  tone = "muted",
  disabled = false,
  disabledReason,
  className,
  onClick,
}: {
  label: string;
  tooltipLabel?: string;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
  icon: IconName;
  tone?: "muted" | "destructive";
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 p-0 text-muted-foreground hover:text-foreground",
              tone === "destructive" && "hover:text-destructive",
              disabled &&
                disabledReason !== undefined &&
                "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
              className,
            )}
            aria-label={label}
            aria-disabled={disabled || undefined}
            disabled={disabled && disabledReason === undefined}
            onClick={(event) => {
              if (disabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              onClick();
            }}
          >
            <Icon name={icon} className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {disabled && disabledReason
            ? disabledReason
            : (tooltipLabel ?? label)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ResourceRow({
  leading,
  title,
  description,
  status,
  state,
  selected = false,
  muted = false,
  actions,
  actionsVisibility = "hover",
  className,
  onOpen,
}: {
  leading: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  state?: ReactNode;
  selected?: boolean;
  muted?: boolean;
  actions?: ReactNode;
  actionsVisibility?: "hover" | "always";
  className?: string;
  onOpen: () => void;
}) {
  const rowState = state ?? status;
  return (
    <div
      className={cn(
        "group grid min-w-0 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-transparent px-3 py-2 text-left transition-colors hover:bg-state-hover focus-within:bg-state-hover",
        selected && "bg-state-active",
        muted && "opacity-60",
        className,
      )}
      onClick={(event) => {
        if (targetsResourceAction(event.target)) return;
        onOpen();
      }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {leading}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {rowState}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs text-subtle-foreground">
            {description}
          </span>
        ) : null}
      </button>
      {actions ? (
        <span
          data-row-action
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity",
            actionsVisibility === "hover" &&
              "opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
}

export function ResourceListPanel({
  children,
  maxHeightClassName = "max-h-[min(44rem,calc(100dvh-21rem))]",
  className,
}: {
  children: ReactNode;
  maxHeightClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-sm",
        className,
      )}
    >
      <div className={cn("overflow-y-auto pr-1", maxHeightClassName)}>
        <div className="cursor-default space-y-0.5">{children}</div>
      </div>
    </div>
  );
}

export function ResourceListState({
  state,
  message,
  onRetry,
  loadingRows = 4,
}: {
  state: "loading" | "empty" | "error";
  message: string;
  onRetry?: () => void;
  loadingRows?: number;
}) {
  if (state === "loading") {
    return (
      <ResourceListPanel>
        <span role="status" className="sr-only">
          {message}
        </span>
        <div aria-hidden="true">
          {Array.from({ length: loadingRows }, (_, index) => (
            <div
              key={index}
              className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-3 px-3 py-2"
            >
              <Skeleton className="size-4 rounded-sm" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </ResourceListPanel>
    );
  }

  return (
    <EmptyStatePanel
      role={state === "error" ? "alert" : "status"}
      className="py-6"
    >
      <div className="flex flex-col items-center gap-2">
        <span>{message}</span>
        {state === "error" && onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </EmptyStatePanel>
  );
}

export function ResourcePropertyList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-popover shadow-sm">
      {children}
    </div>
  );
}

export function ResourceDetailSection({
  label,
  actions,
  children,
}: {
  label: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase text-muted-foreground">
          {label}
        </h2>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function ResourceProperty({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words text-foreground">{children}</div>
    </div>
  );
}

export function ResourceSection({
  label,
  count,
  leading,
  collapsed,
  onToggle,
  children,
}: {
  label: ReactNode;
  count: number;
  leading?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 bg-surface-recessed px-3 py-1.5 text-xs text-muted-foreground hover:bg-state-hover"
      >
        <Icon
          name="ChevronRight"
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
            !collapsed && "rotate-90",
          )}
          aria-hidden
        />
        {leading}
        <span className="font-medium">{label}</span>
        <span className="text-subtle-foreground">{count}</span>
      </button>
      {collapsed ? null : <div className="p-1">{children}</div>}
    </section>
  );
}

export function ResourceSectionTitle({
  className,
  ...props
}: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        CHROME_SECTION_LABEL_CLASS,
        className,
      )}
      {...props}
    />
  );
}

export function ResourceSourceShelf({
  label,
  attribution,
  leading,
  browseAction,
  scrollOverlay,
  children,
}: {
  label: ReactNode;
  attribution?: ReactNode;
  leading?: ReactNode;
  browseAction?: ReactNode;
  scrollOverlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="w-full max-w-full space-y-[var(--resource-source-shelf-section-gap)] rounded-lg bg-surface-recessed/70 p-[var(--resource-source-shelf-inset)] text-popover-foreground">
      <div className="flex min-w-0 items-center gap-[var(--resource-source-shelf-label-gap)] text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-[var(--resource-source-shelf-label-gap)]">
          {leading}
          <ResourceSectionTitle className="truncate">
            {label}
          </ResourceSectionTitle>
          {attribution !== undefined &&
          attribution !== null &&
          attribution !== false ? (
            <span className="truncate text-subtle-foreground">
              {attribution}
            </span>
          ) : null}
        </div>
        {browseAction ? (
          <div className="ml-auto shrink-0 text-xs text-muted-foreground">
            {browseAction}
          </div>
        ) : null}
      </div>
      <div className="relative">
        <div className="-ml-[var(--resource-source-shelf-shadow-left-bleed)] -my-[var(--resource-source-shelf-shadow-bleed)] overflow-x-auto pl-[var(--resource-source-shelf-shadow-left-bleed)] py-[var(--resource-source-shelf-shadow-bleed)]">
          <div className="flex w-full snap-x snap-mandatory gap-[var(--resource-source-shelf-item-gap)]">
            {children}
          </div>
        </div>
        {scrollOverlay ? (
          <div className="pointer-events-none absolute inset-x-0 top-[var(--resource-source-shelf-shadow-bleed)] bottom-[var(--resource-source-shelf-shadow-bleed)]">
            {scrollOverlay}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ResourceShelfAction({
  className,
  ...props
}: Omit<ButtonProps, "size" | "variant">) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto shrink-0 rounded-md px-[var(--resource-source-shelf-action-inline)] py-[var(--resource-source-shelf-action-block)] text-xs font-normal text-muted-foreground hover:bg-state-hover hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ResourceShelfSeeAllAction({
  className,
  ...props
}: Omit<ButtonProps, "children" | "size" | "variant">) {
  return (
    <ResourceShelfAction className={className} {...props}>
      See all
    </ResourceShelfAction>
  );
}

export function ResourceSourceItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[22rem] shrink-0 snap-start md:w-[var(--resource-source-shelf-item-width)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

type ResourceBrowseCardProps = {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  byline?: ReactNode;
  headerAction?: ReactNode;
  footerMeta?: ReactNode;
} & (
  | { openLabel: string; onOpen: () => void }
  | { openLabel?: undefined; onOpen?: undefined }
);

export function ResourceBrowseCard({
  leading,
  title,
  description,
  byline,
  headerAction,
  footerMeta,
  openLabel,
  onOpen,
}: ResourceBrowseCardProps) {
  const hasLeading =
    leading !== undefined && leading !== null && leading !== false;
  return (
    <div
      className={cn(
        "group relative flex h-full min-h-32 w-full flex-col rounded-md border border-border bg-background p-[var(--resource-source-shelf-inset)] text-left shadow-xs",
        onOpen &&
          "transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--resource-source-shelf-card-hover-border)] hover:shadow-[var(--resource-source-shelf-card-hover-shadow)]",
      )}
    >
      {onOpen ? (
        <button
          type="button"
          aria-label={openLabel}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-none relative grid min-w-0 gap-x-2 gap-y-2",
          hasLeading
            ? "grid-cols-[2.25rem_minmax(0,1fr)_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        {hasLeading ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-recessed">
            {leading}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {byline ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {byline}
            </span>
          ) : null}
        </span>
        {headerAction ? (
          <span
            onClick={(event) => {
              if (!onOpen) return;
              if (targetsResourceAction(event.target)) return;
              onOpen();
            }}
            className={cn(
              "pointer-events-auto row-start-1 flex shrink-0 flex-nowrap items-start justify-end gap-[var(--resource-source-shelf-card-action-gap)] whitespace-nowrap text-[11px] leading-none",
              hasLeading ? "col-start-3" : "col-start-2",
            )}
          >
            {headerAction}
          </span>
        ) : null}
        {description ? (
          <span
            className={cn(
              "min-h-14 line-clamp-2 rounded-md bg-surface-recessed/50 px-2.5 py-2 text-xs leading-relaxed text-subtle-foreground",
              hasLeading ? "col-span-2 col-start-2" : "col-span-2 col-start-1",
            )}
          >
            {description}
          </span>
        ) : null}
      </div>
      {footerMeta ? (
        <span className="pointer-events-none relative mt-auto flex items-center justify-end pt-2">
          {footerMeta}
        </span>
      ) : null}
    </div>
  );
}

export function ResourceDetailPage({
  back,
  title,
  leading,
  info,
  lifecycleControl,
  overflowMenu,
  metadata,
  description,
  modeActions,
  children,
}: {
  back?: ReactNode;
  title: ReactNode;
  leading: ReactNode;
  info?: ReactNode;
  lifecycleControl?: ReactNode;
  overflowMenu?: ReactNode;
  metadata?: ReactNode;
  description?: ReactNode;
  modeActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {back}
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-4 shrink-0 items-center justify-center">
              {leading}
            </span>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
              {title}
            </h1>
          </div>
          {metadata ? (
            <div className="text-xs text-muted-foreground">{metadata}</div>
          ) : null}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {info || lifecycleControl || overflowMenu ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {info}
            {lifecycleControl}
            {overflowMenu}
          </div>
        ) : null}
      </div>
      {modeActions ? (
        <div className="flex flex-wrap items-center gap-2">{modeActions}</div>
      ) : null}
      {children}
    </div>
  );
}
