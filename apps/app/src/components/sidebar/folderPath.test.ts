import { describe, expect, it } from "vitest";
import {
  buildFolderKey,
  normalizeThreadTitle,
  parseThreadFolderPath,
  titleCreatesFolder,
} from "./folderPath";

describe("parseThreadFolderPath", () => {
  it("splits on '/', trims segments, and drops empties", () => {
    expect(parseThreadFolderPath("Work/Q3/Plan")).toEqual({
      folders: ["Work", "Q3"],
      leaf: "Plan",
    });
  });

  it("treats a single segment as a leaf with no folder", () => {
    expect(parseThreadFolderPath("Standalone")).toEqual({
      folders: [],
      leaf: "Standalone",
    });
  });

  it("collapses leading, trailing, and doubled slashes", () => {
    expect(parseThreadFolderPath("/Work//Q3/")).toEqual({
      folders: ["Work"],
      leaf: "Q3",
    });
  });

  it("trims whitespace around each segment", () => {
    expect(parseThreadFolderPath("Work / Q3 ")).toEqual({
      folders: ["Work"],
      leaf: "Q3",
    });
  });

  it("yields an empty path for an all-slashes or empty title", () => {
    expect(parseThreadFolderPath("///")).toEqual({ folders: [], leaf: "" });
    expect(parseThreadFolderPath("")).toEqual({ folders: [], leaf: "" });
  });
});

describe("normalizeThreadTitle", () => {
  it("re-joins normalized segments with '/'", () => {
    expect(normalizeThreadTitle("Work/Q3/Plan")).toBe("Work/Q3/Plan");
  });

  it("collapses leading, trailing, and doubled slashes", () => {
    expect(normalizeThreadTitle("/Work//Q3/")).toBe("Work/Q3");
  });

  it("trims whitespace around each segment", () => {
    expect(normalizeThreadTitle("Work / Q3 ")).toBe("Work/Q3");
  });

  it("leaves a single segment unchanged (after trimming)", () => {
    expect(normalizeThreadTitle(" Standalone ")).toBe("Standalone");
  });

  it("normalizes an all-slashes or empty title to an empty string", () => {
    expect(normalizeThreadTitle("///")).toBe("");
    expect(normalizeThreadTitle("")).toBe("");
  });

  it("is idempotent on already-normalized titles", () => {
    const normalized = normalizeThreadTitle("/Work//Q3/");
    expect(normalizeThreadTitle(normalized)).toBe(normalized);
  });
});

describe("titleCreatesFolder", () => {
  it("is false for a single segment", () => {
    expect(titleCreatesFolder("Standalone")).toBe(false);
  });

  it("is false when a trailing slash leaves a single segment", () => {
    expect(titleCreatesFolder("Work/")).toBe(false);
  });

  it("is false for an all-slashes title", () => {
    expect(titleCreatesFolder("///")).toBe(false);
  });

  it("is true once two or more segments survive normalization", () => {
    expect(titleCreatesFolder("Work/Q3")).toBe(true);
    expect(titleCreatesFolder("Work/Q3/")).toBe(true);
    expect(titleCreatesFolder("Clients/Acme/Onboarding")).toBe(true);
  });
});

describe("buildFolderKey", () => {
  it("namespaces a folder path by its container id", () => {
    expect(buildFolderKey("proj_bb", ["Work", "Q3"])).toBe(
      "proj_bb::Work/Q3",
    );
  });

  it("keeps same-named folders in different containers distinct", () => {
    expect(buildFolderKey("proj_a", ["Work"])).not.toBe(
      buildFolderKey("proj_b", ["Work"]),
    );
  });

  it("uses the global sentinels for the non-project sections", () => {
    expect(buildFolderKey("pinned", ["Work"])).toBe("pinned::Work");
    expect(buildFolderKey("chronological", ["Work"])).toBe(
      "chronological::Work",
    );
  });
});
