import type { ShowcaseArchetype } from "../showcase-archetype";

const ARCHETYPE_SOURCE: readonly Omit<ShowcaseArchetype, "id">[] = [
  {
    noun: "a kanban board",
    title: "Kanban board",
    hook: "Ship a board your agents move cards across while they work.",
    capability: "navPanel",
    icon: "Columns2",
    accentToken: "--file-accent",
    brief:
      "adds a kanban board panel where each card is a thread, and agents move cards between columns as work progresses",
  },
  {
    noun: "a live dashboard",
    title: "Live dashboard",
    hook: "Put the numbers your team actually checks on the bb homepage.",
    capability: "homepageSection",
    icon: "ChartColumn",
    accentToken: "--success",
    brief:
      "adds a homepage dashboard with deploy frequency, open PR count, and CI pass rate, refreshed on an interval",
  },
  {
    noun: "a chief of staff",
    title: "Chief of staff",
    hook: "Delegate your backlog and get briefed on only what needs you.",
    capability: "navPanel + service + experimental_threadList",
    icon: "UserRound",
    accentToken: "--pr-merged",
    brief:
      "adds a chief-of-staff panel that takes in my backlog, opens an agent thread for each item, keeps them moving by answering routine questions itself, and briefs me on progress and the few decisions only I can make",
  },
  {
    noun: "a video editor",
    title: "Video editor",
    hook: "Drop in raw clips and let agents assemble a polished first cut.",
    capability: "fileOpener + navPanel + service",
    icon: "Play",
    accentToken: "--warning",
    brief:
      "adds a video editor where I drop raw clips onto a timeline, agents assemble a first cut with trims, captions, and music, and I review the result and request changes in plain words",
  },
  {
    noun: "a prototyping lab",
    title: "Prototyping lab",
    hook: "Describe a product flow and compare working prototypes side by side.",
    capability: "navPanel + experimental_threadList + service",
    icon: "Beaker",
    accentToken: "--attention",
    brief:
      "adds a prototyping lab where I describe a product flow in plain words, agents build several working prototypes in parallel, and I compare them side by side before choosing one to refine",
  },
  {
    noun: "a support inbox",
    title: "Support inbox",
    hook: "Triage user reports into fixes without leaving bb.",
    capability: "navPanel + service + messageAction",
    icon: "Mail",
    accentToken: "--destructive-text",
    brief:
      "adds a support inbox that pulls in bug reports, clusters duplicates, drafts replies for my review, and opens a fix thread for each confirmed bug",
  },
];

export const BROWSE_ARCHETYPES: readonly ShowcaseArchetype[] =
  ARCHETYPE_SOURCE.map((archetype) => ({
    ...archetype,
    id: archetype.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  }));
