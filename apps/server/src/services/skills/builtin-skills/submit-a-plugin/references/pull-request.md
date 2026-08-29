# Marketplace validation and pull request

Read this file before you clone, validate, or submit the marketplace repository.

## Prepare a clean branch

Verify the GitHub account:

```sh
gh auth status
gh api user --jq .login
```

Create or reuse the submitter fork. Clone into a new directory:

```sh
gh repo fork get-bb/marketplace --clone=false
git clone https://github.com/GITHUB_LOGIN/marketplace.git /SAFE/NEW/PATH/marketplace
cd /SAFE/NEW/PATH/marketplace
git remote add upstream https://github.com/get-bb/marketplace.git
git fetch upstream main
git switch -c submit-PLUGIN_ID upstream/main
```

If upstream exists, verify its URL. Do not reuse a directory with unrelated
changes or overwrite an existing branch.

If gh is unavailable or authentication fails, continue with local preparation:

```sh
git clone https://github.com/get-bb/marketplace.git /SAFE/NEW/PATH/marketplace
cd /SAFE/NEW/PATH/marketplace
git switch -c submit-PLUGIN_ID
```

Prepare and validate the entry and listing assets. Return their paths, the
clone path, branch name, and results. Give the user these remaining steps:

1. Fork get-bb/marketplace.
2. Add the fork as a remote.
3. Push submit-PLUGIN_ID.
4. Open a pull request against get-bb/marketplace:main.

## Validate the marketplace

Install only marketplace dependencies. Do not run submitted plugin code during
this stage.

```sh
npm ci --ignore-scripts
npm run build
npm run check
git status --short
git diff --check
git diff -- entries/PLUGIN_ID.json icons/ screenshots/
```

Confirm:

- The entry ID matches the filename and plugin manifest.
- The public source contains the selected release and reviewed code.
- The source subdirectory is correct.
- The author account matches the pull request account.
- The description states observed user value.
- The entry has exactly one accepted category and never uses `Other`.
- Every screenshot is honest, vendored, and supported; an empty array means
  the plugin has no visual surface.
- The icon meets size, format, location, and reference rules.
- Both marketplace checks pass.

## Open the pull request

If `bb plugin listing list --json` includes this plugin, save the validated
draft before opening the pull request:

```sh
bb plugin listing save-draft PLUGIN_ID entries/PLUGIN_ID.json --json
```

Commit only the entry and listing assets. Do not commit dist/ or unrelated
files.

```sh
git add entries/PLUGIN_ID.json icons/PLUGIN_ICON
git add screenshots/PLUGIN_SCREENSHOTS
git commit -m "Add plugin entry: PLUGIN_ID"
git push -u origin submit-PLUGIN_ID
```

Open the pull request:

```sh
gh pr create \
  --repo get-bb/marketplace \
  --base main \
  --head GITHUB_LOGIN:submit-PLUGIN_ID \
  --title "Add plugin entry: PLUGIN_ID" \
  --body-file /SAFE/PATH/pr-body.md
```

For a saved draft, record the URL returned by `gh pr create`:

```sh
bb plugin listing record-submission PLUGIN_ID PULL_REQUEST_URL --json
```

Use the validated plugin ID in shell arguments. Keep display text in data files.

Follow the marketplace repository instructions. The pull request body must state:

- What the plugin does.
- The release source and selected range or ref.
- The plugin checks that passed.
- The marketplace checks that passed.
- Required permissions, external services, and relevant security facts.
