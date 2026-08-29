import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { visibleCategoryChipCount } from "./plugin-browse-discovery";

export interface PluginCategoryChipOption {
  id: string;
  label: string;
}

export function PluginCategoryChips({
  options,
  value,
  onChange,
  allLabel = "All",
  ariaLabel,
  centered = false,
}: {
  options: readonly PluginCategoryChipOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  allLabel?: string;
  ariaLabel: string;
  centered?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const allMeasureRef = useRef<HTMLButtonElement>(null);
  const categoryMeasureRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overflowMeasureRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [visibleCount, setVisibleCount] = useState(options.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const all = allMeasureRef.current;
    if (container === null || all === null) return;

    const measure = () => {
      const categoryWidths = options.map(
        (_option, index) =>
          categoryMeasureRefs.current[index]?.offsetWidth ?? 0,
      );
      if (
        container.clientWidth === 0 ||
        categoryWidths.some((width) => width === 0)
      ) {
        return;
      }
      setVisibleCount(
        visibleCategoryChipCount({
          containerWidth: container.clientWidth,
          allWidth: all.offsetWidth,
          categoryWidths,
          overflowWidthsByHiddenCount: overflowMeasureRefs.current.map(
            (element) => element?.offsetWidth ?? 0,
          ),
          gap: 6,
        }),
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [options]);

  if (options.length === 0) return null;
  const visibleOptions = options.slice(0, visibleCount);
  const hiddenOptions = options.slice(visibleCount);
  const chipClassName =
    "h-7 shrink-0 rounded-full border-transparent bg-surface-recessed px-3 font-normal hover:bg-state-hover aria-pressed:bg-state-active aria-pressed:text-foreground";

  return (
    <div className="relative min-w-0">
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn(
          "flex min-w-0 items-center gap-1.5 overflow-hidden",
          centered && "justify-center",
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={chipClassName}
          role="radio"
          aria-checked={value === null}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          {allLabel}
        </Button>
        {visibleOptions.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="outline"
            size="sm"
            className={chipClassName}
            role="radio"
            aria-checked={value === option.id}
            aria-pressed={value === option.id}
            onClick={() => onChange(value === option.id ? null : option.id)}
          >
            {option.label}
          </Button>
        ))}
        {hiddenOptions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={chipClassName}
                aria-label={`Show ${hiddenOptions.length} more categories`}
                aria-pressed={hiddenOptions.some(
                  (option) => option.id === value,
                )}
              >
                +{hiddenOptions.length} more
                <Icon name="ChevronDown" className="size-3" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {hiddenOptions.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={() =>
                    onChange(value === option.id ? null : option.id)
                  }
                  className="flex items-center justify-between gap-3"
                >
                  {option.label}
                  <Icon
                    name="Check"
                    aria-hidden
                    className={cn(
                      "size-4",
                      option.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex w-full items-center gap-1.5 overflow-hidden"
      >
        <Button
          ref={allMeasureRef}
          type="button"
          variant="outline"
          size="sm"
          className={chipClassName}
          tabIndex={-1}
        >
          {allLabel}
        </Button>
        {options.map((option, index) => (
          <Button
            key={option.id}
            ref={(element) => {
              categoryMeasureRefs.current[index] = element;
            }}
            type="button"
            variant="outline"
            size="sm"
            className={chipClassName}
            tabIndex={-1}
          >
            {option.label}
          </Button>
        ))}
        {Array.from({ length: options.length + 1 }, (_unused, hiddenCount) =>
          hiddenCount === 0 ? null : (
            <Button
              key={hiddenCount}
              ref={(element) => {
                overflowMeasureRefs.current[hiddenCount] = element;
              }}
              type="button"
              variant="outline"
              size="sm"
              className={chipClassName}
              tabIndex={-1}
            >
              +{hiddenCount} more
              <Icon name="ChevronDown" className="size-3" aria-hidden />
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
