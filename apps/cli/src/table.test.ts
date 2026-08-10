import { describe, expect, it } from "vitest";
import { renderBorderlessTable } from "./table.js";

describe("renderBorderlessTable", () => {
  it("removes terminal control data and keeps each value on one line", () => {
    const rendered = renderBorderlessTable(
      { head: ["Mode", "Name"], colWidths: [14, 20] },
      [["safe\u001b]52;c;copied\u0007", "Primary\nAgent"]],
    );

    expect(rendered).not.toContain("\u001b");
    expect(rendered).not.toContain("copied");
    expect(rendered).toContain("safe");
    expect(rendered).toContain("Primary Agent");
    expect(rendered.split("\n")).toHaveLength(3);
  });
});
