import type { Member } from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface MemberAddArgs {
  handle: string;
}

export interface MemberRemoveArgs {
  handle: string;
}

export type MemberListResult = Member[];
export type MemberAddResult = Member;
export type MemberRemoveResult = { ok: true };

export interface MembersArea {
  add(args: MemberAddArgs): Promise<MemberAddResult>;
  list(): Promise<MemberListResult>;
  remove(args: MemberRemoveArgs): Promise<MemberRemoveResult>;
}

export function createMembersArea(args: CreateSdkAreaArgs): MembersArea {
  const { transport } = args;
  return {
    async add(input) {
      return transport.readJson(
        transport.api.v1.members.$post({ json: { handle: input.handle } }),
      );
    },
    async list() {
      const response = await transport.readJson(
        transport.api.v1.members.$get({}),
      );
      return response.members;
    },
    async remove(input) {
      return transport.readJson(
        transport.api.v1.members.$delete({ json: { handle: input.handle } }),
      );
    },
  };
}
