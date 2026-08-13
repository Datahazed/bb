import { readFileSync } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";
import { mimeTypeFromExtension } from "../shared/mime-types.js";

export interface ExtractedPiPromptInput {
  text?: string;
  images: ImageContent[];
}

/** Converts canonical BB prompt inputs into the text/images accepted by Pi. */
export function extractPiPromptInput(input: unknown): ExtractedPiPromptInput {
  if (typeof input === "string") return { text: input, images: [] };
  if (!Array.isArray(input)) return { images: [] };

  const chunks: string[] = [];
  const images: ImageContent[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      chunks.push(item.text);
      continue;
    }
    if (
      "type" in item &&
      item.type === "localImage" &&
      "path" in item &&
      typeof item.path === "string"
    ) {
      try {
        const data = readFileSync(item.path).toString("base64");
        const mimeType =
          "mimeType" in item && typeof item.mimeType === "string"
            ? item.mimeType
            : mimeTypeFromExtension(item.path);
        images.push({ type: "image", data, mimeType });
      } catch {
        // Preserve current driver behavior: unreadable images are skipped.
      }
    }
  }

  return {
    text: chunks.length > 0 ? chunks.join("\n") : undefined,
    images,
  };
}
