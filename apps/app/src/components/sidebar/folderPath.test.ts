import { describe, expect, it } from "vitest";
import {
  buildFolderKey,
  folderAncestorKeys,
  normalizeFolderPath,
  parseThreadFolderShortcut,
  splitFolderPath,
  titleCreatesFolder,
} from "./folderPath";

describe("splitFolderPath", () => {
  it("splits on '/', trims segments, and drops empties", () => {
    expect(splitFolderPath("Work/Q3")).toEqual(["Work", "Q3"]);
    expect(splitFolderPath("/Work//Q3/")).toEqual(["Work", "Q3"]);
    expect(splitFolderPath(" Work / Q3 ")).toEqual(["Work", "Q3"]);
  });

  it("returns an empty path for nullish or empty values", () => {
    expect(splitFolderPath(null)).toEqual([]);
    expect(splitFolderPath(undefined)).toEqual([]);
    expect(splitFolderPath("///")).toEqual([]);
    expect(splitFolderPath("")).toEqual([]);
  });
});

describe("normalizeFolderPath", () => {
  it("normalizes paths to slash-separated segments", () => {
    expect(normalizeFolderPath("Work / Q3 ")).toBe("Work/Q3");
  });

  it("normalizes empty paths to null", () => {
    expect(normalizeFolderPath("///")).toBeNull();
    expect(normalizeFolderPath(null)).toBeNull();
  });
});

describe("parseThreadFolderShortcut", () => {
  it("splits an explicit slash rename into folderPath and title", () => {
    expect(parseThreadFolderShortcut("Work/Q3/Plan")).toEqual({
      folderPath: "Work/Q3",
      title: "Plan",
    });
  });

  it("keeps slashy titles literal when they do not define a folder and leaf", () => {
    expect(parseThreadFolderShortcut("Standalone")).toEqual({
      folderPath: null,
      title: "Standalone",
    });
    expect(parseThreadFolderShortcut("Work/")).toEqual({
      folderPath: null,
      title: "Work/",
    });
  });

  it("collapses leading, trailing, and doubled slashes in explicit paths", () => {
    expect(parseThreadFolderShortcut("/Work//Q3/Plan/")).toEqual({
      folderPath: "Work/Q3",
      title: "Plan",
    });
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
    expect(buildFolderKey("proj_bb", ["Work", "Q3"])).toBe("proj_bb::Work/Q3");
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

describe("folderAncestorKeys", () => {
  it("returns every ancestor folder key, outermost first", () => {
    expect(folderAncestorKeys("proj_1", "Work/Q3")).toEqual([
      "proj_1::Work",
      "proj_1::Work/Q3",
    ]);
  });

  it("returns no keys for no folder path", () => {
    expect(folderAncestorKeys("proj_1", null)).toEqual([]);
    expect(folderAncestorKeys("proj_1", "")).toEqual([]);
  });

  it("namespaces by container, including the global sentinels", () => {
    expect(folderAncestorKeys("pinned", "A/B")).toEqual([
      "pinned::A",
      "pinned::A/B",
    ]);
  });
});
