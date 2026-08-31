// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  promptDraftSlotStorageKeysForTests,
  readNewThreadDraftSlots,
} from "@/lib/prompt-draft-slots";
import { useNewThreadDraftSlots } from "@/hooks/useNewThreadDraftSlots";
import { AppLocalStateInitialization } from "./AppLocalStateInitialization";

function DraftRows() {
  const drafts = useNewThreadDraftSlots();
  return <output>{drafts.map((draft) => draft.title).join(", ")}</output>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AppLocalStateInitialization", () => {
  it("migrates the legacy shared composer draft at app boot", () => {
    window.localStorage.setItem(
      "bb.root-compose.project-id",
      "project-at-launch",
    );
    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      JSON.stringify({ text: "Never lose this draft", attachments: [] }),
    );

    render(
      <StrictMode>
        <AppLocalStateInitialization />
        <DraftRows />
      </StrictMode>,
    );

    expect(readNewThreadDraftSlots()).toEqual([
      expect.objectContaining({
        draft: {
          attachments: [],
          mentions: [],
          text: "Never lose this draft",
        },
        destination: {
          projectId: "project-at-launch",
          sectionId: null,
        },
      }),
    ]);
    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBeNull();
    expect(screen.getByText("Never lose this draft")).not.toBeNull();
  });
});
