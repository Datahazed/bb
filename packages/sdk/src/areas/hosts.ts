import type { Host } from "@bb/domain";
import type { CreateSdkAreaArgs } from "./common.js";

export interface HostGetArgs {
  hostId: string;
}

/**
 * Read-only wrappers over the live host routes. Single-host: `GET /hosts`
 * returns exactly one synthetic `'local'` host (plan §4.1). The mutation
 * routes (join/rename/delete) are runtime-stubbed on the server and have no
 * SDK wrappers.
 */
export interface HostsArea {
  get(args: HostGetArgs): Promise<Host>;
  list(): Promise<Host[]>;
}

export function createHostsArea(args: CreateSdkAreaArgs): HostsArea {
  const { transport } = args;
  return {
    async get(input) {
      return transport.readJson(
        transport.api.v1.hosts[":id"].$get({
          param: { id: input.hostId },
        }),
      );
    },
    async list() {
      return transport.readJson(transport.api.v1.hosts.$get());
    },
  };
}
