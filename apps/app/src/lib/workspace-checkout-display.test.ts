import { describe, expect, it } from "vitest";
import { formatWorkspaceCheckoutDisplay } from "./workspace-checkout-display";

describe("formatWorkspaceCheckoutDisplay", () => {
  it("formats a branch checkout as a copyable branch label", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "branch",
          branchName: "bb/thread",
          headSha: "1234567890abcdef",
        },
      }),
    ).toMatchObject({
      copyAction: {
        accessibleLabel: "Copy branch name: bb/thread",
        label: "Copy branch name",
        value: "bb/thread",
      },
      detailTooltip: null,
      label: "bb/thread",
      rowLabel: "Branch",
    });
  });

  it("formats detached HEAD with a short SHA label and copyable full SHA", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: "abcdef1234567890",
        },
      }),
    ).toMatchObject({
      copyAction: {
        accessibleLabel: "Copy commit SHA: abcdef1234567890",
        label: "Copy commit SHA",
        value: "abcdef1234567890",
      },
      detailTooltip: null,
      label: "Detached at abcdef1",
      rowLabel: "Commit",
    });
  });

  it("formats detached HEAD without a SHA", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: null,
        },
      }),
    ).toMatchObject({
      copyAction: null,
      detailTooltip: "Detached HEAD",
      label: "Detached HEAD",
      rowLabel: "Commit",
    });
  });

  it("formats an unborn checkout with a branch name", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unborn",
          branchName: "main",
        },
      }),
    ).toMatchObject({
      copyAction: null,
      detailTooltip: "Empty branch: main",
      label: "main (empty)",
      rowLabel: "Branch",
    });
  });

  it("formats an unborn checkout without a branch name", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unborn",
          branchName: null,
        },
      }),
    ).toMatchObject({
      copyAction: null,
      detailTooltip: "Empty repository",
      label: "empty repo",
      rowLabel: "Repository",
    });
  });

  it("formats an unknown checkout", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unknown",
          reason: "HEAD is missing",
        },
      }),
    ).toMatchObject({
      copyAction: null,
      detailTooltip: "Unknown Git state: HEAD is missing",
      label: "unknown state",
      rowLabel: "Git",
    });
  });
});
