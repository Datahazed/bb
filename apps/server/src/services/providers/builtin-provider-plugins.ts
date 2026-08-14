const BUILTIN_PROVIDER_ID_OVERRIDES = new Map<
  string,
  ReadonlyMap<string, string>
>([
  ["claude-code", new Map([["default", "claude-code"]])],
  ["codex", new Map([["default", "codex"]])],
  ["pi", new Map([["default", "pi"]])],
]);

export function getBuiltinProviderIdOverrides(args: {
  builtinName: string | null;
  pluginId: string;
}): ReadonlyMap<string, string> {
  if (args.builtinName !== args.pluginId) return new Map();
  return BUILTIN_PROVIDER_ID_OVERRIDES.get(args.pluginId) ?? new Map();
}
