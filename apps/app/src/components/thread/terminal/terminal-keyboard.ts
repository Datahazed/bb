export const TERMINAL_REVERSE_SEARCH_INPUT = "\x12";
const TERMINAL_REVERSE_SEARCH_KEY_CODE = 82;

export interface TerminalKeyboardEvent {
  altKey: boolean;
  code?: string;
  ctrlKey: boolean;
  key: string;
  keyCode?: number;
  metaKey: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
  stopPropagation(): void;
  type: string;
  which?: number;
}

export interface TerminalInputSender {
  (data: string): boolean;
}

export interface HandleTerminalKeyEventArgs {
  event: TerminalKeyboardEvent;
  input: TerminalInputSender;
}

interface IsTerminalReverseSearchKeyEventArgs {
  event: TerminalKeyboardEvent;
}

function isReverseSearchRKey(event: TerminalKeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "r" ||
    event.code === "KeyR" ||
    event.keyCode === TERMINAL_REVERSE_SEARCH_KEY_CODE ||
    event.which === TERMINAL_REVERSE_SEARCH_KEY_CODE
  );
}

export function isTerminalReverseSearchKeyEvent(
  args: IsTerminalReverseSearchKeyEventArgs,
): boolean {
  return (
    args.event.type === "keydown" &&
    args.event.ctrlKey &&
    !args.event.altKey &&
    !args.event.metaKey &&
    isReverseSearchRKey(args.event)
  );
}

export function handleTerminalKeyEvent(
  args: HandleTerminalKeyEventArgs,
): boolean {
  if (!isTerminalReverseSearchKeyEvent(args)) {
    return true;
  }

  args.event.preventDefault();
  args.event.stopImmediatePropagation();
  args.event.stopPropagation();
  args.input(TERMINAL_REVERSE_SEARCH_INPUT);
  return false;
}
