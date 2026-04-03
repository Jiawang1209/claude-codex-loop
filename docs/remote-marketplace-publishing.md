# Remote Marketplace Publishing Plan

## Summary

Claude Codex Loop already supports a repository-local marketplace:

- The marketplace manifest lives at [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json).
- The plugin manifest lives at [`plugins/claude-codex-loop/.claude-plugin/plugin.json`](../plugins/claude-codex-loop/.claude-plugin/plugin.json).
- The current plugin entry uses a local `source` path (`./plugins/claude-codex-loop`).

That is enough for local development and local installation, but it is not enough for a true remote marketplace. A remote marketplace needs a stable remotely accessible manifest plus remotely accessible plugin artifacts for every released version.

## Goals

- Preserve the current local marketplace workflow for contributors.
- Add a release path that lets end users install without cloning the repository first.
- Keep versioning aligned across `package.json`, `plugin.json`, and `marketplace.json`.
- Make remote installs deterministic by publishing immutable versioned plugin artifacts.

## Non-goals

- Replacing the local development workflow.
- Introducing a hosted control plane for Claude Codex Loop itself.
- Changing the plugin runtime architecture.

## Current Gap

Today, the marketplace entry is:

```json
{
  "name": "claude-codex-loop",
  "source": "./plugins/claude-codex-loop"
}
```

That works only when Claude Code reads the marketplace from a local checkout. A remote marketplace cannot rely on a relative local filesystem path on the installer's machine.

## Recommended Publishing Model

Use a dual-mode distribution model:

1. Keep the existing repository-root `marketplace.json` for local development.
2. Publish a second, release-only remote marketplace manifest whose plugin entries point to versioned downloadable artifacts.

This keeps contributor ergonomics simple while giving end users a clean install story.

## Release Artifact Shape

Each release should publish a self-contained plugin bundle that includes:

- `.claude-plugin/plugin.json`
- `server/bridge-server.js`
- `server/daemon.js`
- `commands/`
- `hooks/`
- `scripts/`
- any static assets the plugin needs at runtime

Recommended packaging:

- Build plugin bundles with `bun run build:plugin`.
- Copy `plugins/claude-codex-loop/` into a clean release staging directory.
- Produce a versioned archive such as `claude-codex-loop-plugin-0.1.4.tar.gz` or `.zip`.
- Upload the archive to a stable release host.

Possible release hosts:

- GitHub Releases assets
- a static CDN bucket
- a project website with immutable versioned download URLs

## Remote Marketplace Manifest

Add a release artifact for a remote marketplace manifest, for example:

- `dist/marketplace/marketplace.json`

The release manifest should be generated during release and should not use local relative paths. Instead, each plugin entry should point to a remote artifact URL supported by Claude Code's marketplace loader.

Because Claude Code's exact remote marketplace schema and URL semantics must be verified against the CLI, the implementation should treat this as a compatibility boundary. Before rollout, validate:

- whether `plugin marketplace add` accepts a URL, a GitHub slug, or both
- whether plugin `source` may be an archive URL, directory URL, or manifest URL
- whether checksums or signatures are supported or required
- whether marketplace updates require immutable version URLs

## Recommended Repository Changes

### 1. Keep local manifests as-is

Continue to use:

- [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
- [`plugins/claude-codex-loop/.claude-plugin/plugin.json`](../plugins/claude-codex-loop/.claude-plugin/plugin.json)

for local install and development flows.

### 2. Add a generated remote manifest

Create a release script or generator that:

- reads the plugin name and version from `plugin.json`
- reads the package version from `package.json`
- verifies they match
- writes a remote marketplace manifest with remote `source` URLs

This should be generated, not hand-maintained, to avoid drift.

### 3. Add release-time validation

Extend release validation so CI fails if:

- versions differ between `package.json`, `plugin.json`, and generated marketplace output
- required plugin runtime files are missing from the release bundle
- remote artifact URLs are malformed

### 4. Document two install modes

The README should continue to distinguish:

- local marketplace install: supported now
- remote marketplace install: available only after remote publishing is set up

## Suggested Release Flow

1. Update versions in `package.json`, local `plugin.json`, and local `marketplace.json`.
2. Run `bun run build:plugin`.
3. Stage a clean plugin bundle from `plugins/claude-codex-loop/`.
4. Archive the staged bundle into a versioned artifact.
5. Upload the artifact to the chosen release host.
6. Generate a remote marketplace manifest that points to that uploaded artifact.
7. Publish the manifest at a stable URL.
8. Validate installation from a clean machine or sandboxed test environment.
9. Only then document the remote `plugin marketplace add ...` command in the README.

## Documentation Policy

Until the remote marketplace flow is validated end to end, avoid documenting a remote install command such as:

```bash
/plugin marketplace add liuyue/claude-codex-loop
```

Instead, document the repository-local marketplace flow and link to this plan for future remote publishing work.

## Open Questions

- What exact remote marketplace input forms does the installed Claude CLI support today?
- Does Claude Code expect remote plugin sources to be archives, directories, or manifests?
- Are signatures, hashes, or provenance metadata required for remote distribution?
- Can marketplace auto-update work against a custom remote manifest, and if so, what version resolution rules apply?

These questions should be answered with CLI-level validation before implementing the remote path.
