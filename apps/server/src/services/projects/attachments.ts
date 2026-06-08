// For now, we store attachments on the server's local file system.
// We might move this to something like R2 or S3 in the future.
// eslint-disable-next-line no-restricted-imports
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";
import { resolveContainedPath } from "@bb/process-utils";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import mimeTypes from "mime-types";
import { ApiError } from "../../errors.js";

const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_LIMIT_BYTES = 25 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-");
  return base.length > 0 ? base : "attachment";
}

function buildStoredFilename(originalName: string): string {
  const sanitized = sanitizeFilename(originalName);
  const extension = extname(sanitized);
  const stem =
    extension.length > 0 ? sanitized.slice(0, -extension.length) : sanitized;
  return `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
}

function projectAttachmentDir(dataDir: string, projectId: string): string {
  return join(dataDir, "attachments", projectId);
}

function resolveAttachmentPath(
  attachmentDir: string,
  relativePath: string,
): string {
  const normalizedRelativePath = normalize(relativePath.replaceAll("\\", "/"));
  const resolvedAttachmentDir = resolve(attachmentDir);
  const resolvedCandidatePath = resolve(
    resolvedAttachmentDir,
    normalizedRelativePath,
  );

  if (resolvedCandidatePath === resolvedAttachmentDir) {
    throw new ApiError(
      400,
      "invalid_request",
      "Attachment path must refer to a file inside the project directory",
    );
  }

  const resolvedPath = resolveContainedPath({
    rootPath: resolvedAttachmentDir,
    candidatePath: resolvedCandidatePath,
  });

  if (resolvedPath) {
    return resolvedPath;
  }

  throw new ApiError(
    400,
    "invalid_request",
    "Attachment path escapes project directory",
  );
}

export async function storeAttachment(
  dataDir: string,
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  const isImage = (file.type || "").startsWith("image/");
  const sizeLimit = isImage ? IMAGE_LIMIT_BYTES : FILE_LIMIT_BYTES;
  if (file.size > sizeLimit) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment exceeds ${Math.floor(sizeLimit / (1024 * 1024))}MB limit`,
    );
  }

  const dir = projectAttachmentDir(dataDir, projectId);
  await mkdir(dir, { recursive: true });

  const storedName = buildStoredFilename(file.name);
  const outputPath = join(dir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(outputPath, bytes);

  return {
    type: isImage ? "localImage" : "localFile",
    path: storedName,
    name: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
  };
}

export async function readAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<{ content: Buffer; mimeType?: string }> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, relativePath);

  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new ApiError(404, "invalid_request", "Attachment not found");
  }

  return {
    content: await readFile(resolved),
    mimeType: mimeTypes.lookup(resolved) || undefined,
  };
}

interface AttachmentReadLimits {
  expectedSizeBytes?: number;
  maxBytes: number;
}

/**
 * Bounded variant of `readAttachment` for the engine's attachment staging
 * (engine port `fetchProjectAttachment`): enforces the size budget against
 * the file's stat *before* reading, so an oversized attachment is rejected
 * without buffering it into memory — the in-process replacement for the
 * daemon's mid-stream limit enforcement.
 */
export async function readAttachmentWithinLimit(
  dataDir: string,
  projectId: string,
  relativePath: string,
  limits: AttachmentReadLimits,
): Promise<Buffer> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, relativePath);

  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new ApiError(404, "invalid_request", "Attachment not found");
  }
  if (
    limits.expectedSizeBytes !== undefined &&
    fileStat.size !== limits.expectedSizeBytes
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment size mismatch: expected ${limits.expectedSizeBytes} bytes, found ${fileStat.size}`,
    );
  }
  if (fileStat.size > limits.maxBytes) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment exceeds ${limits.maxBytes} byte limit`,
    );
  }

  return readFile(resolved);
}

export async function deleteProjectAttachments(
  dataDir: string,
  projectId: string,
): Promise<void> {
  await rm(projectAttachmentDir(dataDir, projectId), {
    force: true,
    recursive: true,
  });
}
