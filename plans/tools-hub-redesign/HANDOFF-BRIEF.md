# Tools Hub — handoff brief (all of brsbl's feedback)

**Do the work on PR 407's branch (`bb/skills-redesign`), reusing everything already in the PR. Do not reinvent components.** The prior attempt built a from-scratch prototype on `main` (`apps/app/src/views/tools-hub-gallery/`) and invented too much — treat that only as a rough visual reference, not code to keep. Restructure the PR's real components into the hub instead.

## The goal

A top-level **Tools** hub (sidebar entry already added in the PR) that unifies **Skills · Automations · Plugins** as one cohesive system: card-based overviews + full-page detail pages. Card-based, not rows.

## Hub page — where MOST of the work goes

- **Mixed "All" view is the default**, with the tabs acting as **filters**, not separate pages: `All · Skills · Automations · Plugins`. "All" shows everything grouped by kind with a **"View all →"** per section; picking a kind filters the grid to just that kind.
- **Card-based overviews** (the whole point). Reuse the PR's data/queries; the card is the new presentational shape, composed from `@bb/shared-ui` — no new low-level primitives.
- **Color belongs here.** The Tools hub is the one surface where per-kind accent color earns its place; the rest of bb stays monochrome. Keep a deliberate per-kind tint (full-enclosure only — see borders).

## Cards — minimal metadata, consistent, reuse PR bits

- **Don't invent metadata.** A card carries no more than its PR overview **row** already shows.
  - **Skills:** icon + name + description (mirrors `SkillRow`). Group by provider, and **reuse `ProviderLogo`** (from `SkillsView.tsx` / `getProviderIconInfo` in `@/lib/provider-icon`) in the group headers — not text. No invented labels (e.g. delete "· provider-agnostic").
  - **Automations:** **no description** — the automation `OverviewRow` has none. Show status dot + name + schedule-status + on/off. Nothing more.
  - **Plugins:** icon + name + description + status + enable toggle (mirrors `PluginRow`).
- **Badge usage must be consistent across kinds** — pick one status treatment (e.g. `StatusDot` + label + `Switch` for automations & plugins) and apply it uniformly; don't mix a Pill on one kind and a dot on another.

## Detail pages — reuse the PR's, minimal changes, full pages, aligned

- **Reuse the existing PR detail views.** Make minimal changes; the real work is the hub, not the details.
- **Skill detail:** the PR's `SkillDetailDialogView` is a **Dialog** — turn it into a **full page** (de-drawer it), keeping its content (Zap · name · `ProviderLogo` · scope Pill · overflow: Edit/Open in editor/Delete · SKILL.md preview).
- **Automation detail:** the PR's `DetailView` is already a **centered full page** (`mx-auto max-w-3xl`) — keep that. It was previously a right-side split/drawer; it must be a **centered full page**, not a split.
- **Minimally align** the two so they read as the same kind of page (shared back link, header shape, section labels).

## Icons (exact Hugeicons — register in `@bb/shared-ui`'s `Icon` map)

- **Plugins:** `ElectricPlugsIcon`
- **Automations (top-level / filter tab):** `TimeScheduleIcon`
- **A specific automation:** `ComputerTerminal01Icon` if it's a script, else `ArrowReloadHorizontalIcon`
- **Skills:** `Zap` (`ZapIcon`)
- **Do NOT reuse the `Workflow` icon.**

## Borders

- **Absolutely no one-sided borders anywhere** (no `border-t/r/b/l`, no row-divider `border-b`, no top accent bars). Separate with full-enclosure borders, background surfaces, spacing, or zebra. Per-kind card color is a **full** border tint, never a top bar.

## skills.sh registry — one-click install across providers

- Index **skills.sh** ("The Open Agent Skills Ecosystem"): a registry of `SKILL.md` skills, cross-agent (Claude Code, Codex, Cursor, …), installed via **`npx skills add <owner/repo>`**.
- In the **Skills** area: an **Installed | Browse** toggle. Browse renders registry cards (owner/name, install count, topic, works-with providers) in the same grid.
- **Install is one click across every configured provider** (runs `npx skills add owner/repo` per provider); a chevron opens a per-provider picker (Claude Code / Codex / …, un-configured shown disabled) + scope (User / Project). Already-installed skills show "Installed" + "Add provider". Include a registry detail page.

## Stories

- Make them **real** — do **not** name or namespace anything "Direction A". Write the Ladle stories as if this is the shipped Tools hub.
- Reuse `@bb/shared-ui` and the PR's components. Keep `pnpm exec turbo run typecheck --filter=@bb/app` green.

## Reference material (on branch `bb/architecture-and-design-workflow-thr_zm2anhgygp`, pushed)

- `plans/tools-hub-redesign/*.html` — the reviewed static design (hub grid, All-filter, registry browse/install, competitor analysis). Visual reference only.
- `apps/app/src/views/tools-hub-gallery/` — the throwaway `main`-based prototype. Cards/detail/icon *decisions* are captured above; do not port its reinvented components — reuse the PR's.
