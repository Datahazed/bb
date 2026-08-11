# Releasing @get-bb/plugin-sdk

This runbook covers the independently versioned `@get-bb/plugin-sdk` npm package.
The SDK is released only when its public plugin API or testing harness changes;
it does not share `bb-app`'s release cadence.

The normal release path is the manual
[`publish-plugin-sdk.yml`](../.github/workflows/publish-plugin-sdk.yml) workflow
with npm Trusted Publishing. Do not run `npm publish` locally unless the user
explicitly requests the bootstrap or emergency fallback.

## Release Policy

- Publish only from `main` and only the version committed in
  `packages/plugin-sdk/package.json`.
- While the SDK is pre-1.0, compatible additions bump the patch and breaking
  changes bump the `0.x` minor.
- Keep `packages/plugin-sdk/package.json` and
  `packages/domain/src/plugin-sdk-version.ts` at the same version.
- Update every checked-in plugin's `engines.bbPluginSdk` range, the plugin
  guide, the CLI and plugin-authoring skills, and generated templates when the
  compatibility range changes.
- Keep the legacy `@bb/plugin-sdk` and `@bb/plugin-sdk/app` host aliases for
  previously scaffolded plugins; only the `@get-bb` package is published.
- Publish the tarball produced by `smoke:tarball`. The release workflow tests
  and publishes that exact file rather than packing twice.
- Do not move the `latest` npm dist-tag to a prerelease unless explicitly
  approved.

## One-Time npm Setup

Before the first release, an npm organization owner must confirm that the
public `@get-bb` scope is controlled by the project. npm requires the package to
exist before its Trusted Publisher can be configured, so the initial public
package publication may require a one-time owner-authenticated bootstrap with
`--access public`. After that bootstrap, configure the package's GitHub Actions
Trusted Publisher with these exact values:

- repository: `get-bb/bb`
- workflow: `publish-plugin-sdk.yml`
- environment: `npm-release`

Keep the workflow in dry-run mode until the scope, package ownership, GitHub
environment, and Trusted Publisher are all verified.

## Prepare A Release

1. Refresh the release branch from `main` and check npm state:

   ```bash
   git fetch origin main
   git rebase origin/main
   npm view @get-bb/plugin-sdk version dist-tags versions --json
   ```

   An `E404` is expected only before the first publication.

2. Choose a version according to the pre-1.0 release policy. Update the
   package version, `PLUGIN_SDK_VERSION`, compatibility ranges, author-facing
   docs, and generated templates together. Search project-wide for stale
   versions before continuing.

3. Install and run the focused release checks:

   ```bash
   pnpm install --frozen-lockfile
   pnpm exec turbo run typecheck test --filter=@get-bb/plugin-sdk --filter=@bb/templates --force --output-logs=new-only
   pnpm exec turbo run smoke:tarball --filter=@get-bb/plugin-sdk --force --output-logs=new-only
   git diff --check
   ```

   The smoke test creates `.tmp/plugin-sdk-release/bb-plugin-sdk.tgz`, installs
   it into a clean npm consumer using the README commands, and exercises both
   backend and frontend harnesses.

4. Review the tarball without repacking it:

   ```bash
   npm publish .tmp/plugin-sdk-release/bb-plugin-sdk.tgz --dry-run --access public
   ```

5. Merge the release commit to `main`.

## Publish And Verify

Start with a dry run:

```bash
gh workflow run publish-plugin-sdk.yml \
  --ref main \
  -f npm_tag=latest \
  -f allow_prerelease_latest=false \
  -f dry_run=true
```

Inspect the workflow logs and artifact preview. When the dry run is clean and
publication is approved, repeat with `dry_run=false`. The workflow rejects a
version already present on npm, validates prerelease tags, builds and tests the
focused packages, smoke-tests a clean consumer, publishes the tested tarball
with OIDC, and waits for the version and dist-tag to appear in the registry.

After it succeeds, independently verify:

```bash
npm view @get-bb/plugin-sdk version dist-tags versions --json
npm install --save-dev @get-bb/plugin-sdk vitest better-sqlite3 zod @types/better-sqlite3
```

Report the commit, package version, npm tag, workflow run, and clean-install
result. npm versions are immutable; fix a bad publication with a new version,
not by attempting to overwrite it.
