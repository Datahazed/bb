// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
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
      <MemoryRouter>
        <StrictMode>
          <AppLocalStateInitialization />
          <DraftRows />
        </StrictMode>
      </MemoryRouter>,
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

  it("prefers the launch route project and section over the stored project", () => {
    window.localStorage.setItem("bb.root-compose.project-id", "project-stored");
    window.localStorage.setItem(
      promptDraftSlotStorageKeysForTests.legacy,
      JSON.stringify({ text: "Route-owned draft", attachments: [] }),
    );

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/projects/project-route",
            state: { sectionId: "section-route" },
          },
        ]}
      >
        <AppLocalStateInitialization />
      </MemoryRouter>,
    );

    const migratedSlots = readNewThreadDraftSlots();
    expect(migratedSlots).toEqual([
      expect.objectContaining({
        destination: {
          projectId: "project-route",
          sectionId: "section-route",
        },
      }),
    ]);
    expect(
      window.localStorage.getItem(promptDraftSlotStorageKeysForTests.legacy),
    ).toBeNull();
    expect(readNewThreadDraftSlots()[0]?.destination).toEqual(
      migratedSlots[0]?.destination,
    );
  });
});
