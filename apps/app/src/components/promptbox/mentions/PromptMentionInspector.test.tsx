// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptMentionInspector } from "./PromptMentionInspector";

describe("PromptMentionInspector", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reopens the same provider item with its screenshot and comments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: "Invite member",
            description: "2 comments",
            experimental_preview: {
              kind: "image",
              dataUrl: "data:image/png;base64,aQ==",
              alt: "Invite member capture",
            },
            comments: [
              "Keep this action prominent.",
              "Match the neighboring button height.",
            ],
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
        name: "Invite member",
      }),
    ).toBeDefined();
    const commentCount = screen.getByText("2 comments");
    expect(commentCount).toBeDefined();
    expect(
      commentCount.getAttribute("data-mention-inspector-comment-count"),
    ).toBe("true");
    expect(commentCount.className).toContain("rounded-full");
    expect(
      commentCount.parentElement?.contains(
        screen.getByRole("heading", { name: "Invite member" }),
      ),
    ).toBe(true);
    expect(screen.getByAltText("Invite member capture")).toBeDefined();
    const comments = screen.getByRole("list", { name: "Comments" });
    expect(comments).toBeDefined();
    const commentItems = comments.querySelectorAll(
      '[data-mention-inspector-comment="true"]',
    );
    expect(commentItems).toHaveLength(2);
    expect(commentItems[0]?.className).toContain("bg-muted/70");
    expect(commentItems[0]?.textContent).toContain(
      "1Keep this action prominent.",
    );
    expect(commentItems[1]?.textContent).toContain(
      "2Match the neighboring button height.",
    );
    expect(screen.queryByText(/capture\.element\.selector/u)).toBeNull();
    expect(screen.queryByText("Captured metadata")).toBeNull();
    const inspectorDialog = screen.getByRole("dialog");
    expect(inspectorDialog.className).toContain("max-w-lg");
    expect(inspectorDialog.className).toContain("gap-0");
    expect(inspectorDialog.className).toContain("[&>button]:focus:ring-0");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/plugins/mentions/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pluginId: "browser-context",
        itemId: "captures:stable-id",
      }),
      signal: expect.any(AbortSignal),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open full-size screenshot: Invite member capture",
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Screenshot preview: Invite member",
      }),
    ).toBeDefined();
    const closePreview = screen.getByRole("button", {
      name: "Close image preview",
    });
    const imageFrame = closePreview.closest(
      '[data-image-lightbox-frame="true"]',
    );
    expect(imageFrame).not.toBeNull();
    expect(imageFrame?.className).toContain("relative");
    expect(imageFrame?.className).not.toContain("gap-2");
    expect(closePreview.className).toContain("absolute");
    expect(closePreview.className).toContain("right-0");
    expect(closePreview.className).toContain("top-0");
    const expandedImage = imageFrame?.querySelector("img");
    expect(expandedImage?.getAttribute("alt")).toBe("Invite member capture");
    expect(closePreview.previousElementSibling).toBe(expandedImage);
    expect(expandedImage?.className).toContain("max-w-[90vw]");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Close image preview" }),
      ).toBeNull(),
    );
    expect(onOpenChange).not.toHaveBeenCalled();

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

  it("keeps a screenshot-only inspection lightweight when there are no comments", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: "Members table",
            experimental_preview: {
              kind: "image",
              dataUrl: "data:image/png;base64,aQ==",
              alt: "Members table capture",
            },
            comments: [],
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
        itemId="captures:no-comments"
        label="Members table"
      />,
    );

    expect(await screen.findByText("0 comments")).toBeDefined();
    expect(screen.getByAltText("Members table capture")).toBeDefined();
    expect(screen.queryByRole("list", { name: "Comments" })).toBeNull();
    expect(screen.queryByText("Captured metadata")).toBeNull();
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

  it("keeps long content and many comments inside one keyboard-scrollable region", async () => {
    const comments = Array.from({ length: 24 }, (_, index) =>
      index === 7
        ? `Keep ${"this-unbroken-reference-".repeat(16)} visible in the compact layout.`
        : index === 15
          ? "Keep the primary action clear.\nThe secondary note should stay on its own line."
          : `Review note ${index + 1} for this selected region.`,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: `Members table ${"with a very long nested settings heading ".repeat(6)}`,
            experimental_preview: {
              kind: "image",
              dataUrl: "data:image/png;base64,aQ==",
              alt: "Members table capture",
            },
            comments,
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
        itemId="captures:many-comments"
        label="Members table"
      />,
    );

    expect(await screen.findByText("24 comments")).toBeDefined();
    const longTitle = screen.getByRole("heading", {
      name: /Members table with a very long nested settings heading/u,
    });
    expect(longTitle.parentElement?.textContent).toContain("24 comments");
    const scroll = screen.getByRole("region", { name: "Mention details" });
    expect(scroll.getAttribute("tabindex")).toBe("0");
    expect(scroll.className).toContain("overscroll-contain");
    expect(scroll.className).toContain("[scrollbar-gutter:stable]");

    const commentItems = screen
      .getByRole("list", { name: "Comments" })
      .querySelectorAll('[data-mention-inspector-comment="true"]');
    expect(commentItems).toHaveLength(24);
    const longComment = screen.getByText(/this-unbroken-reference/u);
    expect(longComment.className).toContain("min-w-0");
    expect(longComment.className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText(/secondary note/u).textContent).toContain("\n");

    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 900 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent.scroll(scroll);
    await waitFor(() =>
      expect(
        document.querySelector('[data-overflow-fade="below"]'),
      ).not.toBeNull(),
    );

    scroll.scrollTop = 660;
    fireEvent.scroll(scroll);
    await waitFor(() =>
      expect(document.querySelector('[data-overflow-fade="below"]')).toBeNull(),
    );
    expect(
      document.querySelector('[data-overflow-fade="above"]'),
    ).not.toBeNull();
  });
});
