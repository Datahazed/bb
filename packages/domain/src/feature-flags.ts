import { z } from "zod";

export const featureFlagsSchema = z.object({
  placeholder: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  placeholder: false,
};
