import type { SystemChangeKind } from "@bb/domain";
import type { ProviderModelListMemoValue } from "../../lifecycle-dedupers.js";
import type { AsyncTtlMemo } from "../lib/async-ttl-memo.js";

export function publishProviderModelsChanged(args: {
  providerModelList: AsyncTtlMemo<string, ProviderModelListMemoValue>;
  notifySystem(changes: SystemChangeKind[]): void;
}): void {
  args.providerModelList.clear();
  args.notifySystem(["provider-models-changed"]);
}
