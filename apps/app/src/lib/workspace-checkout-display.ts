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
  rowLabel: "Branch" | "Checkout";
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
          label: "detached HEAD",
          rowLabel: "Checkout",
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
        label: `detached ${shortSha(checkout.headSha)}`,
        rowLabel: "Checkout",
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
        rowLabel: "Checkout",
      };
    case "unknown":
      return {
        copyAction: null,
        detailTooltip: `Unknown checkout: ${checkout.reason}`,
        label: "unknown checkout",
        rowLabel: "Checkout",
      };
  }
}
