// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HtmlPreviewView } from "./HtmlPreviewView";

describe("HtmlPreviewView", () => {
  it("keeps untrusted HTML inside a sandbox below permanent bb chrome", () => {
    const sourceUrl = "/api/v1/threads/thr_1/worktree/files/report.html";
    render(
      <MemoryRouter
        initialEntries={[`/html-preview?src=${encodeURIComponent(sourceUrl)}`]}
      >
        <HtmlPreviewView />
      </MemoryRouter>,
    );

    expect(screen.getByText("bb HTML preview")).toBeTruthy();
    expect(
      screen.getByText(/do not enter passwords or secrets/iu),
    ).toBeTruthy();
    const iframe = screen.getByTitle("Untrusted HTML preview");
    expect(iframe.getAttribute("src")).toBe(sourceUrl);
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });
});
