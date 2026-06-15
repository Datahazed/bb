import { describe, expect, it } from "vitest";
import {
  TERMINAL_REVERSE_SEARCH_INPUT,
  handleTerminalKeyEvent,
  type TerminalKeyboardEvent,
} from "./terminal-keyboard";

interface FakeTerminalKeyboardEventArgs {
  altKey: boolean;
  code?: string;
  ctrlKey: boolean;
  key: string;
  keyCode?: number;
  metaKey: boolean;
  type: string;
  which?: number;
}

class FakeTerminalKeyboardEvent implements TerminalKeyboardEvent {
  public readonly altKey: boolean;
  public readonly code?: string;
  public readonly ctrlKey: boolean;
  public defaultPrevented = false;
  public readonly key: string;
  public readonly keyCode?: number;
  public readonly metaKey: boolean;
  public immediatePropagationStopped = false;
  public propagationStopped = false;
  public readonly type: string;
  public readonly which?: number;

  constructor(args: FakeTerminalKeyboardEventArgs) {
    this.altKey = args.altKey;
    this.code = args.code;
    this.ctrlKey = args.ctrlKey;
    this.key = args.key;
    this.keyCode = args.keyCode;
    this.metaKey = args.metaKey;
    this.type = args.type;
    this.which = args.which;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

function createTerminalKeyboardEvent(
  args: FakeTerminalKeyboardEventArgs,
): FakeTerminalKeyboardEvent {
  return new FakeTerminalKeyboardEvent(args);
}

describe("terminal keyboard handling", () => {
  it("sends reverse search input for Ctrl+R", () => {
    const input: string[] = [];
    const event = createTerminalKeyboardEvent({
      altKey: false,
      ctrlKey: true,
      key: "r",
      metaKey: false,
      type: "keydown",
    });

    const shouldProcess = handleTerminalKeyEvent({
      event,
      input(data) {
        input.push(data);
        return true;
      },
    });

    expect(shouldProcess).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(event.immediatePropagationStopped).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(input).toEqual([TERMINAL_REVERSE_SEARCH_INPUT]);
  });

  it("matches Ctrl+R by code when key is not normalized", () => {
    const input: string[] = [];
    const event = createTerminalKeyboardEvent({
      altKey: false,
      code: "KeyR",
      ctrlKey: true,
      key: "",
      metaKey: false,
      type: "keydown",
    });

    const shouldProcess = handleTerminalKeyEvent({
      event,
      input(data) {
        input.push(data);
        return true;
      },
    });

    expect(shouldProcess).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(event.immediatePropagationStopped).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(input).toEqual([TERMINAL_REVERSE_SEARCH_INPUT]);
  });

  it("leaves Cmd+R for reload", () => {
    const input: string[] = [];
    const event = createTerminalKeyboardEvent({
      altKey: false,
      ctrlKey: false,
      key: "r",
      metaKey: true,
      type: "keydown",
    });

    const shouldProcess = handleTerminalKeyEvent({
      event,
      input(data) {
        input.push(data);
        return true;
      },
    });

    expect(shouldProcess).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(event.immediatePropagationStopped).toBe(false);
    expect(event.propagationStopped).toBe(false);
    expect(input).toEqual([]);
  });

  it("leaves modified Ctrl+R chords to xterm defaults", () => {
    const input: string[] = [];
    const event = createTerminalKeyboardEvent({
      altKey: true,
      ctrlKey: true,
      key: "r",
      metaKey: false,
      type: "keydown",
    });

    const shouldProcess = handleTerminalKeyEvent({
      event,
      input(data) {
        input.push(data);
        return true;
      },
    });

    expect(shouldProcess).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(event.immediatePropagationStopped).toBe(false);
    expect(event.propagationStopped).toBe(false);
    expect(input).toEqual([]);
  });
});
