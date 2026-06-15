export const TERMINAL_REVERSE_SEARCH_INPUT = "\x12";

export interface TerminalKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  type: string;
}

export interface HandleTerminalKeyEventArgs {
  event: TerminalKeyboardEvent;
  input(data: string): void;
  platform: string;
}

interface IsMacTerminalReverseSearchKeyEventArgs {
  event: TerminalKeyboardEvent;
  platform: string;
}

export function isMacPlatform(platform: string): boolean {
  return platform.toLowerCase().startsWith("mac");
}

export function isMacTerminalReverseSearchKeyEvent(
  args: IsMacTerminalReverseSearchKeyEventArgs,
): boolean {
  return (
    isMacPlatform(args.platform) &&
    args.event.type === "keydown" &&
    args.event.ctrlKey &&
    !args.event.altKey &&
    !args.event.metaKey &&
    args.event.key.toLowerCase() === "r"
  );
}

export function handleTerminalKeyEvent(
  args: HandleTerminalKeyEventArgs,
): boolean {
  if (!isMacTerminalReverseSearchKeyEvent(args)) {
    return true;
  }

  args.event.preventDefault();
  args.event.stopPropagation();
  args.input(TERMINAL_REVERSE_SEARCH_INPUT);
  return false;
}
