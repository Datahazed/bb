import { describe, expect, it } from "vitest";
import { normalizeSkillSources } from "./runtime-skill-sources.js";

describe("normalizeSkillSources", () => {
  it("clones generic staged skill sources", () => {
    const source = {
      id: "catalog-1",
      rootPath: "/tmp/catalog-1",
      skills: [{ name: "review", description: "Review code" }],
    };
    const normalized = normalizeSkillSources([source]);

    expect(normalized).toEqual([source]);
    expect(normalized[0]).not.toBe(source);
    expect(normalized[0]?.skills).not.toBe(source.skills);
  });

  it("rejects relative package roots", () => {
    expect(() =>
      normalizeSkillSources([
        { id: "catalog-1", rootPath: "relative", skills: [] },
      ]),
    ).toThrow(
      'Agent runtime skill source "catalog-1" must use an absolute rootPath: relative',
    );
  });
});
