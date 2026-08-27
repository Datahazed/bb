import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyProjectAttachments,
  preparePromptAttachmentInputGroups,
  readAttachment,
  validatePromptAttachmentReferences,
} from "./attachments.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-attachments-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("project attachments", () => {
  it("reads attachments from inside the project attachment directory", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");
    const attachmentPath = join(attachmentDir, "notes.txt");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, "hello", "utf8");

    const result = await readAttachment(dataDir, "proj_test", "notes.txt");

    expect(result.content.toString("utf8")).toBe("hello");
    expect(result.mimeType).toBe("text/plain");
  });

  it("copies project-scoped attachments without changing their draft paths", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "image-uploaded.png"), "image bytes");

    await copyProjectAttachments(dataDir, "proj_source", "proj_target", [
      "image-uploaded.png",
    ]);

    const copied = await readAttachment(
      dataDir,
      "proj_target",
      "image-uploaded.png",
    );
    expect(copied.content.toString("utf8")).toBe("image bytes");
  });

  it("does not partially copy when one source attachment is missing", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "present.txt"), "present");

    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_target", [
        "present.txt",
        "missing.txt",
      ]),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      readAttachment(dataDir, "proj_target", "present.txt"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("accepts prompt attachment references to uploaded project files", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "notes-uploaded.txt"), "hello", "utf8");

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localFile", path: "notes-uploaded.txt" }],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects relative prompt attachment paths that were not uploaded", async () => {
    const dataDir = await makeTempDir();

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localFile", path: "alpha.txt" }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining(
          "relative workspace file paths are not valid attachment references",
        ),
      }),
    });
  });

  it("allows runtime-readable prompt attachment paths without upload validation", async () => {
    const dataDir = await makeTempDir();

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [
          { type: "localFile", path: "/tmp/workspace/alpha.txt" },
          { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
          { type: "localFile", path: "https://example.test/notes.txt" },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves uploaded and URL-like image references during prompt preparation", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "uploaded.png"), "uploaded bytes");
    const input = [
      { type: "localImage" as const, path: "uploaded.png" },
      { type: "localImage" as const, path: "https://example.test/image.png" },
      { type: "localImage" as const, path: "data:image/png;base64,aW1hZ2U=" },
      { type: "localImage" as const, path: "blob:https://example.test/id" },
      { type: "localFile" as const, path: "/remote/notes.txt" },
    ];

    await expect(
      preparePromptAttachmentInputGroups({
        dataDir,
        inputGroups: [input],
        projectId: "proj_test",
        readHostFile: async () => {
          throw new Error("URL-like and file inputs must not be imported");
        },
      }),
    ).resolves.toEqual([input]);
  });

  it("imports Windows absolute image paths with their original filename", async () => {
    const dataDir = await makeTempDir();
    const bytes = Buffer.from("remote image bytes");
    const absolutePath = "C:\\Users\\michael\\reference.png";

    const [prepared] = await preparePromptAttachmentInputGroups({
      dataDir,
      inputGroups: [[{ type: "localImage", path: absolutePath }]],
      projectId: "proj_test",
      readHostFile: async (path) => ({
        path,
        content: bytes.toString("base64"),
        contentEncoding: "base64",
        mimeType: "image/png",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
      }),
    });
    const image = prepared?.[0];
    expect(image?.type).toBe("localImage");
    if (image?.type !== "localImage") {
      throw new Error("Expected imported image input");
    }
    expect(image.path).toMatch(/^reference-\d+-[a-z0-9]{6}\.png$/u);
    await expect(
      readAttachment(dataDir, "proj_test", image.path),
    ).resolves.toMatchObject({ content: bytes, mimeType: "image/png" });
  });

  it("rejects POSIX traversal outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "../secret.txt"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects Windows-style traversal outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "..\\secret.txt"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects absolute paths outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "/etc/passwd"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects attachment paths that resolve to the attachment directory itself", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "."),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message:
          "Attachment path must refer to a file inside the project directory",
      }),
    });
  });

  it("treats percent-encoded traversal markers as literal file names", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "%2e%2e%2fsecret.txt"),
    ).rejects.toMatchObject({
      status: 404,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment not found",
      }),
    });
  });
});
