import {
  claudeCodeMockCliTrafficConfigSchema,
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
} from "@bb/domain";
import { z } from "zod";

export const claudeCodeLaunchConfigSchema = z
  .object({
    mockCliTraffic: claudeCodeMockCliTrafficConfigSchema.default(
      DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
    ),
  })
  .strict();

export type ClaudeCodeLaunchConfig = z.infer<
  typeof claudeCodeLaunchConfigSchema
>;
