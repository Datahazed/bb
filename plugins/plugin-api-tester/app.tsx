import {
  definePluginApp,
  experimental_useAppearance,
} from "@get-bb/plugin-sdk/app";

const COLOR_MODE_PREFERENCES = [
  {
    value: "light",
    label: "Light",
    description: "Always use light mode",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use dark mode",
  },
  {
    value: "system",
    label: "System",
    description: "Follow this device",
  },
] as const;

function PluginApiTesterPanel() {
  const appearance = experimental_useAppearance();

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            Plugin API Tester is active
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This placeholder panel is enabled by default in development and
            disabled by default in production.
          </p>
        </div>
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-medium text-foreground">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live values from the experimental plugin appearance contract.
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Resolved color mode</dt>
            <dd>
              <output
                aria-label="Resolved color mode"
                className="font-medium text-foreground"
              >
                {appearance.colorMode}
              </output>
            </dd>
            <dt className="text-muted-foreground">Preference</dt>
            <dd>
              <output
                aria-label="Color mode preference"
                className="font-medium text-foreground"
              >
                {appearance.colorModePreference}
              </output>
            </dd>
          </dl>
          <div
            aria-label="Set color mode preference"
            className="grid gap-2 sm:grid-cols-3"
            role="group"
          >
            {COLOR_MODE_PREFERENCES.map(({ value, label, description }) => (
              <button
                key={value}
                aria-pressed={appearance.colorModePreference === value}
                className="group inline-flex min-h-16 w-full cursor-pointer items-center justify-start gap-3 whitespace-normal rounded-md border border-input bg-transparent px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:border-foreground aria-pressed:bg-state-active aria-pressed:hover:bg-state-active"
                type="button"
                onClick={() => appearance.setColorModePreference(value)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {label}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {description}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-background group-aria-pressed:border-foreground group-aria-pressed:bg-foreground"
                >
                  <span className="text-xs leading-none opacity-0 group-aria-pressed:opacity-100">
                    ✓
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-api-tester",
    title: "Plugin API Tester",
    icon: "Beaker",
    path: "plugin-api-tester",
    component: PluginApiTesterPanel,
  });
});
