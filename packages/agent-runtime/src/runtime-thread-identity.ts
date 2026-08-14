import type { ThreadEvent } from "@bb/domain";
import type { AgentRuntimeProviderSession } from "./types.js";

export interface RuntimeProviderIdentityState {
  providerId: string;
  threadIds: Set<string>;
}

export interface CreateRuntimeProviderIdentityStateArgs {
  providerId: string;
}

export interface RegisterThreadProviderArgs {
  providerId: string;
  providerState: RuntimeProviderIdentityState;
  threadId: string;
}

export interface RecordProviderThreadIdentityArgs {
  providerThreadId: string;
  threadId: string;
}

export interface ForgetThreadArgs {
  providerState: RuntimeProviderIdentityState;
  threadId: string;
}

export interface ResolveProviderEventThreadIdArgs {
  eventThreadId: string | undefined;
  providerState: RuntimeProviderIdentityState;
  sourceThreadId: string | undefined;
}

export interface StampThreadEventScopeArgs {
  event: ThreadEvent;
  providerThreadId: string | undefined;
  threadId: string;
}

export class RuntimeThreadIdentityRegistry {
  private readonly threadToProvider = new Map<string, string>();
  private readonly threadToProviderThread = new Map<string, string>();

  createProviderState(
    args: CreateRuntimeProviderIdentityStateArgs,
  ): RuntimeProviderIdentityState {
    return {
      providerId: args.providerId,
      threadIds: new Set(),
    };
  }

  registerThreadProvider(args: RegisterThreadProviderArgs): void {
    this.threadToProvider.set(args.threadId, args.providerId);
    args.providerState.threadIds.add(args.threadId);
  }

  resolveProviderForThread(threadId: string): string {
    const providerId = this.threadToProvider.get(threadId);
    if (!providerId) {
      throw new Error(`No provider associated with thread "${threadId}"`);
    }
    return providerId;
  }

  getProviderThreadId(threadId: string): string | undefined {
    return this.threadToProviderThread.get(threadId);
  }

  getProviderSession(threadId: string): AgentRuntimeProviderSession | null {
    const providerId = this.threadToProvider.get(threadId);
    const providerThreadId = this.threadToProviderThread.get(threadId);
    if (!providerId || !providerThreadId) {
      return null;
    }
    return { providerId, providerThreadId };
  }

  recordProviderThreadIdentity(args: RecordProviderThreadIdentityArgs): void {
    this.threadToProviderThread.set(args.threadId, args.providerThreadId);
  }

  resolveProviderEventThreadId(
    args: ResolveProviderEventThreadIdArgs,
  ): string | undefined {
    if (
      args.sourceThreadId &&
      args.providerState.threadIds.has(args.sourceThreadId)
    ) {
      return args.sourceThreadId;
    }

    if (
      args.eventThreadId &&
      args.providerState.threadIds.has(args.eventThreadId)
    ) {
      return args.eventThreadId;
    }

    return undefined;
  }

  clearThread(threadId: string): void {
    this.threadToProvider.delete(threadId);
    this.threadToProviderThread.delete(threadId);
  }

  /** Fully detaches one thread from a still-running provider process. */
  forgetThread(args: ForgetThreadArgs): void {
    args.providerState.threadIds.delete(args.threadId);
    this.clearThread(args.threadId);
  }

  clearProviderState(providerState: RuntimeProviderIdentityState): void {
    for (const threadId of providerState.threadIds) {
      this.clearThread(threadId);
    }
    providerState.threadIds.clear();
  }
}

export function stampThreadEventScope(
  args: StampThreadEventScopeArgs,
): ThreadEvent {
  if ("providerThreadId" in args.event && args.providerThreadId) {
    return {
      ...args.event,
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
    };
  }

  return {
    ...args.event,
    threadId: args.threadId,
  };
}
