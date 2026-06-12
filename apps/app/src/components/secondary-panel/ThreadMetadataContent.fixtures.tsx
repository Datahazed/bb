import type { ReactNode } from "react";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import {
  makeEnvironment,
  makeThread,
  makeThreadSchedule,
  makeWorkspaceStatus,
} from "../../../.ladle/story-fixtures";
import type { ThreadMetadataContentProps } from "./ThreadMetadataContent";

// Re-export the shared builders so per-row stories in this folder can import
// from one place.
export {
  makeEnvironment,
  makeThread,
  makeThreadSchedule,
  makeWorkspaceStatus,
};

const noop = () => {};

export const localEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
};

export function PanelStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[480px] min-w-0 rounded-md border border-border bg-background px-4 py-3">
      {children}
    </div>
  );
}

export const baseProps: ThreadMetadataContentProps = {
  thread: makeThread(),
  environment: makeEnvironment(),
  environmentDisplayHost: localEnvironmentDisplayHost,
  workspaceStatus: makeWorkspaceStatus(),
  workspaceStatusError: null,
  pullRequest: null,
  selectedMergeBaseBranch: undefined,
  mergeBaseBranchOptions: ["main", "develop", "release/2026-04"],
  isLoadingMergeBaseBranchOptions: false,
  threadSchedules: [],
  onMergeBaseBranchChange: noop,
  onChangedFileClick: noop,
};
