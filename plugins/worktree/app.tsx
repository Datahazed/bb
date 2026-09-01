import {
  definePluginApp,
  experimental_BranchPicker as BranchPicker,
} from "@get-bb/plugin-sdk/app";

interface WorktreeConfigurationView {
  hostId: string;
  branchName: string | null;
}

function readConfiguration(value: unknown): WorktreeConfigurationView | null {
  if (typeof value !== "object" || value === null) return null;
  const hostId = Reflect.get(value, "hostId");
  if (typeof hostId !== "string" || hostId.length === 0) return null;
  const baseBranch: unknown = Reflect.get(value, "baseBranch");
  if (typeof baseBranch === "object" && baseBranch !== null) {
    const kind = Reflect.get(baseBranch, "kind");
    const name = Reflect.get(baseBranch, "name");
    if (kind === "named" && typeof name === "string" && name.length > 0) {
      return { hostId, branchName: name };
    }
  }
  return { hostId, branchName: null };
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentTargetConfiguration({
    targetId: "worktree",
    component: ({ projectId, value, onChange }) => {
      const configuration = readConfiguration(value);
      return (
        <BranchPicker
          hostId={configuration?.hostId ?? null}
          projectId={projectId}
          value={configuration?.branchName ?? null}
          onChange={(name) => {
            if (configuration === null) return;
            onChange({
              hostId: configuration.hostId,
              baseBranch: name
                ? { kind: "named", name }
                : { kind: "default" },
            });
          }}
        />
      );
    },
  });
});
