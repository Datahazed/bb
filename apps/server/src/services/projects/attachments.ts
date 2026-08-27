// oxlint-disable-next-line no-restricted-imports
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
  win32,
} from "node:path";
import { resolveContainedPath } from "@bb/process-utils";
import type { PromptInput } from "@bb/domain";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import mimeTypes from "mime-types";
import { ApiError } from "../../errors.js";

const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_LIMIT_BYTES = 25 * 1024 * 1024;

const HEIF_IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

type PromptAttachmentInput = Extract<
  PromptInput,
  { type: "localFile" | "localImage" }
>;

interface ValidatePromptAttachmentReferencesArgs {
  dataDir: string;
  input: PromptInput[];
  projectId: string;
}

interface PreparePromptAttachmentInputGroupsArgs extends Omit<
  ValidatePromptAttachmentReferencesArgs,
  "input"
> {
  inputGroups: readonly PromptInput[][];
  readHostFile: (
    path: string,
  ) => Promise<HostDaemonOnlineRpcResultByType["host.read_file"]>;
}

type StoredPromptAttachmentType = "localFile" | "localImage";

interface StoreAttachmentBytesArgs {
  bytes: Uint8Array;
  dataDir: string;
  mimeType?: string;
  originalName: string;
  projectId: string;
  type: StoredPromptAttachmentType;
}

function sanitizeFilename(name: string): string {
  const base = basename(name.replaceAll("\\", "/")).replace(
    /[^a-zA-Z0-9._-]+/gu,
    "-",
  );
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

function pathLooksRuntimeReadable(rawPath: string): boolean {
  return (
    isAbsolute(rawPath) ||
    win32.isAbsolute(rawPath) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath)
  );
}

function shouldValidateProjectAttachmentReference(
  input: PromptInput,
): input is PromptAttachmentInput {
  if (input.type !== "localFile" && input.type !== "localImage") {
    return false;
  }
  return !pathLooksRuntimeReadable(input.path);
}

function missingAttachmentReferenceError(attachmentPath: string): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    `Attachment ${attachmentPath} was not uploaded for this project. Upload files with POST /api/v1/projects/:id/attachments and use the returned path in localFile/localImage prompt input; relative workspace file paths are not valid attachment references.`,
  );
}

async function ensureAttachmentReferenceExists(
  dataDir: string,
  projectId: string,
  attachmentPath: string,
): Promise<void> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, attachmentPath);
  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw missingAttachmentReferenceError(attachmentPath);
  }
}

export async function validatePromptAttachmentReferences(
  args: ValidatePromptAttachmentReferencesArgs,
): Promise<void> {
  for (const input of args.input) {
    if (!shouldValidateProjectAttachmentReference(input)) {
      continue;
    }
    await ensureAttachmentReferenceExists(
      args.dataDir,
      args.projectId,
      input.path,
    );
  }
}

function isHeifImageMimeType(rawMimeType: string | undefined): boolean {
  const mimeType = (rawMimeType?.split(";")[0] ?? "").trim().toLowerCase();
  return HEIF_IMAGE_MIME_TYPES.has(mimeType);
}

function attachmentSizeLimitBytes(type: StoredPromptAttachmentType): number {
  return type === "localImage" ? IMAGE_LIMIT_BYTES : FILE_LIMIT_BYTES;
}

async function storeAttachmentBytes(
  args: StoreAttachmentBytesArgs,
): Promise<UploadedPromptAttachment> {
  if (args.type === "localImage" && isHeifImageMimeType(args.mimeType)) {
    throw new ApiError(
      400,
      "invalid_request",
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.",
    );
  }
  const sizeLimit = attachmentSizeLimitBytes(args.type);
  if (args.bytes.byteLength > sizeLimit) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment exceeds ${Math.floor(sizeLimit / (1024 * 1024))}MB limit`,
    );
  }

  const dir = projectAttachmentDir(args.dataDir, args.projectId);
  await mkdir(dir, { recursive: true });

  const storedName = buildStoredFilename(args.originalName);
  await writeFile(join(dir, storedName), args.bytes);

  return {
    type: args.type,
    path: storedName,
    name: args.originalName,
    ...(args.mimeType ? { mimeType: args.mimeType } : {}),
    sizeBytes: args.bytes.byteLength,
  };
}

export async function storeAttachment(
  dataDir: string,
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  const isImage = (file.type || "").startsWith("image/");
  return storeAttachmentBytes({
    bytes: new Uint8Array(await file.arrayBuffer()),
    dataDir,
    mimeType: file.type || undefined,
    originalName: file.name,
    projectId,
    type: isImage ? "localImage" : "localFile",
  });
}

function absoluteHostPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path);
}

function originalNameFromHostPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "image";
}

function decodeHostFileBytes(
  result: HostDaemonOnlineRpcResultByType["host.read_file"],
): Uint8Array {
  const bytes = Buffer.from(result.content, result.contentEncoding);
  if (bytes.byteLength !== result.sizeBytes) {
    throw new ApiError(
      502,
      "attachment_size_mismatch",
      `Host image size mismatch: expected ${result.sizeBytes} bytes, received ${bytes.byteLength}`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== result.sha256) {
    throw new ApiError(
      502,
      "attachment_checksum_mismatch",
      "Host image checksum did not match the bytes received",
    );
  }
  return bytes;
}

/**
 * Turn host-readable image paths into server-owned project attachments before
 * prompt input is persisted. URL-like image inputs and existing uploaded
 * attachment references retain their established behavior.
 */
export async function preparePromptAttachmentInputGroups(
  args: PreparePromptAttachmentInputGroupsArgs,
): Promise<PromptInput[][]> {
  for (const input of args.inputGroups) {
    await validatePromptAttachmentReferences({
      dataDir: args.dataDir,
      input,
      projectId: args.projectId,
    });
  }

  const storedByHostPath = new Map<string, Promise<PromptInput>>();
  const prepareInput = async (input: PromptInput): Promise<PromptInput> => {
    if (input.type !== "localImage" || !absoluteHostPath(input.path)) {
      return input;
    }
    let stored = storedByHostPath.get(input.path);
    if (!stored) {
      stored = (async () => {
        const hostFile = await args.readHostFile(input.path);
        const mimeType =
          hostFile.mimeType || mimeTypes.lookup(input.path) || undefined;
        const attachment = await storeAttachmentBytes({
          bytes: decodeHostFileBytes(hostFile),
          dataDir: args.dataDir,
          ...(mimeType ? { mimeType } : {}),
          originalName: originalNameFromHostPath(input.path),
          projectId: args.projectId,
          type: "localImage",
        });
        return { type: "localImage", path: attachment.path };
      })();
      storedByHostPath.set(input.path, stored);
    }
    return stored;
  };

  return Promise.all(
    args.inputGroups.map((input) => Promise.all(input.map(prepareInput))),
  );
}

interface StoredAttachmentContent {
  content: Buffer;
  etag: string;
  mimeType?: string;
}

export async function readAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<StoredAttachmentContent> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const resolved = resolveAttachmentPath(dir, relativePath);

  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new ApiError(404, "invalid_request", "Attachment not found");
  }

  return {
    content: await readFile(resolved),
    etag: `"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`,
    mimeType: mimeTypes.lookup(resolved) || undefined,
  };
}

export async function copyProjectAttachments(
  dataDir: string,
  sourceProjectId: string,
  targetProjectId: string,
  attachmentPaths: readonly string[],
): Promise<void> {
  if (sourceProjectId === targetProjectId || attachmentPaths.length === 0) {
    return;
  }

  const uniquePaths = [...new Set(attachmentPaths)];
  const targetDir = projectAttachmentDir(dataDir, targetProjectId);
  const attachments = await Promise.all(
    uniquePaths.map(async (attachmentPath) => ({
      content: (await readAttachment(dataDir, sourceProjectId, attachmentPath))
        .content,
      targetPath: resolveAttachmentPath(targetDir, attachmentPath),
    })),
  );

  await Promise.all(
    attachments.map(async ({ content, targetPath }) => {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    }),
  );
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
