// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";

const routeLifecycle = vi.hoisted(() => ({
  mounts: 0,
  splitWorkspaceRenders: 0,
  unmounts: 0,
}));

vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("./views/ToolsView", async () => {
  const { useEffect } = await import("react");
  const { useLocation } = await import("react-router-dom");
  return {
    ToolsView: () => {
      const location = useLocation();
      useEffect(() => {
        routeLifecycle.mounts += 1;
        return () => {
          routeLifecycle.unmounts += 1;
        };
      }, []);
      return <output data-testid="tools-view">{location.pathname}</output>;
    },
  };
});

vi.mock("./views/SplitWorkspaceRoute", () => ({
  default: () => {
    routeLifecycle.splitWorkspaceRenders += 1;
    return <output>split workspace</output>;
  },
}));

function PluginNavigation() {
  const navigate = useNavigate();
  return (
    <nav>
      <button onClick={() => navigate("/extensions/plugins/github")}>
        detail
      </button>
      <button
        onClick={() => navigate("/extensions/plugins/authors/pat%3Alee")}
      >
        author
      </button>
    </nav>
  );
}

afterEach(() => {
  cleanup();
  routeLifecycle.mounts = 0;
  routeLifecycle.splitWorkspaceRenders = 0;
  routeLifecycle.unmounts = 0;
});

describe("plugin discovery routes", () => {
  it("keeps one ToolsView mounted across collection, detail, and author URLs", async () => {
    render(
      <MemoryRouter initialEntries={["/extensions/plugins"]}>
        <PluginNavigation />
        <AppRoutes />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId("tools-view")).textContent).toBe(
      "/extensions/plugins",
    );
    fireEvent.click(screen.getByRole("button", { name: "detail" }));
    await waitFor(() => {
      expect(screen.getByTestId("tools-view").textContent).toBe(
        "/extensions/plugins/github",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "author" }));
    await waitFor(() => {
      expect(screen.getByTestId("tools-view").textContent).toBe(
        "/extensions/plugins/authors/pat%3Alee",
      );
    });

    expect(routeLifecycle).toEqual({
      mounts: 1,
      splitWorkspaceRenders: 0,
      unmounts: 0,
    });
  });
});
