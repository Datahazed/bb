// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentPreview } from "./AttachmentPreview";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: {
      attachments: {
        read: mocks.read,
        upload: mocks.upload,
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttachmentPreview", () => {
  it("renders image and file cards and removes either staged attachment", () => {
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
            path: "uploads/notes.txt",
            name: "notes.txt",
            mimeType: "text/plain",
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
    expect(screen.getByText("notes.txt")).toBeDefined();
    expect(
      screen.queryByText("notes.txt")?.closest(".rounded-full"),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove browser-context-capture.png",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));

    expect(onRemoveAttachment.mock.calls).toEqual([
      ["uploads/browser-context-capture.png"],
      ["uploads/notes.txt"],
    ]);
  });

  it("previews, opens, edits, and replaces a Markdown attachment", async () => {
    const source = [
      "# Browser selection",
      "",
      "## Comment",
      "",
      "Make this action clearer",
      "",
      "## Target",
      "",
      '- Selector: "button#save"',
      "",
    ].join("\n");
    mocks.read.mockResolvedValue({
      bytes: new TextEncoder().encode(source),
      mimeType: "text/markdown",
      sizeBytes: source.length,
    });
    mocks.upload.mockResolvedValue({
      type: "localFile",
      path: "uploads/browser-context-edited.md",
      name: "browser-context.md",
      mimeType: "text/markdown",
      sizeBytes: source.length + 8,
    });
    const onReplaceAttachment = vi.fn();
    render(
      <AttachmentPreview
        attachments={[
          {
            type: "localFile",
            path: "uploads/browser-context.md",
            name: "browser-context.md",
            mimeType: "text/markdown",
            sizeBytes: source.length,
          },
        ]}
        attachmentProjectId="proj_test"
        expandedImageIndex={null}
        onExpandedImageIndexChange={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onReplaceAttachment={onReplaceAttachment}
      />,
    );

    await screen.findByText("Make this action clearer");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open and edit browser-context.md",
      }),
    );
    const editor = screen.getByRole("textbox", {
      name: "Edit browser-context.md",
    });
    expect((editor as HTMLTextAreaElement).value).toBe(source);
    const edited = source.replace("clearer", "more prominent");
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "Save attachment" }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    const uploadInput = mocks.upload.mock.calls[0]?.[0] as {
      clientFile: Blob;
      filename: string;
      mimeType: string;
      projectId: string;
    };
    expect(uploadInput).toMatchObject({
      filename: "browser-context.md",
      mimeType: "text/markdown",
      projectId: "proj_test",
    });
    expect(await uploadInput.clientFile.text()).toBe(edited);
    expect(onReplaceAttachment).toHaveBeenCalledWith(
      "uploads/browser-context.md",
      expect.objectContaining({
        path: "uploads/browser-context-edited.md",
        type: "localFile",
      }),
    );
  });
});
