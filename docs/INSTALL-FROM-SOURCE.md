# Installing dsh-openwolf from Source / Local Checkout

The normal install path is one line (npm or a tarball) and needs **no
authorization** — see the main [README](../README.md#quick-start). This
document is only for people who want to run the plugin from a git checkout or
a local development copy.

## From a local checkout (development)

```sh
# inside the dsh-openwolf repo
pnpm install
pnpm build        # tsc → lib/

# add the local checkout as the plugin for a profile
dsh plugin --profile <name> add ./dsh-openwolf
```

The package is **erasable TypeScript** with `rewriteRelativeImportExtensions`,
so `node` can run `src/` directly for tests while `tsc` emits the ESM `lib/`
for publication. `prepare` builds from source, which is what makes git-based
installs work.

## From a git URL

```sh
dsh plugin --profile <name> add github:hawk2048/dsh-openwolf
```

A git install pulls **source, not build output**, so the first `add` fails
until you authorize the package's build in the profile's
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-openwolf: true
```

Then re-run `add`. Installing from npm or a tarball never needs this entry.

## Trying a local build against a running harness (no publish)

```sh
pnpm build
dsh plugin --profile <name> add ./dsh-openwolf
dsh --profile <name> --dump-config | grep -A2 openwolf
```

## Running tests

```sh
pnpm install
pnpm build        # tsc → lib/
pnpm test         # node --test, in-process (no subprocess runner)
```
