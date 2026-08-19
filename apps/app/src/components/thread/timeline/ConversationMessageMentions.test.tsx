// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  messageBodyHasQuote,
  PromptMentionPill,
  renderMessageBodyWithQuotes,
} from "./ConversationMessageMentions";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PromptMentionPill", () => {
  it("opens the inspector from a sent inspectable plugin mention", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          inspection: {
            title: "Invite member · Acme Team Settings",
            metadata: 'capture.element.selector = "button.invite"',
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <PromptMentionPill
        resource={{
          kind: "plugin",
          pluginId: "browser-context",
          itemId: "captures:stable-id",
          label: "Invite member",
          experimentalInspectability: true,
        }}
        serializedText="@Invite member"
      />,
    );

    const pill = screen.getByRole("button", {
      name: /Inspect.*Invite member/u,
    });
    pill.focus();
    fireEvent.click(pill);
    expect(
      await screen.findByRole(
        "heading",
        {
          name: "Invite member · Acme Team Settings",
        },
        { timeout: 10_000 },
      ),
    ).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/mentions/inspect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          pluginId: "browser-context",
          itemId: "captures:stable-id",
        }),
      }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(pill));
  }, 15_000);
});

describe("messageBodyHasQuote", () => {
  it("detects blockquote lines", () => {
    expect(messageBodyHasQuote("> quoted")).toBe(true);
    expect(messageBodyHasQuote("reply\n> quoted")).toBe(true);
    expect(messageBodyHasQuote(">")).toBe(true);
    expect(messageBodyHasQuote("just text")).toBe(false);
    expect(messageBodyHasQuote("a > b is not a quote")).toBe(false);
  });
});

describe("renderMessageBodyWithQuotes", () => {
  it("renders a blockquote (prefix stripped) followed by a reply paragraph", () => {
    const { container } = render(
      <>
        {renderMessageBodyWithQuotes({
          mentions: [],
          text: "> first line\n> second line\nmy reply",
        })}
      </>,
    );

    const quote = container.querySelector("blockquote");
    expect(quote?.textContent).toBe("first line\nsecond line");

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("my reply");
  });

  it("keeps two separate quotes as separate blockquotes", () => {
    const { container } = render(
      <>
        {renderMessageBodyWithQuotes({
          mentions: [],
          text: "> a\n\n> b",
        })}
      </>,
    );
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
  });
});
