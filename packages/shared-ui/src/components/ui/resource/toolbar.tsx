import { Fragment, useState, type ReactNode } from "react";
import { Button } from "../button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { Icon, type IconName } from "../icon";
import { Input } from "../input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { cn } from "../../../lib/utils";

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
            "flex shrink-0 items-center gap-1.5",
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
  // No inline inset or measure cap: the description shares the collection's
  // content width with the tabs, toolbar, and results beneath it.
  return <p className="text-sm leading-5 text-muted-foreground">{children}</p>;
}

export interface ResourceOption {
  id: string;
  label: string;
  leading?: ReactNode;
  description?: string;
  disabled?: boolean;
}

function ResourceOptionContent({
  option,
  compact = false,
}: {
  option: ResourceOption;
  compact?: boolean;
}) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-2", compact && "md:gap-1.5")}
    >
      {option.leading ? (
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {option.leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span
          className="truncate text-xs"
          title={compact ? option.label : undefined}
        >
          {option.label}
        </span>
        {option.description ? (
          <span className="truncate text-2xs text-subtle-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The engaged treatment shared by open and selected toolbar menu triggers.
 *
 * This is the app's one selection surface — the same `bg-state-active` +
 * `text-foreground` pair used by selected sidebar rows, active tab pills, and
 * focused split panes (see CONTEXT_SELECTION_SURFACE_CLASS in the app). Keeping
 * toolbar filters on it means "selected" reads identically everywhere instead
 * of this surface inventing its own language.
 */
export const RESOURCE_MENU_TRIGGER_ENGAGED_CLASS =
  "bg-state-active text-foreground hover:bg-state-active";

/**
 * A toolbar key is a sibling of the search input beside it: same 32px box,
 * same `--input` border, same radius, on the canvas surface. That keeps the
 * row reading as one set of controls instead of a field plus a floating chip
 * cluster. `--background` is `var(--canvas)`, so custom palettes get their own
 * paper colour rather than a hardcoded white.
 */
export const RESOURCE_MENU_TRIGGER_RESTING_CLASS =
  "border border-input bg-background";

/**
 * Engagement is driven by React state, not `data-[state=open]`.
 *
 * These triggers compose `TooltipTrigger asChild > DropdownMenuTrigger asChild
 * > Button`, and the tooltip's own `data-state` lands on the same element as
 * the menu's — so the button reads `data-state="closed"` even while its menu is
 * open. Any `data-[state=open]:` styling here is silently dead. Menus therefore
 * report open state through `onOpenChange` and pass it in as `open`.
 */
function ResourceMenuTrigger({
  label,
  icon,
  active = false,
  open = false,
  tooltip = label,
}: {
  label: string;
  icon: IconName;
  active?: boolean;
  open?: boolean;
  tooltip?: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(
                "size-8 shrink-0 rounded-md p-0 text-muted-foreground",
                RESOURCE_MENU_TRIGGER_RESTING_CLASS,
                (open || active) && RESOURCE_MENU_TRIGGER_ENGAGED_CLASS,
              )}
              aria-label={label}
            >
              <Icon name={icon} className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
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
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger label={label} icon={icon} open={open} />
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
              <ResourceOptionContent option={option} />
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
  selectedLabel,
  selectedTooltip,
  emptySelectionLabel = "All",
  compact = false,
}: {
  label: string;
  icon: IconName;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
  selectedLabel?: (options: readonly ResourceOption[]) => string;
  selectedTooltip?: (options: readonly ResourceOption[]) => ReactNode;
  /** Summary shown when nothing is picked, which always means "no filter". */
  emptySelectionLabel?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedValues);
  const enabledOptions = options.filter((option) => !option.disabled);
  const activeOptions = enabledOptions.filter((option) =>
    selected.has(option.id),
  );
  const activeSelectedCount = activeOptions.length;
  const selectionSummary =
    activeSelectedCount === 0
      ? emptySelectionLabel
      : (selectedLabel?.(activeOptions) ?? `${activeSelectedCount} selected`);
  const triggerLabel =
    activeSelectedCount === 0
      ? label
      : (selectedLabel?.(activeOptions) ??
        `${label}: ${activeSelectedCount} selected`);
  const triggerTooltip =
    selectedTooltip?.(activeOptions) ?? `${label}: ${selectionSummary}`;

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
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger
        label={triggerLabel}
        icon={icon}
        active={activeSelectedCount > 0}
        open={open}
        tooltip={triggerTooltip}
      />
      <DropdownMenuContent
        align="end"
        mobileTitle={label}
        className={cn(compact ? "w-max max-w-64 md:p-0.5" : "min-w-44")}
      >
        <DropdownMenuLabel
          className={cn(
            "text-xs font-normal text-subtle-foreground",
            compact && "md:px-1.5 md:py-1",
          )}
        >
          {label}
        </DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selected.has(option.id)}
            disabled={option.disabled}
            className={cn(compact && "md:py-1 md:pl-1.5 md:pr-7")}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => updateValue(option, checked === true)}
          >
            <ResourceOptionContent option={option} compact={compact} />
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One filterable dimension inside a {@link ResourceFilterMenu}. */
export interface ResourceFilterGroup {
  id: string;
  label: string;
  options: readonly ResourceOption[];
  selectedValues: readonly string[];
  onChange: (values: string[]) => void;
}

/**
 * Several filterable dimensions behind one trigger.
 *
 * Each group keeps its own selection and handler, so filtering behavior is
 * identical to the separate menus this replaces — only the affordance is
 * consolidated. Nothing selected in a group means that group is unfiltered.
 */
export function ResourceFilterMenu({
  label = "Filters",
  icon = "SlidersHorizontal",
  groups,
  compact = false,
}: {
  label?: string;
  icon?: IconName;
  groups: readonly ResourceFilterGroup[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const activeGroups = groups.map((group) => {
    const selected = new Set(group.selectedValues);
    const activeOptions = group.options.filter(
      (option) => !option.disabled && selected.has(option.id),
    );
    return { group, selected, activeOptions };
  });
  const activeSummaries = activeGroups
    .filter(({ activeOptions }) => activeOptions.length > 0)
    .map(
      ({ group, activeOptions }) =>
        `${group.label}: ${activeOptions.map((option) => option.label).join(", ")}`,
    );
  const hasActiveFilter = activeSummaries.length > 0;
  const triggerLabel = hasActiveFilter
    ? `${label}: ${activeSummaries.join("; ")}`
    : label;

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger
        label={triggerLabel}
        icon={icon}
        active={hasActiveFilter}
        open={open}
        tooltip={hasActiveFilter ? activeSummaries.join("; ") : `${label}: All`}
      />
      <DropdownMenuContent
        align="end"
        mobileTitle={label}
        className={cn(compact ? "w-max max-w-64 md:p-0.5" : "min-w-44")}
      >
        {activeGroups.map(({ group, selected }, groupIndex) => (
          <Fragment key={group.id}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel
              className={cn(
                "text-xs font-normal text-subtle-foreground",
                compact && "md:px-1.5 md:py-1",
              )}
            >
              {group.label}
            </DropdownMenuLabel>
            {group.options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={selected.has(option.id)}
                disabled={option.disabled}
                className={cn(compact && "md:py-1 md:pl-1.5 md:pr-7")}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => {
                  if (option.disabled) return;
                  const next = new Set(group.selectedValues);
                  if (checked === true) next.add(option.id);
                  else next.delete(option.id);
                  const selectableIds = new Set(
                    group.options
                      .filter((candidate) => !candidate.disabled)
                      .map(({ id }) => id),
                  );
                  group.onChange(
                    [...next].filter((id) => selectableIds.has(id)),
                  );
                }}
              >
                <ResourceOptionContent option={option} compact={compact} />
              </DropdownMenuCheckboxItem>
            ))}
          </Fragment>
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
  compact = false,
}: {
  value: string;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.id === value);
  const directionLabel = direction === "asc" ? "ascending" : "descending";
  const sortStateLabel = `Sort: ${selectedOption?.label ?? value}, ${directionLabel}`;

  return (
    <DropdownMenu onOpenChange={setOpen}>
      {/* One sort glyph on every collection page. Direction stays readable in
          the accessible label and on the checked row's trailing arrow, so the
          compact toolbar no longer swaps in a different icon. */}
      <ResourceMenuTrigger
        label={sortStateLabel}
        icon="ArrowUpDown"
        open={open}
      />
      <DropdownMenuContent
        align="end"
        mobileTitle="Sort"
        className={cn("min-w-40", compact && "md:p-0.5")}
      >
        <DropdownMenuLabel
          className={cn(
            "text-xs font-normal text-subtle-foreground",
            compact && "md:px-1.5 md:py-1",
          )}
        >
          Sort by
        </DropdownMenuLabel>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <DropdownMenuItem
              key={option.id}
              disabled={option.disabled}
              role="menuitemradio"
              aria-checked={selected}
              onSelect={(event) => {
                event.preventDefault();
                if (option.disabled) return;
                onChange(option.id);
              }}
              className={cn(
                "flex items-center justify-between gap-3",
                compact && "md:gap-2 md:px-1.5 md:py-1",
              )}
            >
              <ResourceOptionContent option={option} compact={compact} />
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
  icon?: IconName;
}

export interface ResourceCreateMenuAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
}

export function ResourceCreateButton({
  label,
  templates,
  templateMenuLabel = "Examples",
  menuActions = [],
  onCreate,
}: {
  label: string;
  templates: readonly ResourceCreateTemplate[];
  templateMenuLabel?: string;
  menuActions?: readonly ResourceCreateMenuAction[];
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
        <Icon name="MessageCirclePlus" className="size-4" aria-hidden />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-label={`${label} options`}
            className="rounded-l-none px-1.5"
          >
            <Icon name="ChevronDown" className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-40 w-max"
          mobileTitle={templateMenuLabel}
        >
          {menuActions.map((action) => (
            <DropdownMenuItem key={action.label} onSelect={action.onSelect}>
              <Icon name={action.icon} className="size-4" aria-hidden />
              {action.label}
            </DropdownMenuItem>
          ))}
          {menuActions.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
            {templateMenuLabel}
          </DropdownMenuLabel>
          {templates.map((template) => (
            <DropdownMenuItem
              key={template.label}
              className="py-2"
              onSelect={() => onCreate(template.prompt)}
            >
              {template.icon ? (
                <Icon
                  name={template.icon}
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              ) : null}
              <span className="min-w-0 truncate text-sm text-foreground">
                {template.label}
              </span>
              <span className="sr-only">: {template.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
