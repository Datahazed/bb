import {
  definePluginApp,
  experimental_useAppearance,
} from "@get-bb/plugin-sdk/app";

const COLOR_MODE_PREFERENCES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
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
            className="flex flex-wrap gap-2"
            role="group"
          >
            {COLOR_MODE_PREFERENCES.map(({ value, label }) => (
              <button
                key={value}
                aria-pressed={appearance.colorModePreference === value}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                type="button"
                onClick={() => appearance.setColorModePreference(value)}
              >
                {label}
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
  app.slots.sidebarFooterAction({
    id: "open-plugin-api-tester",
    title: "Plugin API Tester",
    icon: "Beaker",
    run({ openSettings }) {
      openSettings();
    },
  });
});
