import type { GitCheckoutRef } from "@bb/domain";

const SHORT_SHA_LENGTH = 7;

export interface WorkspaceCheckoutCopyAction {
  accessibleLabel: string;
  errorMessage: string;
  label: string;
  successMessage: string;
  value: string;
}

export interface WorkspaceCheckoutDisplay {
  copyAction: WorkspaceCheckoutCopyAction | null;
  detailTooltip: string | null;
  label: string;
  rowLabel: "Branch" | "Commit" | "Git" | "Repository";
}

interface FormatWorkspaceCheckoutDisplayArgs {
  checkout: GitCheckoutRef;
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

export function formatWorkspaceCheckoutDisplay({
  checkout,
}: FormatWorkspaceCheckoutDisplayArgs): WorkspaceCheckoutDisplay {
  switch (checkout.kind) {
    case "branch":
      return {
        copyAction: {
          accessibleLabel: `Copy branch name: ${checkout.branchName}`,
          errorMessage: "Failed to copy branch name",
          label: "Copy branch name",
          successMessage: "Branch name copied",
          value: checkout.branchName,
        },
        detailTooltip: null,
        label: checkout.branchName,
        rowLabel: "Branch",
      };
    case "detached":
      if (checkout.headSha === null) {
        return {
          copyAction: null,
          detailTooltip: "Detached HEAD",
          label: "Detached HEAD",
          rowLabel: "Commit",
        };
      }
      return {
        copyAction: {
          accessibleLabel: `Copy commit SHA: ${checkout.headSha}`,
          errorMessage: "Failed to copy commit SHA",
          label: "Copy commit SHA",
          successMessage: "Commit SHA copied",
          value: checkout.headSha,
        },
        detailTooltip: null,
        label: `Detached at ${shortSha(checkout.headSha)}`,
        rowLabel: "Commit",
      };
    case "unborn":
      return {
        copyAction: null,
        detailTooltip:
          checkout.branchName !== null
            ? `Empty branch: ${checkout.branchName}`
            : "Empty repository",
        label:
          checkout.branchName !== null
            ? `${checkout.branchName} (empty)`
            : "empty repo",
        rowLabel: checkout.branchName !== null ? "Branch" : "Repository",
      };
    case "unknown":
      return {
        copyAction: null,
        detailTooltip: `Unknown Git state: ${checkout.reason}`,
        label: "unknown state",
        rowLabel: "Git",
      };
  }
}
