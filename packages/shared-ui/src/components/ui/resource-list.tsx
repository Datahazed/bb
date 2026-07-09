import type { ReactNode } from "react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Icon, type IconName } from "./icon";
import { Input } from "./input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "../../lib/utils";

export type ResourceStatusTone = "success" | "warning" | "error" | "muted";

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
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-surface-recessed px-1.5 py-1 text-muted-foreground">
      <Icon name={icon} className="size-3 shrink-0" aria-hidden />
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
  action,
}: {
  searchValue: string;
  searchPlaceholder: string;
  searchLabel?: string;
  onSearchChange: (value: string) => void;
  controls?: ReactNode;
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
        <div className="flex shrink-0 items-center gap-1">{controls}</div>
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
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 p-0 text-muted-foreground"
                aria-label={label}
              >
                <Icon name={icon} className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 p-0 text-muted-foreground"
                aria-label="Sort"
              >
                <Icon name="ArrowUpDown" className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Sort</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
                if (option.disabled) {
                  event.preventDefault();
                  return;
                }
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
      <DropdownMenuContent align="end" className="w-44" mobileTitle={label}>
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
  icon,
  tone = "muted",
  disabled = false,
  onClick,
}: {
  label: string;
  icon: IconName;
  tone?: "muted" | "destructive";
  disabled?: boolean;
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
            )}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            <Icon name={icon} className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
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
        "group grid min-w-0 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-3 rounded-md bg-transparent px-3 py-2 text-left transition-colors hover:bg-state-hover focus-within:bg-state-hover",
        selected && "bg-state-active",
        muted && "opacity-60",
        className,
      )}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest("a, button, [data-row-action]")
        ) {
          return;
        }
        onOpen();
      }}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {leading}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            "mt-0.5 flex shrink-0 items-center gap-0.5 transition-opacity",
            actionsVisibility === "hover" &&
              "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
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
        <div className="space-y-0">{children}</div>
      </div>
    </div>
  );
}

export function ResourcePropertyList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-popover shadow-sm">
      {children}
    </div>
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

export function ResourceSourceShelf({
  label,
  count,
  leading,
  action,
  children,
}: {
  label: ReactNode;
  count?: ReactNode;
  leading?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="inline-block max-w-full space-y-2 rounded-lg bg-surface-recessed/70 p-2 align-top text-popover-foreground">
      <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {leading}
          <span className="truncate font-medium">{label}</span>
          {count !== undefined && count !== null && count !== false ? (
            <span className="text-subtle-foreground">{count}</span>
          ) : null}
        </div>
        {action ? (
          <div className="shrink-0 text-xs text-muted-foreground">{action}</div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-max snap-x snap-mandatory gap-1">
          {children}
        </div>
      </div>
    </section>
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
    <div className={cn("min-w-[22rem] max-w-[22rem] snap-start", className)}>
      {children}
    </div>
  );
}

export function ResourceBrowseCard({
  leading,
  title,
  description,
  meta,
  tags = [],
  state,
  action,
  onOpen,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tags?: readonly ReactNode[];
  state?: ReactNode;
  action?: ReactNode;
  onOpen: () => void;
}) {
  const hasLeading =
    leading !== undefined && leading !== null && leading !== false;
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex h-full min-h-36 w-full flex-col rounded-md border border-border bg-background p-3 text-left shadow-sm transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest("a, button, [data-row-action]")
        ) {
          return;
        }
        onOpen();
      }}
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest("a, button, [data-row-action]")
        ) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div
        className={cn(
          "grid min-w-0 gap-x-2 gap-y-2",
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
          {meta ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
        {state ? (
          <span
            className={cn(
              "row-start-1 flex max-w-28 shrink-0 flex-wrap items-start justify-end gap-1 text-[11px] leading-none [&>*]:max-w-full [&>*]:justify-end",
              hasLeading ? "col-start-3" : "col-start-2",
            )}
          >
            {state}
          </span>
        ) : null}
        {description ? (
          <span
            className={cn(
              "line-clamp-3 rounded-md bg-surface-recessed/70 px-2.5 py-2 text-xs leading-relaxed text-subtle-foreground",
              hasLeading ? "col-span-2 col-start-2" : "col-span-2 col-start-1",
            )}
          >
            {description}
          </span>
        ) : null}
        {tags.length > 0 ? (
          <span
            className={cn(
              "flex flex-wrap gap-1",
              hasLeading ? "col-span-2 col-start-2" : "col-span-2 col-start-1",
            )}
          >
            {tags.map((tag, index) => (
              <span
                key={index}
                className="rounded-md bg-surface-recessed px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {action ? (
        <span
          data-row-action
          className="mt-auto flex items-center justify-end pt-3"
        >
          {action}
        </span>
      ) : null}
    </div>
  );
}

export function ResourceDetailPage({
  back,
  title,
  leading,
  status,
  headerActions,
  meta,
  description,
  actions,
  children,
}: {
  back?: ReactNode;
  title: ReactNode;
  leading: ReactNode;
  status?: ReactNode;
  headerActions?: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
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
          {meta ? (
            <div className="text-xs text-muted-foreground">{meta}</div>
          ) : null}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {status || headerActions ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {status}
            {headerActions ? (
              <span className="flex shrink-0 items-center gap-0.5">
                {headerActions}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
      {children}
    </div>
  );
}
