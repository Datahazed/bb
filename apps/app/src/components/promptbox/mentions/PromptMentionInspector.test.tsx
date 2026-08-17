// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptMentionInspector } from "./PromptMentionInspector";

describe("PromptMentionInspector", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reopens the same provider item with preview and exact metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: "Invite member · Acme Team Settings",
            description: "Immutable captured context",
            preview: {
              kind: "image",
              dataUrl: "data:image/png;base64,aQ==",
              alt: "Invite member capture",
            },
            metadata: 'capture.element.selector = "button.invite"',
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const onOpenChange = vi.fn();
    const view = render(
      <PromptMentionInspector
        open
        onOpenChange={onOpenChange}
        pluginId="browser-context"
        itemId="captures:stable-id"
        label="Invite member"
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Invite member · Acme Team Settings",
      }),
    ).toBeDefined();
    expect(screen.getByAltText("Invite member capture")).toBeDefined();
    expect(screen.getByText(/capture\.element\.selector/u)).toBeDefined();
    expect(screen.getByRole("dialog").className).toContain("max-w-xl");
    expect(screen.getByRole("dialog").className).toContain("gap-0");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/plugins/mentions/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pluginId: "browser-context",
        itemId: "captures:stable-id",
      }),
      signal: expect.any(AbortSignal),
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    view.rerender(
      <PromptMentionInspector
        open={false}
        onOpenChange={onOpenChange}
        pluginId="browser-context"
        itemId="captures:stable-id"
        label="Invite member"
      />,
    );
    view.rerender(
      <PromptMentionInspector
        open
        onOpenChange={onOpenChange}
        pluginId="browser-context"
        itemId="captures:stable-id"
        label="Invite member"
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("shows an accurate loaded state when the provider omits a description", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: "Members table",
            metadata: 'capture.kind = "region"',
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <PromptMentionInspector
        open
        onOpenChange={vi.fn()}
        pluginId="browser-context"
        itemId="captures:stable-region"
        label="Members table"
      />,
    );

    expect(await screen.findByText("Captured mention details.")).toBeDefined();
    expect(screen.queryByText("Loading the captured context…")).toBeNull();
  });

  it("shows fades only at overflowing inspector scroll boundaries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: "Members table",
            metadata: Array.from(
              { length: 40 },
              (_, index) => `capture.target.${index + 1} = \"row\"`,
            ).join("\n"),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <PromptMentionInspector
        open
        onOpenChange={vi.fn()}
        pluginId="browser-context"
        itemId="captures:overflowing-region"
        label="Members table"
      />,
    );

    await screen.findByRole("heading", { name: "Members table" });
    const scroll = document.querySelector<HTMLElement>(
      '[data-mention-inspector-scroll="true"]',
    );
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll!, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    fireEvent.scroll(scroll!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-overflow-fade="below"]'),
      ).not.toBeNull(),
    );
    expect(document.querySelector('[data-overflow-fade="above"]')).toBeNull();

    scroll!.scrollTop = 120;
    fireEvent.scroll(scroll!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-overflow-fade="above"]'),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector('[data-overflow-fade="below"]'),
    ).not.toBeNull();

    scroll!.scrollTop = 300;
    fireEvent.scroll(scroll!);
    await waitFor(() =>
      expect(document.querySelector('[data-overflow-fade="below"]')).toBeNull(),
    );
    expect(
      document.querySelector('[data-overflow-fade="above"]'),
    ).not.toBeNull();
  });
});
