import {
  availableModelSchema,
  availableProviderModeSchema,
  type AvailableModel,
  type AvailableProviderMode,
} from "@bb/domain";
import { z } from "zod";

const modelListResultSchema = z.object({
  models: z.array(availableModelSchema),
  modes: z.array(availableProviderModeSchema).default([]),
  selectedOnlyModels: z.array(availableModelSchema),
});

export interface ParsedModelListResult {
  models: AvailableModel[];
  modes: AvailableProviderMode[];
  selectedOnlyModels: AvailableModel[];
}

export function parseAvailableModelList(
  result: unknown,
): ParsedModelListResult {
  return modelListResultSchema.parse(result);
}
