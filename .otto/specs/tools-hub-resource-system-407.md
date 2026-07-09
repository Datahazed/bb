---
id: tools-hub-resource-system-407
name: Tools Hub Resource System
status: draft
created_date: 2026-07-09
description: A cohesive Tools hub for discovering and managing bb skills, plugins, and automations.
---

# Tools Hub Resource System

The Tools hub should make bb capabilities discoverable for new and light users while staying fast enough for heavy users to manage many installed resources.

## Product Summary

Tools is the home for three resource kinds:

| Resource | User meaning |
| --- | --- |
| Skills | Reusable instructions and know-how available to agents. |
| Plugins | Installed capabilities that add bb surfaces, commands, background services, or provider-specific behavior. |
| Automations | Scheduled or recurring bb work, scoped to projects or folders. |

The target `/tools` route is a mixed overview. It should not expose a visible `All` tab. The resource tabs are focused destinations for Skills, Plugins, and Automations.

## Confirmed Product Goals

| Goal | Decision |
| --- | --- |
| Primary job | Discovery and management. Discovery and learning matter most for new users or users with few resources; management matters most for users with many resources. |
| Primary audience | All bb users. There is no workspace-admin role for this feature. |
| First landing understanding | Users should understand what tools are available, what each kind can do, and how they can create or add them. |
| Returning-user speed | Returning heavy users should be able to manage resources quickly. |
| Default route | `/tools` is a mixed overview. |
| Visible tabs | No visible tab named `All`. |
| Canonical resource kinds | Skills, Plugins, Automations. |
| Templates | Templates are resource-specific creation/discovery affordances, not a top-level tab. |
| skills.sh | skills.sh is a skill catalog/discovery surface, not a provider. |

Discovery wins the empty or low-resource state. Management wins the populated state.

## Top Workflows

| Priority | Workflow | Success criteria |
| --- | --- | --- |
| 1 | Orient | A user lands on `/tools`, understands the three resource kinds, and sees anything needing attention. |
| 2 | Discover and install | A user finds a skill on skills.sh, inspects it, installs it to the right provider and scope, and sees it appear in installed rows. |
| 3 | Manage automation | A user scans automations, spots a failing one, opens detail, reads recent run history, then runs now or pauses it. |

## User Stories

| User | Story |
| --- | --- |
| New bb user | As a new user, I can land on Tools and understand what Skills, Plugins, and Automations do without already knowing bb’s internal model. |
| Light user | As a user with few resources, I can discover useful skills, plugins, and automations that help me get more value from bb. |
| Heavy user | As a user with many resources, I can search, sort, filter, inspect, enable, disable, run, edit, or delete resources without slow navigation. |
| Provider user | As a Codex or Claude Code user, I can understand which installed resources are tied to each agent/provider. |
| Automation user | As a user running scheduled work, I can see what automations exist, where they belong, whether they need attention, and what happened recently. |
| No-provider user | As a user without Claude Code or Codex configured, I can understand why provider-specific install actions are unavailable and how to configure an agent. |

## Product Principles

- Treat Skills, Plugins, and Automations as one resource system with shared interaction grammar.
- Keep rows quiet: rows should support scanning and management, not repeat obvious healthy state.
- Use detail pages for heavier taxonomy, history, configuration, and explanation.
- Make creation/discovery visible without turning templates or catalogs into separate top-level product concepts.
- Make unavailable actions understandable without asking users to infer missing provider or project setup.
- Keep color and visual emphasis reserved for Tools-specific meaning and attention states.

## Resource Taxonomy

Every resource surface should map into five facets:

| Facet | Meaning | Example values |
| --- | --- | --- |
| Kind | What kind of resource this is. | Skill, Plugin, Automation |
| Source | Where it came from and who owns it. | bb built-in, Created by you, Provider-managed, Installed from skills.sh, From plugin `<name>` |
| Scope | Where it applies. | User, Project `<name>`, Folder `<name>` |
| Agents | Which agent/provider can use or run it. | Codex, Claude Code, bb |
| State | Whether it can currently do its job. | Healthy, Active, Paused, Disabled, Needs configuration, Needs attention, Completed |

Provider is not scope. Ownership and scope must stay separate. For example, a skill can be installed from skills.sh, scoped to User, and available to Codex.

## Mixed Overview

The mixed overview answers three questions: what is here, what needs me, and what should I try next.

| Module | When shown | Product job |
| --- | --- | --- |
| Kind summaries | Always | Teach Skills, Plugins, and Automations with one sentence each, installed counts, and a create or browse entry. |
| Needs attention | Only when non-empty | Aggregate resources across kinds that cannot do their job and need user action. |
| Recent activity | When populated | Show compact management signal such as recent automation runs or recently added resources. |
| Discovery module | Empty/light state, or compact in populated state | Suggest one small set of compatible, inspectable resources to try next. |

The mixed overview does not include full resource lists, cross-resource search, filters, sort controls, or deep management row actions. Those belong in the focused tabs.

## Focused Tabs

Each resource tab owns full management for that kind:

| Tab | Product job |
| --- | --- |
| Skills | Discover installable skills and manage installed skills. |
| Plugins | Discover plugin capabilities/templates and manage installed bb and provider-specific plugins. |
| Automations | Discover automation starting points and manage installed automations across projects and folders. |

The tab structure should be:

1. Tab title or persistent description.
2. Resource-specific discovery or creation affordance.
3. Search, filter, sort, and create controls.
4. Installed resource rows.

## Discovery And Recommendation

“Recommended” means compatible with configured agents first, ranked by catalog popularity, with first-party resources labeled but not automatically boosted. If compatibility is unknown, the UI should use honest labels such as “Popular on skills.sh” instead of “Recommended.”

Trust signals before adding a resource:

| Signal | Product requirement |
| --- | --- |
| Source identity | Show the repo, author, plugin, provider, or first-party bb source. |
| Usage | Show install counts or equivalent catalog popularity when available. |
| Inspectability | Let users inspect the skill content, template prompt, plugin capability, or automation behavior before installing or creating. |
| Reversibility | Explain what adding does and make delete, uninstall, disable, or pause paths visible. |

Per-kind add-decision metadata:

| Kind | Decision metadata |
| --- | --- |
| Skill | Works-with agents, install count, scope choice, already-installed-on indicator, full content preview. |
| Plugin | Surfaces, commands, or services added; version; whether configuration is needed after enabling. |
| Automation | Trigger cadence, project/folder/environment, execution mode, and what output it creates. |

## Needs Attention

Needs attention means the resource cannot do its job right now and a user action can fix it.

| Kind | Needs attention examples | Not attention |
| --- | --- | --- |
| Skill | File unreadable, broken manifest/content, installed for a provider that is no longer configured. | Healthy installed skills, skills not yet installed from a catalog. |
| Plugin | Error, incompatible, needs configuration, degraded. | Intentionally disabled by the user. |
| Automation | Enabled but last run failed, enabled but missing required environment/provider. | Paused by user intent, completed one-shot, empty run history. |

Attention states use warning/error treatment and may be aggregated on the mixed overview. Healthy resources should not carry loud success badges just to prove they are healthy.

## Row Semantics

Rows are for scanning and fast management.

Healthy rows show identity and useful location/source metadata only: icon, name, description or schedule, and quiet meta. State appears on rows only when it deviates from the expected default: Paused, Disabled, Needs configuration, Needs attention, Completed.

Primary row actions differ by kind:

| Kind | Primary row action model |
| --- | --- |
| Skills | Open detail, inspect, edit when user-owned, delete when user-owned. No enable/disable concept. |
| Plugins | Open detail, enable/disable, configure when needed, delete/uninstall when applicable. |
| Automations | Open detail, pause/resume, run now, edit path when supported, delete. |

Destructive and rare actions can live in overflow menus. Hover actions should be consistent in placement and tooltip behavior across kinds.

## Detail Pages

All detail pages use one shared detail shell and one shared metadata order while allowing resource-specific sections.

Every detail page should answer:

1. What is this?
2. Where did it come from?
3. Where does it apply?
4. Which agents can use or run it?
5. Is it healthy?
6. What happened recently?
7. What action can I safely take next?

Canonical detail metadata order:

| Order | Facet | Notes |
| --- | --- | --- |
| 1 | Kind | Skill, Plugin, Automation. |
| 2 | Source | bb built-in, Created by you, Provider-managed, skills.sh, plugin source. |
| 3 | Scope | User, project, folder. |
| 4 | Agents | Codex, Claude Code, bb, or runtime agent. |
| 5 | State | Healthy, Active, Paused, Disabled, Needs configuration, Needs attention, Completed. |
| 6 | Resource-specific properties | Schedule, version, script path, SKILL.md path, plugin capabilities, run history. |

## Provider-Specific Plugins

Provider-specific plugins are a product concept when they represent installed provider-managed bundles of capabilities, such as Codex or Claude Code plugin packages.

They may appear in Plugins as provider-managed plugin rows and their underlying skills may also appear in Skills. The UI must make that relationship explicit so double-listing reads as cross-linking, not duplication.

## Navigation Model

Target navigation:

- `/tools` renders the mixed overview.
- `/tools` does not redirect to `/tools/skills`.
- The tab bar shows Skills, Plugins, and Automations only.
- The tab bar has no selected tab at `/tools`.
- Clicking the Tools nav item returns to the mixed overview.
- Deep links remain stable for skills, plugin details, automation details, and legacy redirects.
- Legacy top-level routes such as `/skills` and `/automations` may redirect into the Tools hub.

## Product Scope

In scope:

- Mixed Tools overview without a visible `All` tab.
- Focused Skills, Plugins, and Automations tabs.
- Shared overview primitives for tabs, descriptions, discovery areas, search, filters, sort, create actions, rows, row actions, and states.
- Shared detail-page primitives and consistent detail-page taxonomy.
- Provider-specific plugin visibility for Codex and Claude Code resources.
- skills.sh as a skill catalog/discovery surface, not as a provider section.
- Ladle stories that show the shipped resource system and component sets.

Out of scope:

- Cross-resource global search on the mixed overview.
- New recommendation, health, or catalog backends beyond existing queries.
- Plugin marketplace or registry backend work.
- skills.sh publishing, accounts, ratings, or reviews.
- Workspace roles or workspace administration.
- A top-level Templates tab.
- A new persisted Tool super-entity or schema-level resource abstraction.
- Full automation creation/editing UI beyond existing composer, CLI, or agent paths.
- Mobile-specific redesign beyond preserving current responsive behavior.

## Technical Context

The current branch already has real resource surfaces that should be reused rather than replaced:

| Area | Existing surface |
| --- | --- |
| Shared resource UI | `packages/shared-ui/src/components/ui/resource-list.tsx` |
| Tools hub shell and plugins | `apps/app/src/views/ToolsView.tsx` |
| Skills | `apps/app/src/views/SkillsView.tsx` |
| Automations | `plugins/automations/app.tsx` |
| Stories | `apps/app/src/components/tools/ToolsResourceSystem.stories.tsx` |
| Icons | `packages/shared-ui/src/components/ui/icon.tsx` |

Known branch gaps:

- `/tools` currently redirects to `/tools/skills`; the target product requires a real mixed overview.
- The current stories contain parallel fixtures and should render shared presentational components wherever possible.
- Provider-plugin inference and double-listing need a deliberate product and implementation rule.
- Automation attention state may require surfacing last-run failure data in overview rows.

The implementation should continue to reuse the PR’s existing data, queries, detail views, and shared UI components. New primitives are acceptable only when they make the Tools resource system easier to maintain across all three resource kinds.

## Acceptance Criteria

- `/tools` renders a mixed overview that teaches the three resource kinds and supports both discovery and management.
- The default mixed overview exists without a visible `All` tab.
- The mixed overview contains kind summaries and conditionally shows needs-attention, recent activity, and compact discovery modules.
- Skills, Plugins, and Automations use a cohesive layout, taxonomy, and interaction model.
- Resource rows map to the five facets without conflating source, scope, and agents.
- Healthy rows stay quiet; attention and disabled states appear only when meaningful.
- Shared components cover repeated resource surface patterns rather than duplicating layouts per page.
- Installed resources are represented as rows designed for scanning and management.
- Discovery/catalog/template content does not masquerade as installed resources.
- Detail pages use a shared layout and aligned metadata taxonomy while allowing resource-specific content.
- Unavailable install/create actions explain what setup is missing.
- Provider-specific plugin rows and their underlying skills are cross-linked or otherwise explained.
- Ladle stories show the overview page, overview component system, detail component system, and skills.sh discovery system using shipped components where possible.
- Typecheck stays green for the app, shared UI, automations plugin, and SDK packages.

## Review Notes

This spec is intentionally retroactive. It captures the product direction emerging from PR #407 feedback and the Fable worker review from `thr_mggx8gnzhc`.
