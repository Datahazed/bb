import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type TouchEvent,
  type WheelEvent,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

interface PreviewTriggerProps {
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  tabIndex?: number;
}

export interface PromptMentionPreviewTooltipProps {
  children: ReactElement<PreviewTriggerProps>;
  content?: string | null;
}

const KEYBOARD_SCROLL_STEP = 32;

interface OverflowState {
  above: boolean;
  below: boolean;
}

/**
 * Adds an optional host tooltip to a mention pill without changing pills that
 * carry no preview. The trigger remains the pill itself; preview-bearing
 * display-only pills become keyboard-focusable so the same content is
 * available without pointer hover.
 */
export function PromptMentionPreviewTooltip({
  children,
  content,
}: PromptMentionPreviewTooltipProps) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [overflow, setOverflow] = useState<OverflowState>({
    above: false,
    below: false,
  });
  const measureOverflow = useCallback((scroll: HTMLDivElement) => {
    const next = {
      above: scroll.scrollTop > 1,
      below: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 1,
    };
    setOverflow((previous) =>
      previous.above === next.above && previous.below === next.below
        ? previous
        : next,
    );
  }, []);
  // Radix renders a visually-hidden copy of tooltip content for the trigger's
  // accessible description. Keep measurement refs on the visible copy so the
  // duplicate does not replace them with zero-sized nodes.
  const setVisibleScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null || node.closest('[role="tooltip"]') !== null) return;
      resizeObserverRef.current?.disconnect();
      scrollRef.current = node;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserverRef.current = new ResizeObserver(() =>
          measureOverflow(node),
        );
        resizeObserverRef.current.observe(node);
      }
      window.requestAnimationFrame(() => measureOverflow(node));
    },
    [measureOverflow],
  );
  const hasPreview = typeof content === "string" && content.trim().length > 0;

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      scrollRef.current = null;
    }
    setOpen(nextOpen);
  }, []);

  const scrollPreviewWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const scroll = scrollRef.current;
      if (!open || !scroll) return;

      const pageStep = Math.max(
        KEYBOARD_SCROLL_STEP,
        Math.round(scroll.clientHeight * 0.8),
      );
      let nextScrollTop: number | null = null;
      if (event.key === "ArrowDown") {
        nextScrollTop = scroll.scrollTop + KEYBOARD_SCROLL_STEP;
      } else if (event.key === "ArrowUp") {
        nextScrollTop = scroll.scrollTop - KEYBOARD_SCROLL_STEP;
      } else if (event.key === "PageDown") {
        nextScrollTop = scroll.scrollTop + pageStep;
      } else if (event.key === "PageUp") {
        nextScrollTop = scroll.scrollTop - pageStep;
      } else if (event.key === "Home") {
        nextScrollTop = 0;
      } else if (event.key === "End") {
        nextScrollTop = scroll.scrollHeight;
      }
      if (nextScrollTop === null) return;

      event.preventDefault();
      event.stopPropagation();
      scroll.scrollTop = Math.max(
        0,
        Math.min(nextScrollTop, scroll.scrollHeight - scroll.clientHeight),
      );
      measureOverflow(scroll);
    },
    [measureOverflow, open],
  );

  if (!hasPreview) return children;

  const trigger = cloneElement(children, {
    tabIndex: children.props.tabIndex ?? 0,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      children.props.onKeyDown?.(event);
      if (!event.defaultPrevented) scrollPreviewWithKeyboard(event);
    },
  });
  const stopScrollPropagation = (
    event: WheelEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>,
  ) => event.stopPropagation();

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      <Tooltip open={open} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          data-mention-preview-tooltip="true"
          side="top"
          align="start"
          className="w-max max-w-[min(32rem,var(--radix-tooltip-content-available-width))] p-0"
        >
          <div className="relative isolate min-w-0">
            <div
              ref={setVisibleScrollRef}
              data-mention-preview-scroll="true"
              className="min-w-48 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-2 text-left font-normal leading-relaxed whitespace-pre-wrap break-words"
              style={{
                maxHeight:
                  "min(16rem, var(--radix-tooltip-content-available-height, 16rem))",
              }}
              onScroll={(event) => measureOverflow(event.currentTarget)}
              onWheel={stopScrollPropagation}
              onTouchMove={stopScrollPropagation}
            >
              {content}
            </div>
            {overflow.above ? (
              <div
                aria-hidden
                data-mention-preview-fade="above"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-primary to-transparent"
              />
            ) : null}
            {overflow.below ? (
              <div
                aria-hidden
                data-mention-preview-fade="below"
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-primary to-transparent"
              />
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
