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

## Plan one carousel

A screenshot set is one visual explanation, not an inventory of every surface
the capture command happens to find. Plan **two to four images** for most
plugins, up to the six-image marketplace limit. Every image must advance the
same user job with the same fictional people, project, repository, documents,
or tasks.

Use this sequence when the plugin supports it:

1. **Overview:** the strongest, immediately understandable proof of the job.
2. **Interaction:** the primary selection, edit, command, or state change.
3. **Outcome or detail:** what the user gets after that interaction.
4. **Setup or empty state:** only when it teaches a necessary next step.

The first image must stand on its own, and every later image must add information
instead of repeating the same surface. A registered surface is a capture
candidate, not an obligation. Do not combine unrelated surfaces merely because
one plugin registered all of them.

Fixture content must look like ordinary, publishable use of the plugin. Keep a
single believable scenario across the carousel. Do not photograph work about
building the plugin, taking marketplace screenshots, testing the listing,
seeding demo data, or reviewing bb itself. Those fixtures make the screenshot
self-referential instead of explaining the plugin.

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
| Unrelated surfaces with no shared user job           | A carousel should tell one coherent story               |
| Capture, QA, listing, or plugin-development fixtures | The evidence describes itself instead of the product    |
| A loose desktop crop with the plugin lost inside it  | The carousel will shrink the useful content further     |

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
| Text legible at its rendered size | A 420px source-height preview is only a preliminary check. Read it again inside both required detail layouts |
| PNG | UI is flat colour and text; JPEG smears both |

The carousel's maximum row height is 420px, not a promise that every image will
render 420px tall. A wide image in a narrow detail panel is width-constrained
and can become much shorter. Inspect the actual rendered image height in the
browser with `getBoundingClientRect()`. If it falls below 420px, judge every
label and value at that smaller size. Crop tighter, reframe the surface, or
capture at higher density until the content remains readable; do not approve it
from source dimensions alone.

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

## Multiple states from one registered surface

One registered panel or page may provide the whole carousel. Do not add duplicate
plugin registrations or substitute unrelated surfaces just to obtain more
files.

1. Run `bb plugin screenshot [path] --capture <dir> --json` once to discover the
   registered surface and its canonical URL. Keep that surface and one scratch
   fixture host for the entire set.
2. Seed the overview state through the plugin's supported CLI or fixture flow,
   open the canonical URL, wait for the stable painted state, and capture it.
3. For a persisted second state, change the data through the supported CLI,
   reload the same surface, and capture again.
4. For a transient state such as a selected row, tab, expanded detail, menu, or
   modal, keep the same scratch app and browser session. Use the prescribed UI
   driver to interact with the canonical surface, wait for a stable paint, and
   capture that state before navigating away.
5. Crop every state to the same surface boundary and name the files in story
   order, for example `01-overview.png`, `02-selected-detail.png`, and
   `03-complete.png`.

The capture command supplies the canonical first capture. Additional states may
be captured from that same registered surface after interaction; they must not
pretend an unregistered demo page is a product surface.

## After capturing

1. **Open every image.** The command reports files written, not whether they are
   any good.
2. **Check the first one hard.** It is the card image, and most people will see
   only that.
3. **Review the sequence together.** Make a contact sheet or step through the
   carousel in order. Confirm one scenario, no redundant slides, and a clear
   overview → interaction → outcome progression.
4. **Re-run after seeding more** if a surface looks thin. Capture is cheap.
5. **Crop to the surface, not the desktop.** Keep enough bb chrome to place the
   plugin — the panel it lives in, the rail it hangs off — and cut the rest. A
   full-window shot renders at 420px tall in the listing, where the plugin
   itself becomes an illegible strip.
6. **Review in the real marketplace detail view.** Open every slide in both:
   - the actual narrow split-panel layout, with Browse still visible; and
   - the full-page detail layout entered through the existing Full Screen action.
7. **Exercise responsive sizing.** At the narrow supported split, record each
   image's rendered width and height. Treat a height below 420px as an expected
   stress case, not a layout failure, and confirm that text, controls, pagination,
   crops, and the subject remain legible without opening the source file.
8. **Report evidence.** Give the ordered screenshot paths, the fixture scenario,
   the two layouts reviewed, observed rendered sizes, and a pass/fail finding for
   coherence, crop, realism, legibility, responsiveness, and sensitive data.

## Known rough edges

- Registration is not readiness. The capture waits for the plugin to register
  and for the page to stop changing, but a panel that never finishes loading
  will still be photographed mid-load. Look at the image.
- Surfaces that only exist inside a thread need `--fixture-thread <id>`; without
  it the command reports them as skipped rather than shooting the empty app.
