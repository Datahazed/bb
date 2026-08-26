# SceneSeed

SceneSeed is bb's playful prompt-to-object canvas. Describe an idea in bb's
composer, send it, and a hidden bb agent interprets it as a bounded,
dimensional Three.js scene.

## Install

Install SceneSeed from the BB Official catalog:

```bash
bb plugin install sceneseed
```

Open **SceneSeed** in bb's navigation, acknowledge the first-run disclosure,
create a canvas, and send a prompt from the composer. SceneSeed finds an open
position automatically and keeps progress, cancellation, retry, and object
editing in the canvas where the result will appear.

## Agent access

The same saved records are available through the plugin CLI:

```bash
bb sceneseed list
bb sceneseed show <canvas-id> --json
bb sceneseed add <canvas-id> --prompt "a storm in a teacup" --x 0 --y 0
bb sceneseed wait <job-id>
bb sceneseed cancel <job-id>
bb sceneseed remove-object <canvas-id> <object-id>
```

## Safety and privacy

- Generated output must conform to SceneSeed's strict, versioned scene contract.
  It cannot contain executable code, URLs, files, remote assets, or shaders.
- Prompts, generated scene graphs, transforms, job state, and canvas metadata are
  stored in the plugin's private SQLite database, not in a project workspace.
- Each canvas uses a hidden, persistent bb thread in the personal project. The
  thread uses the normal provider and bb capability envelope; SceneSeed asks it
  not to inspect unrelated context, but does not claim structural isolation.
- Disabling or uninstalling the plugin does not erase its database or spawned
  threads. Use **Delete all canvas data** in SceneSeed settings to archive canvas
  threads and clear the stored canvases.

## MVP limits

A canvas accepts at most 12 prompts in flight, 25 active objects, and 100 active
scene-cost units. Jobs run serially per canvas. Sharing, export, collaboration,
raw mesh editing, remote model loading, and image generation are intentionally
out of scope.

`fixtures/prompt-scenes.json` is the fixed 32-prompt evaluation set for future
agent-quality runs: eight literal, metaphorical, spatial, and abstract prompts,
each with nearby-scene context and observable interpretation cues. It is test
data, not bundled executable content.

## Develop

```bash
pnpm exec turbo run test typecheck build --filter=bb-plugin-sceneseed
bb plugin dev ./plugins/sceneseed
```
