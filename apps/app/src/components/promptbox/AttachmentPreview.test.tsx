// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentPreview } from "./AttachmentPreview";

afterEach(cleanup);

describe("AttachmentPreview", () => {
  it("renders a Browser capture as an image preview and removes either staged attachment", () => {
    const onRemoveAttachment = vi.fn();
    render(
      <AttachmentPreview
        attachments={[
          {
            type: "localImage",
            path: "uploads/browser-context-capture.png",
            name: "browser-context-capture.png",
            mimeType: "image/png",
            sizeBytes: 128,
          },
          {
            type: "localFile",
            path: "uploads/browser-context.json",
            name: "browser-context.json",
            mimeType: "application/json",
            sizeBytes: 512,
          },
        ]}
        attachmentProjectId="proj_test"
        expandedImageIndex={null}
        onExpandedImageIndexChange={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );

    expect(
      screen.getByRole("img", { name: "browser-context-capture.png" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove browser-context-capture.png",
      }),
    );
    fireEvent.click(screen.getByTitle("Remove browser-context.json"));

    expect(onRemoveAttachment.mock.calls).toEqual([
      ["uploads/browser-context-capture.png"],
      ["uploads/browser-context.json"],
    ]);
  });
});
