import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useClipboardCopy, type ClipboardCopyOptions } from "@/lib/clipboard";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";

interface CopyButtonProps
  extends
    ClipboardCopyOptions,
    Omit<ComponentPropsWithoutRef<"button">, "type" | "onClick" | "title"> {
  iconClassName?: string;
  label?: string;
}

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  function CopyButton(
    {
      text,
      className,
      iconClassName,
      label = "Copy to clipboard",
      successMessage,
      errorMessage,
      ...rest
    },
    ref,
  ) {
    const { copied, copy } = useClipboardCopy({
      text,
      successMessage,
      errorMessage,
    });

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        {...rest}
        className={cn(
          `inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground ${CONTROL_HOVER_TRANSITION} hover:text-foreground focus-visible:opacity-100`,
          className,
        )}
        onClick={() => {
          void copy();
        }}
      >
        {copied ? (
          <Icon name="Check" className={cn("size-3", iconClassName)} />
        ) : (
          <Icon name="Copy" className={cn("size-3", iconClassName)} />
        )}
      </button>
    );
  },
);

interface CopyableInlineLabelProps extends ClipboardCopyOptions {
  label: string;
  tooltip: string;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}

export function CopyableInlineLabel({
  text,
  label,
  tooltip,
  className,
  iconClassName,
  successMessage,
  errorMessage,
  children,
}: CopyableInlineLabelProps) {
  const { copied, copy } = useClipboardCopy({
    text,
    successMessage,
    errorMessage,
  });

  const button = (
    <button
      type="button"
      className={cn(
        `inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-foreground outline-none ${CONTROL_HOVER_TRANSITION} hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring`,
        className,
      )}
      onClick={() => {
        void copy();
      }}
      aria-label={label}
    >
      <span className="min-w-0 truncate">{children ?? text}</span>
      <Icon
        name={copied ? "Check" : "Copy"}
        className={cn("size-3.5 shrink-0 text-muted-foreground", iconClassName)}
      />
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
