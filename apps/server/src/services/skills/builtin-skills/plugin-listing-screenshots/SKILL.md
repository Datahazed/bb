---
name: plugin-listing-screenshots
description: Take the screenshots that go on a plugin's marketplace listing. Use when submitting a plugin, refreshing its listing images, or running `bb plugin screenshot` — it decides which screens to capture for the plugin's type, what data to seed first, and what makes a shot unusable.
---

# Listing screenshots

A listing screenshot exists to answer one question for someone deciding whether
to install: **what does this plugin do for me?** A picture of an empty panel
answers "nothing".

`bb plugin screenshot [path] --capture <dir>` finds the surfaces the plugin
registers and photographs each one. It cannot know whether the result is worth
showing. That judgement is this skill.

## Before you capture anything

Three checks, in this order. Every one of them has already cost a real shot.

**1. Is this host safe to photograph?**
The command drives the bb you point it at, so any surface that reads local data
renders *your* data. A notes panel shows your vault, a GitHub panel your repos,
a thread list your threads. Capture on a scratch host with seeded content, never
on the machine you work on. If you cannot, capture only surfaces that render
nothing of yours — and say which you skipped.

**2. Does the surface have anything in it yet?**
Open it and look before capturing. On a fresh host these panels render "No
projects yet", "No repos tracked", "No automations installed". The capture will
succeed and the image will be worthless. Seed first, then capture.

**3. Is this a product surface at all?**
Some panels exist for development — placeholders, API testers, harnesses. If a
panel describes itself as a dev tool, or ships disabled in production, it has no
listing shot. Skip it rather than photograph it.

## The rule

**Seed first, capture second, review every shot.**

The first screenshot must show the plugin doing its job with realistic data.
Capture the empty state only as a later image, and only when the empty state
itself teaches something (a setup step, a connect button).

Reject a shot that shows any of these, and fix the cause rather than shipping it:

| Reject                                              | Because                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| An empty state as the first image                   | It reads as "this plugin does nothing"                  |
| Skeleton rows, spinners, half-painted lists         | The capture beat the data; seed, then re-run            |
| A panel with one lonely row                         | It looks broken; seed enough to show shape (5–10 items) |
| Real secrets, tokens, private repos, customer names | A listing is public forever                             |
| Anything from your own machine — your notes, repos, threads | You will not notice it is yours until someone else does |
| A development-only panel or placeholder             | It is scaffolding, not the product                      |
| `lorem ipsum`, `test test`, `asdf`                  | Plausible data reads as a real product                  |

## Size and shape

**At least 840px tall. Any ratio from 3:4 to 2:1. PNG. Up to six.**

The listing lays images out in a row of fixed height, so height is what gets
normalised and width follows from your image. A sidebar rail shot and a
full-page shot end up the same height, side by side, both legible. Nothing is
padded to a shape, so do not pad yours.

Shoot the surface your plugin actually occupies:

| Your plugin lives in... | Shoot it at roughly | Examples |
| --- | --- | --- |
| A full page or the whole window | 16:10 | File Manager, Git History, Taskboard, a theme |
| The sidebar rail | 1:2 to 1:3, portrait | BB Sidebar, Cascade |
| A message row, the composer, a footer gauge | 2:1 to 3:1, wide and short | Emoji React, Prompt Enhancer, Context Meter |

| Rule | Why |
| --- | --- |
| At least 840px tall | The row renders at 420px; below 2x it softens |
| Stay between 3:4 and 2:1 | Anything wider than 2:1 is scaled down to fit and ends up shorter than the row |
| Crop to your surface | A full-desktop shot shrinks the plugin to an illegible strip. Cut bb's sidebar and chrome unless the point *is* where the surface sits |
| Never pad to a ratio | The row handles shape. Padding just adds dead space nobody asked for |
| Text legible at row height | Scale the shot so it is 420px tall and read it. If you cannot, crop tighter |
| PNG | UI is flat colour and text; JPEG smears both |

## What to capture, by what the plugin does

Capture the surfaces the plugin actually registers — the command lists them.
This table says which of those to lead with, and what has to exist first.

| The plugin…                                          | Lead with                                                  | Seed first                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Repaints bb (themes, fonts)                          | The app wearing it: home, then a thread                    | Nothing — the theme _is_ the subject, but a thread makes it legible |
| Replaces the thread list or navigation               | The sidebar holding a realistic mix                        | Several threads: running, waiting, finished                         |
| Renders inside messages or the timeline              | A thread scrolled to the rendered element                  | A thread whose message carries the plugin's directive               |
| Changes the composer                                 | The composer open with the control visible                 | A thread, and a draft in the box                                    |
| Decides what the agent knows (memory, context, docs) | Its panel holding real entries                             | Entries via the plugin's own CLI                                    |
| Gives agents tools or filters output                 | A thread where the tool visibly ran                        | A finished thread that used it                                      |
| Handles credentials or warns about unsafe code       | Settings in a configured state                             | Placeholder values only — never a real secret                       |
| Adds or switches agents and providers                | The provider picker showing it, and a thread running on it | A configured provider                                               |
| Shows tokens, cost, or limits                        | The dashboard with plausible numbers                       | Usage history, or the plugin's demo data                            |
| Notifies or ranks what needs you                     | The surface listing several items                          | Threads in states that trigger it                                   |
| Works with code, PRs, or reviews                     | The panel listing repos or PRs                             | A connected demo repo — never a private one                         |
| Opens or previews files                              | The file open in the viewer                                | A fixture file of a type it claims                                  |
| Concerns the machine bb runs on                      | The panel with live host data                              | Usually self-populating; check it is not zeroed                     |
| Inspects bb or helps build plugins                   | The tool pointed at something real                         | Whatever it inspects                                                |
| Tracks tasks                                         | The board or list holding tasks across states              | `seed-demo`, or the plugin's CLI                                    |
| Runs scheduled or automated work                     | The list with schedules and a run history                  | A schedule, and at least one past run                               |

## Seeding

Four kinds of data, in the order you should reach for them.

**1. None.** The surface is the product. Themes, fonts, decoration.

**2. The plugin's own CLI.** A plugin that owns data almost always ships a
`bb <plugin>` command, because `bb.cli` is a plugin surface — eleven of bb's
own bundled plugins register one. That command is the supported way to create
its data, so it is the supported way to seed a screenshot:

```sh
bb tasks seed-demo --yes        # a plugin that ships a demo seeder
bb tasks project create --name "Product"   # or compose it from ordinary commands
```

**If you are authoring a plugin with data, ship a `seed-demo` subcommand.**
It costs a few lines, makes your own listing screenshots one command, and gives
reviewers a way to see your plugin working.

**3. bb's own objects.** Threads, messages, files — the things surfaces hang
off. Create a thread and send it a message so timeline, composer, and file
surfaces have something to render.

**4. External services.** GitHub, Linear, and friends. Connect a demo account or
a public repo you own. Never photograph a private repo, a customer, or a real
token — a listing image is public and permanent.

## After capturing

1. **Open every image.** The command reports files written, not whether they are
   any good.
2. **Check the first one hard.** It is the card image, and most people will see
   only that.
3. **Re-run after seeding more** if a surface looks thin. Capture is cheap.
4. **Crop to the surface, not the desktop.** Keep enough bb chrome to place the
   plugin — the panel it lives in, the rail it hangs off — and cut the rest. A
   full-window shot renders at 420px tall in the listing, where the plugin
   itself becomes an illegible strip.

## Known rough edges

- Registration is not readiness. The capture waits for the plugin to register
  and for the page to stop changing, but a panel that never finishes loading
  will still be photographed mid-load. Look at the image.
- Surfaces that only exist inside a thread need `--fixture-thread <id>`; without
  it the command reports them as skipped rather than shooting the empty app.
