import type { PresenceSnapshotResponse } from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type PresenceGetResult = PresenceSnapshotResponse;

export interface PresenceArea {
  get(): Promise<PresenceGetResult>;
}

export function createPresenceArea(args: CreateSdkAreaArgs): PresenceArea {
  return {
    get() {
      return args.transport.readJson(args.transport.api.v1.presence.$get({}));
    },
  };
}
