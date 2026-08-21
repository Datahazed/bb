// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePluginAppearance } from "./plugin-appearance";

function installColorMode(initial: "light" | "dark"): {
  setColorMode(mode: "light" | "dark"): void;
} {
  let mode = initial;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const mediaQuery: MediaQueryList = {
    get matches() {
      return mode === "dark";
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.add(listener);
    },
    removeEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners) {
        if (typeof listener === "function") listener.call(mediaQuery, event);
        else listener.handleEvent(event);
      }
      return true;
    },
  };
  window.matchMedia = vi.fn(() => mediaQuery);
  return {
    setColorMode(next) {
      mode = next;
      mediaQuery.dispatchEvent(new Event("change"));
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("experimental_useAppearance", () => {
  it("maps preference and system changes to semantic client appearance", () => {
    const system = installColorMode("dark");
    const { result } = renderHook(() => usePluginAppearance());

    expect(result.current.colorModePreference).toBe("system");
    expect(result.current.colorMode).toBe("dark");

    act(() => result.current.setColorModePreference("light"));
    expect(result.current.colorModePreference).toBe("light");
    expect(result.current.colorMode).toBe("light");

    act(() => result.current.setColorModePreference("system"));
    expect(result.current.colorModePreference).toBe("system");
    expect(result.current.colorMode).toBe("dark");

    act(() => system.setColorMode("light"));
    expect(result.current.colorModePreference).toBe("system");
    expect(result.current.colorMode).toBe("light");
  });
});
