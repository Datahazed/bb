/**
 * Engine command-result side-effect owners (relocated in P1c from the deleted
 * daemon-ingress command-results module). The durable-queue settlement wrapper
 * (`handleCommandResult`: stored-row lookup, active-attempt gating, row
 * terminalization) died with the queue — the dispatcher's
 * `settleCommandResult` is the only settlement entry point now.
 */
import type { DbNotifier } from "@bb/db";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectReport,
  type CommandResultSideEffectsDeps,
  type CommandResultSideEffectsResult,
  type SettledEngineCommand,
} from "./command-result-side-effects.js";
import { settleEnvironmentDestroyCommandResult } from "../environments/environment-cleanup-internal.js";
import {
  settleEnvironmentProvisionCancelCommandResult,
  settleEnvironmentProvisionCommandResult,
} from "../environments/environment-provisioning-internal.js";
import {
  settleThreadStartCommandResult,
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../threads/thread-lifecycle.js";
import { scheduleDetachedWork } from "../lib/detached-work.js";

type SettledCommandType = SettledEngineCommand["command"]["type"];
type SettledCommandForType<TType extends SettledCommandType> = Extract<
  SettledEngineCommand["command"],
  { type: TType }
>;

interface NotifyWorkspaceMutationResultArgs {
  environmentId: string;
  ok: boolean;
}

function notifyWorkspaceMutationResult(
  deps: { hub: Pick<DbNotifier, "notifyEnvironment"> },
  args: NotifyWorkspaceMutationResultArgs,
): void {
  if (!args.ok) {
    return;
  }
  deps.hub.notifyEnvironment(args.environmentId, ["work-status-changed"]);
}

// Command-result owners apply durable DB side effects inside the settlement
// transaction. Work that can dispatch or wait for another engine command must
// be returned as an explicit post-commit action.
interface ApplyCommandResultSideEffectsArgs<TType extends SettledCommandType> {
  command: SettledCommandForType<TType>;
  deps: CommandResultSettlementDeps;
  report: CommandResultReportForType<TType>;
  settledCommand: SettledEngineCommand;
}

interface CommandResultOwner<TType extends SettledCommandType> {
  applySideEffects?(
    args: ApplyCommandResultSideEffectsArgs<TType>,
  ): CommandResultSideEffectsResult | void;
}

type CommandResultOwnerRegistry = {
  [TType in SettledCommandType]: CommandResultOwner<TType> | null;
};

function reportMatchesCommandType<TType extends SettledCommandType>(
  command: SettledCommandForType<TType>,
  report: CommandResultSideEffectReport,
): report is CommandResultReportForType<TType> {
  return report.type === command.type;
}

const commandResultOwners: CommandResultOwnerRegistry = {
  "environment.cleanup_preflight": null,
  "environment.destroy": {
    applySideEffects: settleEnvironmentDestroyCommandResult,
  },
  "environment.provision": {
    applySideEffects: settleEnvironmentProvisionCommandResult,
  },
  "environment.provision.cancel": {
    applySideEffects: settleEnvironmentProvisionCancelCommandResult,
  },
  "host.write_file_relative": null,
  "host.delete_file_relative": null,
  "host.delete_path_relative": null,
  "codex.inference.complete": null,
  "interactive.resolve": {
    applySideEffects: ({ deps, command, report }) => {
      deps.pendingInteractions.settleInteractiveResolveCommandResultInTransaction(
        {
          command,
          deps,
          report,
        },
      );
    },
  },
  "thread.archive": null,
  "thread.deleted": null,
  "thread.rename": null,
  "thread.unarchive": null,
  "thread.start": {
    applySideEffects: settleThreadStartCommandResult,
  },
  "thread.stop": {
    applySideEffects: settleThreadStopCommandResult,
  },
  "turn.submit": {
    applySideEffects: settleTurnSubmitCommandResult,
  },
  "codex.voice.transcribe": null,
  "workspace.commit": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationResult(deps, {
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
  "workspace.squash_merge": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationResult(deps, {
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
} satisfies CommandResultOwnerRegistry;

function getCommandResultOwner<TType extends SettledCommandType>(
  command: SettledCommandForType<TType>,
): CommandResultOwner<TType> | null {
  return commandResultOwners[command.type];
}

export function handleCommandResultSideEffects(
  deps: CommandResultSettlementDeps,
  report: CommandResultSideEffectReport,
  settledCommand: SettledEngineCommand,
): CommandResultSideEffectsResult {
  const command = settledCommand.command;
  if (!reportMatchesCommandType(command, report)) {
    return emptyCommandResultSideEffects();
  }
  return (
    getCommandResultOwner(command)?.applySideEffects?.({
      deps,
      report,
      command,
      settledCommand,
    }) ?? emptyCommandResultSideEffects()
  );
}

type CommandResultPostCommitDispatchMode = "inline" | "detached";

interface DispatchCommandResultPostCommitActionsArgs {
  actions: readonly CommandResultPostCommitAction[];
  deps: CommandResultSideEffectsDeps;
  mode: CommandResultPostCommitDispatchMode;
  settledCommand: SettledEngineCommand;
}

async function runCommandResultPostCommitAction(
  deps: CommandResultSideEffectsDeps,
  action: CommandResultPostCommitAction,
): Promise<void> {
  await action.run(deps);
}

export async function dispatchCommandResultPostCommitActions(
  args: DispatchCommandResultPostCommitActionsArgs,
): Promise<void> {
  for (const action of args.actions) {
    if (args.mode === "inline") {
      await runCommandResultPostCommitAction(args.deps, action);
      continue;
    }

    scheduleDetachedWork({
      config: args.deps.config,
      context: {
        ...action.context,
        commandId: args.settledCommand.id,
        commandType: args.settledCommand.command.type,
      },
      logger: args.deps.logger,
      name: action.name,
      work: () => runCommandResultPostCommitAction(args.deps, action),
    });
  }
}
