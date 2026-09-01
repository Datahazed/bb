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
      copyLabel: "Copy branch name",
      copyValue: "bb/thread",
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
      copyLabel: "Copy commit SHA",
      copyValue: "abcdef1234567890",
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
      copyValue: null,
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
      copyValue: null,
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
      copyValue: null,
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
      copyValue: null,
      label: "unknown state",
      rowLabel: "Git",
    });
  });
});
