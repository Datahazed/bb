import { Command } from "commander";
import { action, CliExitError } from "../action.js";

const REMOVED_MANAGER_COMMAND_MESSAGE = [
  "Manager commands were removed.",
  "Use `bb thread spawn` to start work,",
  "`bb thread list` to list threads,",
  "and `bb thread show <id>` to inspect a thread.",
].join(" ");

interface RemovedManagerCommandOptions {
  json?: boolean;
}

function throwRemovedManagerCommand(): never {
  throw new CliExitError(REMOVED_MANAGER_COMMAND_MESSAGE, 1);
}

function registerRemovedManagerSubcommand(
  manager: Command,
  nameAndArgs: string,
  description: string,
): void {
  manager
    .command(nameAndArgs)
    .description(description)
    .option("--json", "Print machine-readable JSON output")
    .action(action(async (_opts: RemovedManagerCommandOptions) => {
      throwRemovedManagerCommand();
    }));
}

export function registerManagerCommands(
  program: Command,
  _getUrl: () => string,
): void {
  const manager = program
    .command("manager")
    .description("Compatibility notice for removed manager commands")
    .action(action(async () => {
      throwRemovedManagerCommand();
    }));

  registerRemovedManagerSubcommand(
    manager,
    "hire [projectId]",
    "Manager commands were removed",
  );
  registerRemovedManagerSubcommand(
    manager,
    "list [projectId]",
    "Manager commands were removed",
  );
  registerRemovedManagerSubcommand(
    manager,
    "status <id>",
    "Manager commands were removed",
  );
  registerRemovedManagerSubcommand(
    manager,
    "delete <id>",
    "Manager commands were removed",
  );
}
