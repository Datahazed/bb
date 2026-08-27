import { useEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { cn } from "@bb/shared-ui/lib/utils";

export interface PluginBrowseCategoryOption {
  id: string;
  label: string;
  count: number;
}

const ENGAGED_CONTROL_CLASS =
  "bg-state-active text-foreground hover:bg-state-active";

/** Searchable, single-dimension category picker for the full taxonomy. */
export function PluginBrowseCategoryFilter({
  options,
  value,
  totalCount,
  onChange,
}: {
  options: readonly PluginBrowseCategoryOption[];
  value: string | null;
  totalCount: number;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showKeyboardFocus, setShowKeyboardFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardFocusRef = useRef(false);
  const selectedOption = options.find((option) => option.id === value);
  const selectionLabel = selectedOption?.label ?? "All categories";
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.id}`
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );
  const showAllOption =
    normalizedSearch === "" || "all categories".includes(normalizedSearch);

  useEffect(() => {
    if (!open) return;
    const animationFrame = requestAnimationFrame(() =>
      inputRef.current?.focus(),
    );
    return () => cancelAnimationFrame(animationFrame);
  }, [open]);

  const select = (nextValue: string | null) => {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-8 max-w-52 gap-2 px-2.5 text-xs font-normal",
            (open || value !== null) && ENGAGED_CONTROL_CLASS,
          )}
          aria-label={`Filter plugins by category: ${selectionLabel}`}
          aria-expanded={open}
          onPointerDown={() => {
            keyboardFocusRef.current = false;
            setShowKeyboardFocus(false);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "ArrowDown"
            ) {
              keyboardFocusRef.current = true;
              setShowKeyboardFocus(true);
            }
          }}
        >
          <Icon
            name="SlidersHorizontal"
            className="size-3.5 shrink-0"
            aria-hidden
          />
          <span className="min-w-0 truncate">{selectionLabel}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        mobileTitle="Filter plugins by category"
        className="w-72 p-1.5"
      >
        <div className="relative">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search categories"
            aria-label="Search plugin categories"
            role="combobox"
            aria-controls="plugin-category-options"
            aria-expanded={open}
            aria-autocomplete="list"
            className={cn(
              "h-7 border-transparent bg-surface-recessed pl-7 pr-2 text-xs focus-visible:ring-0",
              showKeyboardFocus && "ring-1 ring-ring",
            )}
            onFocus={() => setShowKeyboardFocus(keyboardFocusRef.current)}
            onBlur={() => setShowKeyboardFocus(false)}
            onPointerDown={() => {
              keyboardFocusRef.current = false;
              setShowKeyboardFocus(false);
            }}
            onKeyDown={(event) => {
              keyboardFocusRef.current = true;
              setShowKeyboardFocus(true);
              if (event.key === "ArrowDown") {
                event.preventDefault();
                categoryOptionElements()[0]?.focus();
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                categoryOptionElements().at(-1)?.focus();
              } else if (event.key !== "Escape" && event.key !== "Tab") {
                // Radix menu-style typeahead must not steal characters from
                // the input; Escape and Tab keep their normal overlay/focus
                // behavior.
                event.stopPropagation();
              }
            }}
          />
        </div>
        <p className="px-1.5 pb-1 pt-1.5 text-2xs text-subtle-foreground">
          {options.length} categories
        </p>
        <div
          id="plugin-category-options"
          role="listbox"
          aria-label="Plugin categories"
          className="max-h-64 overflow-y-auto"
        >
          {!showAllOption && filteredOptions.length === 0 ? (
            <p
              className="px-2 py-6 text-center text-xs text-muted-foreground"
              role="status"
            >
              {options.length === 0
                ? "No categories are available."
                : "No categories match your search."}
            </p>
          ) : (
            <>
              {showAllOption ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === null}
                  onClick={() => select(null)}
                  className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs outline-none hover:bg-state-hover focus-visible:bg-state-hover focus-visible:text-foreground"
                  onKeyDown={focusCategoryOption}
                >
                  <span className="min-w-0 flex-1 truncate">
                    All categories
                  </span>
                  <span className="text-2xs tabular-nums text-subtle-foreground">
                    {totalCount.toLocaleString()}
                  </span>
                  <Icon
                    name="Check"
                    className={cn(
                      "size-3.5",
                      value === null ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </button>
              ) : null}
              {filteredOptions.map((option) => {
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={option.id === value}
                    onClick={() => select(option.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs outline-none hover:bg-state-hover focus-visible:bg-state-hover focus-visible:text-foreground"
                    onKeyDown={focusCategoryOption}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="text-2xs tabular-nums text-subtle-foreground">
                      {option.count.toLocaleString()}
                    </span>
                    <Icon
                      name="Check"
                      className={cn(
                        "size-3.5",
                        option.id === value ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function focusCategoryOption(event: React.KeyboardEvent<HTMLButtonElement>) {
  const options = categoryOptionElements();
  const index = options.indexOf(event.currentTarget);
  if (index < 0) return;
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown")
    nextIndex = Math.min(index + 1, options.length - 1);
  else if (event.key === "ArrowUp") nextIndex = Math.max(index - 1, 0);
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = options.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  options[nextIndex]?.focus();
}

function categoryOptionElements(): HTMLButtonElement[] {
  const listbox = document.getElementById("plugin-category-options");
  if (listbox === null) return [];
  return [...listbox.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}
