import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("TestFlight review notes", () => {
  it("requires isolated reviewer access and explicit credential revocation", () => {
    const match = README.match(
      /## TestFlight testers\n([\s\S]*?)\n## Local state/u,
    );
    if (!match) throw new Error("TestFlight testers section is missing");

    const section = match[1]?.replace(/\s+/gu, " ");
    if (!section) throw new Error("TestFlight testers section is empty");
    expect(section).toContain("separate Connect account");
    expect(section).toContain("sanitized server");
    expect(section).toContain("sanitized test data");
    expect(section).toContain("limited provider credential");
    expect(section).toContain("does not revoke");
    expect(section).toContain("<https://getbb.app/dashboard>");
    expect(section).toContain("Machines → Revoke");
    expect(section).toContain("after every review");
  });
});
