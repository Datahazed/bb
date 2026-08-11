import { describe, expect, it } from "vitest";
import {
  buildContinueEnvironmentLocationState,
  buildContinueEnvironmentPromptDraft,
  readContinueEnvironmentSeed,
} from "./continue-environment-request";

const seed = {
  branchName: "feature/preserved",
  hostId: "host_1",
  mergeBaseBranch: "origin/main",
  projectId: "proj_1",
  sourceEnvironmentId: "env_archived",
  sourceThreadId: "thr_archived",
  sourceThreadTitle: "Archived feature work",
};

describe("archived environment continuation navigation", () => {
  it("round-trips the compose seed and requests prompt focus", () => {
    const state = buildContinueEnvironmentLocationState(seed);

    expect(state).toMatchObject({ focusPrompt: true });
    expect(readContinueEnvironmentSeed(state)).toEqual(seed);
  });

  it("prefills a rich mention to the archived source thread", () => {
    const draft = buildContinueEnvironmentPromptDraft(seed);

    expect(draft.text).toBe("Continue from @thread:thr_archived");
    expect(draft.mentions).toEqual([
      {
        start: "Continue from ".length,
        end: "Continue from @thread:thr_archived".length,
        resource: {
          kind: "thread",
          label: "Archived feature work",
          projectId: "proj_1",
          threadId: "thr_archived",
        },
      },
    ]);
  });

  it("rejects incomplete freeform history state", () => {
    expect(
      readContinueEnvironmentSeed({
        continueEnvironment: { ...seed, mergeBaseBranch: "" },
      }),
    ).toBeNull();
    expect(
      readContinueEnvironmentSeed({
        continueEnvironment: { ...seed, sourceThreadId: "" },
      }),
    ).toBeNull();
  });
});
