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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/mentions/inspect?pluginId=browser-context&itemId=captures%3Astable-id",
      { signal: expect.any(AbortSignal) },
    );

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
            description: null,
            preview: null,
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
});
