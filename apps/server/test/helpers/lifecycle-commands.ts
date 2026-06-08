/**
 * Seeds lifecycle op rows and dispatches the matching engine command through
 * the harness's dispatch shim — the engine-seam replacement for writing
 * durable-queue rows. The dispatch is held in flight by `TestEngineRouting`
 * until the test settles it via `reportQueuedCommandSuccess`/`Error`.
 */
import { createEnvironmentProvisioningId } from "@bb/db";
import {
  markEnvironmentOperationRecordQueued,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import {
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "@bb/db/internal-lifecycle";
import type { EnvironmentOperationKind, ThreadOperationKind } from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { buildDirectEnvironmentProvisionRequest } from "../../src/services/environments/environment-provision-request.js";
import type { TestAppHarness } from "./test-app.js";

type EnvironmentDestroyCommand = Extract<
  HostDaemonCommand,
  { type: "environment.destroy" }
>;
type EnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision" }
>;
type ThreadStartCommand = Extract<HostDaemonCommand, { type: "thread.start" }>;
type ThreadStopCommand = Extract<HostDaemonCommand, { type: "thread.stop" }>;

export interface DispatchedLifecycleCommand {
  id: string;
}

interface QueueEnvironmentLifecycleCommandArgs {
  command: EnvironmentDestroyCommand | EnvironmentProvisionCommand;
  environmentId: string;
  kind: Extract<
    EnvironmentOperationKind,
    "destroy" | "provision" | "reprovision"
  >;
  operationPayload: string;
}

interface QueueThreadLifecycleCommandArgs {
  command: ThreadStartCommand | ThreadStopCommand;
  kind: ThreadOperationKind;
  threadId: string;
}

function queueEnvironmentLifecycleCommand(
  harness: TestAppHarness,
  args: QueueEnvironmentLifecycleCommandArgs,
): DispatchedLifecycleCommand {
  const dispatch = harness.deps.engineDispatch.dispatch({
    command: args.command,
  });

  upsertEnvironmentOperationRecord(harness.db, {
    environmentId: args.environmentId,
    kind: args.kind,
    payload: args.operationPayload,
  });
  markEnvironmentOperationRecordQueued(harness.db, {
    environmentId: args.environmentId,
    kind: args.kind,
    commandId: dispatch.commandId,
  });

  return { id: dispatch.commandId };
}

function queueThreadLifecycleCommand(
  harness: TestAppHarness,
  args: QueueThreadLifecycleCommandArgs,
): DispatchedLifecycleCommand {
  const dispatch = harness.deps.engineDispatch.dispatch({
    command: args.command,
  });

  upsertThreadOperationRecord(harness.db, {
    threadId: args.threadId,
    kind: args.kind,
    payload: JSON.stringify(args.command),
  });
  markThreadOperationRecordQueued(harness.db, {
    threadId: args.threadId,
    kind: args.kind,
    commandId: dispatch.commandId,
  });

  return { id: dispatch.commandId };
}

export function queueEnvironmentProvisionLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<
    QueueEnvironmentLifecycleCommandArgs,
    "kind" | "operationPayload"
  > & {
    command: EnvironmentProvisionCommand;
    kind?: Extract<EnvironmentOperationKind, "provision" | "reprovision">;
  },
): DispatchedLifecycleCommand {
  return queueEnvironmentLifecycleCommand(harness, {
    ...args,
    kind: args.kind ?? "provision",
    operationPayload: JSON.stringify(
      buildDirectEnvironmentProvisionRequest({
        command: args.command,
        provisioningId:
          args.command.initiator?.provisioningId ??
          createEnvironmentProvisioningId(),
      }),
    ),
  });
}

export function queueEnvironmentDestroyLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<
    QueueEnvironmentLifecycleCommandArgs,
    "kind" | "operationPayload"
  > & {
    command: EnvironmentDestroyCommand;
  },
): DispatchedLifecycleCommand {
  return queueEnvironmentLifecycleCommand(harness, {
    ...args,
    kind: "destroy",
    operationPayload: JSON.stringify(args.command),
  });
}

export function queueThreadStartLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<QueueThreadLifecycleCommandArgs, "kind"> & {
    command: ThreadStartCommand;
  },
): DispatchedLifecycleCommand {
  return queueThreadLifecycleCommand(harness, {
    ...args,
    kind: "start",
  });
}

export function queueThreadStopLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<QueueThreadLifecycleCommandArgs, "kind"> & {
    command: ThreadStopCommand;
  },
): DispatchedLifecycleCommand {
  return queueThreadLifecycleCommand(harness, {
    ...args,
    kind: "stop",
  });
}
