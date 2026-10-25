# Contributing

Thanks for taking a look at `dsh-workspace-cleaner`. This document covers local
development, the sandbox rule for destructive tests, and the release checklist.

## Requirements

- Node.js >= 22 (the plugin targets the Node runtime shipped with DSH).
- A DSH installation with the Web UI (`dsh web`) if you want to see the page.
- No dependencies: `node --check`, `node test/*.test.mjs` and `node` alone are
  enough. There is no build step and no bundler.

## Layout

```
package.json          manifest: name/version/exports + dsh.bundle / dsh.client
cordis.patch.yml      bundle patch that mounts the Host half
lib/index.js          Host half: HTTP routes, deletion pipeline, event broadcast
lib/store.js          Cordis-free fs/state helpers (pure, sandbox-testable)
lib/client.js         Client half: window.__ModuleLoader__ settings.section page
locale/{zh,en}.json   plugin-manager title/description metadata
icon.svg              plugin icon shown by the plugin manager
test/*.test.mjs       package + store + http + client-smoke tests
```

## Run the tests

```bash
node --check lib/index.js && node --check lib/store.js && node --check lib/client.js
node test/package.test.mjs
node test/store.test.mjs
node test/http.test.mjs
node test/client.smoke.test.mjs
```

or simply `npm test` (same four files, no install step needed).

### Why `node --test test/` is not used

`node --test test/` spawns a child process per file. In a sandboxed DSH session
that spawn can fail with `Error: spawn EPERM`; running each file directly keeps
the suite working inside and outside DSH. Keep the `npm test` script in that
form.

## The sandbox rule for deletions

**Never point a test run at a real DSH home.** The test suites create a fake
home with `mkdtemp()` and write their own `storages/workspace.json`, session
log directories and projection cache files there. Keep it that way:

- `store.js` functions accept an explicit `home` and refuse paths outside it
  (`assertInside`), so tests can use any temporary directory.
- `index.js` reads `DSH_HOME` (or the `dshHome` plugin Config) only through
  `store.resolveDshHome`; tests call the HTTP handler with a fake `ctx` and a
  sandbox home instead of starting a server.

If you need to try the real thing, install the plugin on a throwaway profile
(`DSH_HOME` pointed at a temporary directory) and delete conversations created
for that purpose only.

## Try it in a running DSH

1. Install the directory as a bundle:

   ```
   plugin_manager install_bundle <absolute path to this directory>
   ```

   The profile receives a `link:` dependency and the package name in
   `dsh.profile.bundles`.

2. Open **设置 → 工作区清理**. The Client half is loaded by the Web UI, so a
   page refresh is enough for client changes.

3. Host changes (`lib/index.js`, `lib/store.js`) need the Host module graph to
   reload: fully restart DSH, or toggle the bundle off and on again
   (`plugin_manager set_bundle` with `enabled: false` then `true`), which
   remounts it without a restart as long as the package itself never failed to
   load.

## Conventions

- **UTF-8 without BOM, LF line endings.** A BOM in `package.json` makes DSH
  report `包不可用: Unexpected token ''`. `test/package.test.mjs` guards this.
  If you are on Windows, do not rewrite these files with PowerShell 5.1
  `Set-Content -Encoding utf8` (it writes a BOM and reads ANSI); use the editor
  or `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`.
- **Theme tokens only.** Client CSS uses `--dsw-alias-*` variables; do not
  hard-code colours or import the Harness primitives packages.
- **No third-party runtime dependencies.** The Host half uses `node:fs`,
  `node:path`, `node:os` only; the Client half receives React from the loader.
- **Deleting is the product.** Any change to the deletion pipeline must keep:
  artifacts removed before registrations, refused deletions untouched, and a
  successful delete announced through `api-session/removed` so the UI does not
  leave rows behind under 未分组.
- Keep the test count message in `README.md` in sync when you add tests.

## Release checklist

1. The repository metadata already points at
   `github.com/sleeepingbeee/dsh-workspace-cleaner` (`package.json`
   `repository`/`homepage`/`bugs`, README badges, CHANGELOG compare links). Update
   those four places if the repository ever moves.

2. Bump `version` in `package.json` and `VERSION` in `lib/index.js` together,
   and add a `CHANGELOG.md` entry.
3. Run `npm test`; all suites must pass.
4. Commit, tag `vX.Y.Z`, push the tag.
5. Publish to npm (optional): the `release` workflow publishes on a `v*` tag
   using the `NPM_TOKEN` repository secret, or run `npm publish` locally.
6. Create the GitHub release from the tag and paste the changelog entry.
