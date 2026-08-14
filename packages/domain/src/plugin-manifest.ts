import { z } from "zod";

const requiredManifestString = z.string().trim().min(1);

export const pluginHostDriverDeclarationSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(64),
    entry: requiredManifestString,
  })
  .strict();
export type PluginHostDriverDeclaration = z.infer<
  typeof pluginHostDriverDeclarationSchema
>;

/**
 * `bb.branding.icon` accepts either a host icon name or an explicit
 * plugin-relative compact SVG path.
 */
export function isPluginOwnedIconPath(icon: string): boolean {
  return icon.startsWith("./");
}

export const pluginBrandingSchema = z
  .object({
    icon: requiredManifestString.optional(),
    logo: z
      .object({
        light: requiredManifestString,
        dark: requiredManifestString.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((branding, context) => {
    if (
      branding.icon !== undefined &&
      isPluginOwnedIconPath(branding.icon) &&
      !branding.icon.toLowerCase().endsWith(".svg")
    ) {
      context.addIssue({
        code: "custom",
        path: ["icon"],
        message:
          'plugin-owned branding.icon paths must point at an .svg file (for example "./assets/icon.svg")',
      });
    }
  })
  .refine(
    (branding) => branding.icon !== undefined || branding.logo !== undefined,
    {
      message: "must declare at least branding.icon or branding.logo.light",
    },
  );

export const pluginBbManifestSchema = z
  .object({
    name: requiredManifestString,
    description: requiredManifestString,
    branding: pluginBrandingSchema,
    server: requiredManifestString,
    app: requiredManifestString.optional(),
    /** Experimental source entries compiled into isolated host-driver artifacts. */
    experimental_hostDrivers: z
      .array(pluginHostDriverDeclarationSchema)
      .max(32)
      .refine(
        (drivers) =>
          new Set(drivers.map((driver) => driver.id)).size === drivers.length,
        { message: "host driver ids must be unique" },
      )
      .optional(),
    skills: z.array(requiredManifestString).optional(),
    themes: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
              .max(64),
            name: requiredManifestString,
            description: requiredManifestString.optional(),
            css: requiredManifestString,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const pluginPackageJsonSchema = z
  .object({
    name: requiredManifestString,
    version: requiredManifestString,
    engines: z
      .object({
        bb: requiredManifestString.optional(),
        bbPluginSdk: requiredManifestString.optional(),
      })
      .optional(),
    bb: pluginBbManifestSchema,
  })
  .passthrough();

export type PluginPackageJson = z.infer<typeof pluginPackageJsonSchema>;
