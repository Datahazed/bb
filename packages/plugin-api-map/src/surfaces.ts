/**
 * The product-shape inventory behind the docs landing page: every surface a
 * plugin can plug into, in plain language, each linking into the API
 * reference. Grounded in the SDK's real registration points; surfaces.test.ts
 * rejects any link whose section or symbol anchor does not exist in the
 * generated model.
 *
 * Each surface reads as plain product capability: what the user can do in that
 * part of bb once a plugin owns it. API detail belongs in the reference, not
 * on the map.
 *
 * `firstParty` lists the shipped bb plugins that use each surface today,
 * taken from a registration-call inventory of plugins/* in the bb repo.
 */

export interface SurfaceLink {
  /** "View API reference" for single links; the section title otherwise. */
  label: string;
  sectionId: string;
  /** Symbol anchor on that section page; must be assigned to that section. */
  anchor?: string;
}

export interface PluginSurface {
  id: string;
  title: string;
  /** What the surface does in the product, in plain language. */
  summary: string;
  /**
   * One scannable line for capability grids; the prose stays in the detail
   * card. Only the pixel-less surfaces need one today.
   */
  tagline?: string;
  links: SurfaceLink[];
  /** First-party bb plugins that ship on this surface today (display names). */
  firstParty?: string[];
  experimental?: boolean;
}

export interface SurfaceGroup {
  id: "app-shell" | "composer" | "home" | "settings" | "headless";
  title: string;
  blurb: string;
  surfaces: PluginSurface[];
  /**
   * Named clusters for a group that lists its surfaces instead of drawing
   * them. Every surface id in the group appears in exactly one section
   * (surfaces.test.ts enforces it).
   */
  sections?: readonly {
    title: string;
    surfaceIds: readonly string[];
  }[];
}

export function surfaceHref(link: SurfaceLink): string {
  return `/docs/plugin-api/${link.sectionId}${link.anchor ? `#${link.anchor}` : ""}`;
}

export const SURFACE_GROUPS: SurfaceGroup[] = [
  {
    id: "app-shell",
    title: "The app window",
    blurb:
      "The main bb window, containing the sidebar, the conversation, and the side panel. A plugin can add rows, controls, panel tabs, and message content to the numbered regions.",
    surfaces: [
      {
        id: "nav-panel",
        title: "Full-page panels",
        summary:
          "Give your plugin a whole page inside bb, opened from its own row in the sidebar. It fills the window like any built-in page, keeps a real URL so links and the back button work, and can pin extra tabs down its side.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginNavPanelRegistration",
          },
        ],
        firstParty: ["Automations", "Docs", "GitHub", "Tasks"],
      },
      {
        id: "thread-list",
        title: "The thread list",
        summary:
          "Take over the list of threads in the sidebar and present the user's work your way, with your own grouping, ordering, and row details. Every thread still opens and behaves exactly as it does today.",
        links: [
          {
            label: "View API reference",
            sectionId: "sidebar",
            anchor: "PluginThreadListRegistration",
          },
        ],
        experimental: true,
      },
      {
        id: "sidebar-footer",
        title: "Sidebar footer buttons",
        summary:
          "Put a button in the bottom corner of the sidebar, beside Settings. It stays in reach no matter what the user is looking at, and runs whatever your plugin does when clicked.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginSidebarFooterActionRegistration",
          },
        ],
        firstParty: ["Remote access"],
      },
      {
        id: "thread-header",
        title: "Thread header controls",
        summary:
          "Add a control to the top of every conversation, next to the thread title. Good for a live status, a toggle, or a shortcut that applies to the thread the user is reading right now.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginThreadHeaderActionRegistration",
          },
        ],
        experimental: true,
      },
      {
        id: "message-directives",
        title: "Rich message embeds",
        summary:
          "Let agent replies carry live UI from your plugin instead of plain text: a chart, a task card, a preview the user can click, rendered inline in the conversation where the agent mentions it.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginMessageDirectiveRegistration",
          },
        ],
        firstParty: ["Docs", "Inline visualizations", "Tasks", "Workflows"],
      },
      {
        id: "message-actions",
        title: "Message actions",
        summary:
          "Add one action to messages in a conversation. It appears both on a message's hover toolbar and in the menu the user gets when they select text inside a reply, and your code receives the message, plus the highlighted text when there is one.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginMessageActionRegistration",
          },
        ],
        firstParty: ["Side chat"],
      },
      {
        id: "pending-interaction",
        title: "Ask-the-user forms",
        summary:
          "Ask the person a question in the middle of the agent's work. A form appears in the conversation, the agent waits, and your plugin picks up whatever they answer, or the fact that they cancelled.",
        links: [
          {
            label: "Interactions & mentions",
            sectionId: "interactions-mentions",
            anchor: "PluginUi",
          },
          {
            label: "Slots",
            sectionId: "slots",
            anchor: "PluginPendingInteractionRegistration",
          },
        ],
        firstParty: ["Ask User Question", "Secrets"],
      },
      {
        id: "thread-panel",
        title: "Thread side-panel tabs",
        summary:
          "Open your own tab in the panel beside a conversation, so notes, diffs, previews, or task detail sit next to the chat instead of replacing it. It stays put while the user keeps working.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginThreadPanelActionRegistration",
          },
        ],
        firstParty: ["Docs", "GitHub", "Side chat", "Tasks", "Workflows"],
      },
      {
        id: "file-opener",
        title: "File viewers & editors",
        summary:
          "Decide how files of the types you claim open inside bb. Instead of raw text, the user gets your viewer or editor and never has to leave the app to read or change them.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginFileOpenerRegistration",
          },
        ],
        firstParty: ["Docs"],
      },
      {
        id: "content-scripts",
        title: "App-wide behavior",
        summary:
          "The one surface with no fixed place on screen: your code runs alongside the whole bb window for behavior that belongs to no single region, like global keyboard shortcuts, app-wide watchers, or a small touch applied wherever it is needed. It draws no UI of its own; it enhances what is already there.",
        links: [
          {
            label: "View API reference",
            sectionId: "content-scripts",
            anchor: "PluginContentScriptRegistration",
          },
        ],
      },
    ],
  },
  {
    id: "composer",
    title: "The composer",
    blurb:
      "The prompt box used to start a thread and to reply inside one. A plugin can add banners, menu entries, and action buttons to it, answer @-mention searches, highlight the draft, and supply the agent that runs the message.",
    surfaces: [
      {
        id: "composer-banners",
        title: "Banners",
        summary:
          "Show a message across the top of the prompt box, above whatever the user is typing. The place for anything they should see before they hit send: connection trouble, a job still running, a limit they are about to reach.",
        links: [
          {
            label: "View API reference",
            sectionId: "composer",
            anchor: "ComposerCustomization",
          },
        ],
        firstParty: ["Provider retry", "Workflows"],
      },
      {
        id: "mention-provider",
        title: "@-mentions",
        summary:
          "Put your content in the composer's @-menu. The user types @, searches your items, picks one, and it travels with the message as real context the agent can use.",
        links: [
          {
            label: "View API reference",
            sectionId: "interactions-mentions",
            anchor: "PluginMentionProviderRegistration",
          },
        ],
        firstParty: ["Docs", "GitHub", "Tasks"],
      },
      {
        id: "composer-rich-text",
        title: "Draft highlighting",
        summary:
          "Highlight parts of the draft as the user types: flag a ticket number, mark a risky phrase, call out a TODO. You change how the text looks, never the text itself.",
        links: [
          {
            label: "View API reference",
            sectionId: "composer",
            anchor: "ComposerRichTextSpec",
          },
        ],
      },
      {
        id: "composer-plus-menu",
        title: "The + menu",
        summary:
          "Add entries to the + menu beside the prompt box, so an action the user needs while composing sits exactly where they already look for attachments and extras.",
        links: [
          {
            label: "View API reference",
            sectionId: "composer",
            anchor: "ComposerPlusMenuItem",
          },
        ],
      },
      {
        id: "provider-picker",
        title: "Agent providers",
        summary:
          "Ship a whole agent for bb to run. It appears in the model picker like any built-in, and every thread the user starts with it runs on your provider.",
        links: [
          { label: "Provider bridges", sectionId: "provider-bridge" },
          {
            label: "Agent tools & configuration",
            sectionId: "agents",
            anchor: "PluginProviderDeclaration",
          },
        ],
        firstParty: [
          "ACP providers",
          "Claude Code provider",
          "Codex provider",
          "Pi provider",
        ],
        experimental: true,
      },
      {
        id: "composer-actions",
        title: "Inline actions",
        summary:
          "Add a button to the row inside the prompt box that can read and rewrite the draft: sharpen the prompt, drop in a template, translate it before sending.",
        links: [
          {
            label: "View API reference",
            sectionId: "composer",
            anchor: "PluginComposerApi",
          },
        ],
      },
    ],
  },
  {
    id: "home",
    title: "Home page",
    blurb:
      "The screen bb opens on, holding the new-thread composer and a panel of launch actions. A plugin can add a section below the composer and a tab to that panel.",
    surfaces: [
      {
        id: "homepage-section",
        title: "Home-screen sections",
        summary:
          "Own a block of the screen bb opens on, right below the composer. Show recent work, a board, or shortcuts, so your plugin is useful before any thread exists.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginHomepageSectionRegistration",
          },
        ],
      },
      {
        id: "new-thread-panel",
        title: "New-thread side panel",
        summary:
          "Open your tab beside the new-thread screen, for setup that belongs with composing the first prompt rather than with a conversation that has not started yet.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginNewThreadPanelActionRegistration",
          },
        ],
        experimental: true,
      },
    ],
  },
  {
    id: "settings",
    title: "Your settings page",
    blurb:
      "The settings page bb creates for every installed plugin. A plugin can declare fields for bb to render, add its own section below them, and report when configuration is missing.",
    surfaces: [
      {
        id: "plugin-status",
        title: "Configuration status",
        summary:
          "Tell bb your plugin still needs setting up. The user gets a clear banner pointing at what is missing instead of a feature that quietly fails, and it disappears once you are configured.",
        links: [
          {
            label: "View API reference",
            sectionId: "plugin-factory",
            anchor: "PluginStatusApi",
          },
        ],
        firstParty: ["GitHub", "Workflows"],
      },
      {
        id: "declarative-settings",
        title: "Settings, rendered for you",
        summary:
          "Describe the settings your plugin needs and bb builds the page for you: the fields, the layout, saving, and safe handling of secrets, which never reach the browser.",
        links: [
          {
            label: "View API reference",
            sectionId: "settings",
            anchor: "PluginSettings",
          },
        ],
        firstParty: ["GitHub", "Provider retry", "Workflows"],
      },
      {
        id: "settings-section",
        title: "Custom settings UI",
        summary:
          "Add your own section to your plugin's settings page for anything a plain form cannot do, like connecting an account, testing credentials, or previewing what a setting will change.",
        links: [
          {
            label: "View API reference",
            sectionId: "slots",
            anchor: "PluginSettingsSectionRegistration",
          },
        ],
        firstParty: [
          "Custom instructions",
          "Keep Awake",
          "Memory",
          "Remote access",
        ],
      },
    ],
  },
  {
    id: "headless",
    title: "The platform",
    blurb:
      "The parts of the plugin API with no interface of their own. A plugin can add CLI commands and agent tools, run background and scheduled work, store data, serve HTTP and RPC, and react to thread events.",
    sections: [
      {
        title: "Commands & agent capabilities",
        surfaceIds: ["cli", "agent-tools"],
      },
      {
        title: "Running & reacting",
        surfaceIds: ["background", "wire", "thread-events", "host-workers"],
      },
      {
        title: "Data & platform",
        surfaceIds: ["storage", "bb-sdk", "host-components"],
      },
      {
        title: "Confidence",
        surfaceIds: ["testing"],
      },
    ],
    surfaces: [
      {
        id: "cli",
        tagline: "Your own `bb <name>` command",
        title: "CLI commands",
        summary:
          "Claim your own `bb` command. The same command serves a person at a terminal and an agent mid-task, so everything your plugin does is scriptable and automatable.",
        links: [
          {
            label: "View API reference",
            sectionId: "cli",
            anchor: "PluginCli",
          },
        ],
        firstParty: [
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Keep Awake",
          "Memory",
          "Provider retry",
          "Remote access",
          "Secrets",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "agent-tools",
        tagline: "Native tools, skills, and instructions in every session",
        title: "Agent tools & skills",
        summary:
          "Hand agents new abilities. Your tools sit alongside bb's built-ins, and you choose which ones, plus any extra instructions, come along in each conversation.",
        links: [
          {
            label: "View API reference",
            sectionId: "agents",
            anchor: "PluginAgents",
          },
        ],
        firstParty: [
          "Ask User Question",
          "Claude Code provider",
          "Custom instructions",
          "Memory",
          "Remote access",
          "Workflows",
        ],
      },
      {
        id: "background",
        tagline: "Supervised services and cron schedules",
        title: "Background work",
        summary:
          "Keep working when nobody is watching: long-running services and scheduled jobs that bb starts with your plugin, supervises, restarts after a failure, and shuts down cleanly.",
        links: [
          {
            label: "View API reference",
            sectionId: "background",
            anchor: "PluginBackground",
          },
        ],
        firstParty: [
          "Automations",
          "Docs",
          "GitHub",
          "Keep Awake",
          "Provider retry",
          "Remote access",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "wire",
        tagline: "Typed RPC, webhook routes, realtime push",
        title: "HTTP, RPC & realtime",
        summary:
          "Connect your plugin's screens, your backend, and the outside world: private calls from your UI to your server, endpoints other services can call, and live updates pushed to every open window.",
        links: [
          { label: "RPC contracts", sectionId: "rpc" },
          { label: "HTTP routes & realtime", sectionId: "http-realtime" },
        ],
        firstParty: [
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Inline visualizations",
          "Keep Awake",
          "Memory",
          "Provider retry",
          "Remote access",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "storage",
        tagline: "Namespaced KV plus your own SQLite",
        title: "Storage",
        summary:
          "Keep your plugin's data with bb. Small values go in a private key-value store; anything larger gets its own database that upgrades along with your plugin.",
        links: [
          {
            label: "View API reference",
            sectionId: "storage",
            anchor: "PluginStorage",
          },
        ],
        firstParty: [
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Keep Awake",
          "Memory",
          "Remote access",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "thread-events",
        tagline: "React when threads start, finish, or fail",
        title: "Thread lifecycle events",
        summary:
          "Know when work happens. Your plugin hears threads start, finish, fail, or get archived, and can act on any of it: notify someone, retry, sync, keep a record.",
        links: [
          {
            label: "View API reference",
            sectionId: "thread-events",
            anchor: "PluginEvents",
          },
        ],
        firstParty: ["Automations", "Provider retry", "Tasks", "Workflows"],
      },
      {
        id: "host-workers",
        tagline: "Run code on enrolled machines",
        title: "Host workers",
        summary:
          "Run code on the machines bb is connected to, not only on the server, for work that has to happen locally: watching files, keeping a machine awake, reaching local hardware.",
        links: [
          { label: "Host entries", sectionId: "host-entry" },
          { label: "Host control plane", sectionId: "hosts-control" },
        ],
        firstParty: ["Keep Awake"],
        experimental: true,
      },
      {
        id: "bb-sdk",
        tagline: "Everything the product can do, callable",
        title: "The full bb SDK",
        summary:
          "Drive bb itself from your plugin: start threads, send messages, manage projects. Anything the product can do is available, and work your plugin kicks off is credited back to it.",
        links: [
          {
            label: "View API reference",
            sectionId: "plugin-factory",
            anchor: "BbPluginApi",
          },
        ],
        firstParty: [
          "Automations",
          "Claude Code provider",
          "Docs",
          "GitHub",
          "Inline visualizations",
          "Keep Awake",
          "Provider retry",
          "Secrets",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "host-components",
        tagline: "Embed bb's real chat and composer",
        title: "Host components",
        summary:
          "Reuse bb's own interface inside your pages: the real conversation view, the real composer, the real message formatting, so your plugin looks like part of the product rather than a lookalike.",
        links: [
          {
            label: "View API reference",
            sectionId: "host-components",
            anchor: "ThreadChat",
          },
        ],
        firstParty: ["Docs", "GitHub", "Side chat", "Tasks"],
      },
      {
        id: "testing",
        tagline: "Unit-test every surface without a running bb",
        title: "Testing harnesses",
        summary:
          "Exercise every one of these surfaces without a running bb, so your plugin gets ordinary unit tests and CI instead of manual clicking.",
        links: [
          { label: "Testing the backend", sectionId: "testing-backend" },
          { label: "Testing the frontend", sectionId: "testing-frontend" },
        ],
        firstParty: [
          "Ask User Question",
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Inline visualizations",
          "Keep Awake",
          "Memory",
          "Provider retry",
          "Remote access",
          "Secrets",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
    ],
  },
];

export const SURFACES_BY_ID: ReadonlyMap<string, PluginSurface> = new Map(
  SURFACE_GROUPS.flatMap((group) =>
    group.surfaces.map((surface) => [surface.id, surface] as const),
  ),
);
