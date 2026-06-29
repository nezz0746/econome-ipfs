# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Publishable packages (currently `payload-storage-ipfs`) are versioned here; the
private apps (`web`, `api`) and internal `@repo/*` packages are ignored.

- Add a changeset describing your change: `pnpm changeset`
- Apply pending changesets to bump versions + changelogs: `pnpm version-packages`
- Build and publish to npm: `pnpm release`
