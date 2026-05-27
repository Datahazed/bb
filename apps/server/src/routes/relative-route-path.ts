import path from "node:path";
import { ApiError } from "../errors.js";

export type DotfileSegmentPolicy = "allow" | "not-found";

export interface SafeRelativeRoutePath {
  relativePath: string;
}

export interface ParseSafeRelativeRoutePathArgs {
  dotfileSegmentPolicy: DotfileSegmentPolicy;
  invalidPathMessage: string;
  rawPath: string;
  directoryIndexPath?: string;
}

export interface DecodeRoutePathArgs {
  invalidPathMessage: string;
  rawPath: string;
}

export interface ExtractRoutePathArgs {
  requestUrl: string;
  routeSegment: string;
}

function createInvalidPathError(message: string): ApiError {
  return new ApiError(400, "invalid_path", message);
}

function createNotFoundError(relativePath: string): ApiError {
  return new ApiError(404, "ENOENT", `Path does not exist: ${relativePath}`);
}

export function decodeRoutePath(args: DecodeRoutePathArgs): string {
  try {
    return decodeURIComponent(args.rawPath);
  } catch {
    throw createInvalidPathError(args.invalidPathMessage);
  }
}

export function parseSafeRelativeRoutePath(
  args: ParseSafeRelativeRoutePathArgs,
): SafeRelativeRoutePath {
  const decodedPath = decodeRoutePath({
    rawPath: args.rawPath,
    invalidPathMessage: args.invalidPathMessage,
  });
  const relativePath =
    args.directoryIndexPath !== undefined && decodedPath.endsWith("/")
      ? `${decodedPath}${args.directoryIndexPath}`
      : decodedPath;

  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw createInvalidPathError(args.invalidPathMessage);
  }

  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw createInvalidPathError(args.invalidPathMessage);
  }

  if (
    args.dotfileSegmentPolicy === "not-found" &&
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw createNotFoundError(relativePath);
  }

  return {
    relativePath: segments.join("/"),
  };
}

export function extractRoutePath(args: ExtractRoutePathArgs): string {
  const requestPath = new URL(args.requestUrl).pathname;
  const routeSegmentIndex = requestPath.indexOf(args.routeSegment);
  if (routeSegmentIndex === -1) {
    return "";
  }
  return requestPath.slice(routeSegmentIndex + args.routeSegment.length);
}
