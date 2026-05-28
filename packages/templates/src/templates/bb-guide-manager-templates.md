---
kind: instruction
title: bb Guide - Manager Templates
summary: Manager storage template reference.
intent: Explain how manager-templates seed new manager thread storage.
editingNotes: Keep this factual against manager-storage-templates.ts and the manager hire API/CLI.
---
Manager templates

Manager templates are named bundles of starter files for manager thread
storage. When bb starts a new manager thread, the server resolves a template
and recursively copies regular files into the new manager's thread storage
before the host daemon receives the initial `thread.start` command. This is how
a fresh manager can boot with starter `PREFERENCES.md`, `ASYNC.md`, and
`apps/status/` files.

Directory layout:

```text
<bb-data-dir>/manager-templates/
  active
  default/
    apps/
      status/
        manifest.json
        assets/
          index.html
        data/
          state.json
  sawyer-next/
    PREFERENCES.md
    apps/
      status/
        manifest.json
        assets/
          index.html
        data/
          state.json
```

In this guide, `<bb-data-dir>` is your bb data directory. Packaged installs
default to `$HOME/.bb`. In source development, `pnpm dev` sets `BB_DATA_DIR`
to the current checkout's data directory; use `$BB_DATA_DIR/manager-templates/`.
Override packaged installs with the `BB_DATA_DIR` env var.

`active` is a plain text file. bb reads the first line, trims it, and uses it
as the template name. Missing or empty `active` means `default`. An invalid
name logs a warning and falls back to `default`. Template names must be one
directory name: 1-128 characters, no `/` or `\`, and not `.` or `..`.

Each subdirectory is a template set. The directory name is the template name.

What gets seeded:

bb recursively copies every regular file from the selected template directory
into `<bb-data-dir>/thread-storage/<manager-thread-id>/`. There is no filename
allowlist: `PREFERENCES.md`, `ASYNC.md`, `apps/status/manifest.json`, and
`apps/status/data/state.json` are conventions, not the only files allowed.
Symlinks and other non-regular files are ignored. Existing destination files
are left as-is; seeding does not overwrite, delete, or refresh files.

If `default/` is missing, bb uses a bundled fallback template containing only
the `status` app:

```text
apps/status/manifest.json
apps/status/assets/index.html
apps/status/data/state.json
```

If `default/` exists but is empty, no bundled files are mixed in. If a selected
non-default template is missing, bb logs a warning and skips storage seeding.

When it runs:

Seeding happens while building the manager `thread.start` command, normally
after `POST /api/v1/projects/:id/managers` or `bb manager hire` creates the
manager and the environment is ready. It happens before the host daemon starts
the provider thread. The copy operation is safe to run more than once because
existing files are skipped; it is not a refresh mechanism for managers that
already have storage.

Selecting a template:

For one manager, pass a template name at hire time:

```bash
bb manager hire --template sawyer-next
```

`--template` overrides the `active` pointer for that manager creation only.

For future managers by default, edit the active pointer:

```bash
DATA_DIR="${BB_DATA_DIR:-$HOME/.bb}"
mkdir -p "$DATA_DIR/manager-templates"
printf 'sawyer-next\n' > "$DATA_DIR/manager-templates/active"
```

There is no dedicated CLI command today for changing the global active
template.

Creating a template:

```bash
DATA_DIR="${BB_DATA_DIR:-$HOME/.bb}"
mkdir -p "$DATA_DIR/manager-templates/sawyer-next"
cp -R "$DATA_DIR/manager-templates/default/apps" \
  "$DATA_DIR/manager-templates/sawyer-next/apps"
$EDITOR "$DATA_DIR/manager-templates/sawyer-next/PREFERENCES.md"
printf 'sawyer-next\n' > "$DATA_DIR/manager-templates/active"
```

Promoting current preferences:

Managers see their storage path in runtime context. To save the current
manager's `PREFERENCES.md` and status app starter state to the default
template:

```bash
DATA_DIR="${BB_DATA_DIR:-$HOME/.bb}"
THREAD_STORAGE="/absolute/path/from-manager-runtime-context"
mkdir -p "$DATA_DIR/manager-templates/default/apps/status"
cp "$THREAD_STORAGE/PREFERENCES.md" \
  "$DATA_DIR/manager-templates/default/PREFERENCES.md"
cp -R "$THREAD_STORAGE/apps/status/." \
  "$DATA_DIR/manager-templates/default/apps/status/"
printf 'default\n' > "$DATA_DIR/manager-templates/active"
```

Copy `ASYNC.md` or additional `apps/<id>/` directories into the same template
directory when those starter files should be shared too.

Limitations and gotchas:

- There is no dedicated CLI or UI for changing `active`.
- Template file contents are not schema-validated before copying.
- Symlinks and other non-regular files are ignored.
- Existing thread storage files are never overwritten by seeding.
- A user-authored `default/` directory fully replaces the bundled fallback,
  even if it is empty.
- Missing selected non-default templates skip seeding instead of falling back
  to `default`.

Related guides:

  bb guide overview
  bb guide managers
  bb guide app
  bb guide async
