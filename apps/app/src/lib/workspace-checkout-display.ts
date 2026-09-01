import type { GitCheckoutRef } from "@bb/domain";

const SHORT_SHA_LENGTH = 7;

export interface WorkspaceCheckoutDisplay {
  copyErrorMessage: string | null;
  copyLabel: string | null;
  copySuccessMessage: string | null;
  copyValue: string | null;
  label: string;
  rowLabel: "Branch" | "Commit" | "Git" | "Repository";
  title: string;
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
        copyErrorMessage: "Failed to copy branch name",
        copyLabel: "Copy branch name",
        copySuccessMessage: "Branch name copied",
        copyValue: checkout.branchName,
        label: checkout.branchName,
        rowLabel: "Branch",
        title: checkout.branchName,
      };
    case "detached":
      if (checkout.headSha === null) {
        return {
          copyErrorMessage: null,
          copyLabel: null,
          copySuccessMessage: null,
          copyValue: null,
          label: "Detached HEAD",
          rowLabel: "Commit",
          title: "Detached HEAD",
        };
      }
      return {
        copyErrorMessage: "Failed to copy commit SHA",
        copyLabel: "Copy commit SHA",
        copySuccessMessage: "Commit SHA copied",
        copyValue: checkout.headSha,
        label: `Detached at ${shortSha(checkout.headSha)}`,
        rowLabel: "Commit",
        title: checkout.headSha,
      };
    case "unborn":
      return {
        copyErrorMessage: null,
        copyLabel: null,
        copySuccessMessage: null,
        copyValue: null,
        label:
          checkout.branchName !== null
            ? `${checkout.branchName} (empty)`
            : "empty repo",
        rowLabel: checkout.branchName !== null ? "Branch" : "Repository",
        title:
          checkout.branchName !== null
            ? `Empty branch: ${checkout.branchName}`
            : "Empty repository",
      };
    case "unknown":
      return {
        copyErrorMessage: null,
        copyLabel: null,
        copySuccessMessage: null,
        copyValue: null,
        label: "unknown state",
        rowLabel: "Git",
        title: `Unknown Git state: ${checkout.reason}`,
      };
  }
}
