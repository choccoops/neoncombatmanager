# Publishing and updating Neon Combat Manager

Same process as Neon Hub, Neon At Home and Neon Market: pushing a version tag builds a release
with a `module.json` and `module.zip` that Foundry installs and updates from.

## Repository

The module is published from the public GitHub repository
[choccoops/neoncombatmanager](https://github.com/choccoops/neoncombatmanager), which is this
folder's `origin` remote. Builds run under its **Actions** tab; every push and pull request
also runs the checks and tests (CI).

**Manifest URL for Foundry's Install Module box:**

`https://github.com/choccoops/neoncombatmanager/releases/latest/download/module.json`

## Releasing an update

1. Make your changes on a branch, open a pull request, merge it into `main`.
2. Add a `## 1.1.0` section at the top of `CHANGELOG.md` (it becomes the release notes).
3. Set `"version"` in `module.json` to the same number.
4. Commit, tag and push on `main`:

```bash
git tag v1.1.0
git push && git push --tags
```

The build checks every script, the localization and the tests first, and stops the release if
anything fails.

## Moving to Foundry v13

See [docs/V13.md](docs/V13.md).
