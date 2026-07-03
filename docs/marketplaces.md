# Publishing & releases

This extension ships through three channels, all driven by a git tag:

- **VS Code Marketplace** — for VS Code users
- **Open VSX** — for Cursor / VSCodium / Windsurf (they can't reach the MS Marketplace)
- **GitHub Releases** — the raw `.vsix`, no account required to install

The Pi companion (`pi/pi-vscode-context.ts`) is bundled inside the `.vsix` and
auto-installs on startup, and is also published as a pi package via git.

## One-time setup

### VS Code Marketplace

1. Create a publisher at <https://marketplace.visualstudio.com/manage>. Its ID
   must match the `publisher` field in `package.json`.
2. Create an Azure DevOps Personal Access Token:
   - <https://dev.azure.com/> → User settings → Personal Access Tokens
   - **Organization**: *All accessible organizations*
   - **Scopes**: *Marketplace → Manage*
3. Store it as the GitHub Actions secret `VSCE_PAT`:
   ```sh
   gh secret set VSCE_PAT --repo <owner>/<repo>
   ```

### Open VSX

1. Log in at <https://open-vsx.org> with GitHub.
2. Sign the Eclipse Foundation Publisher Agreement (required before publishing).
3. Create an access token at <https://open-vsx.org/user-settings/tokens>.
4. Create your namespace (matches `publisher` in `package.json`), once:
   ```sh
   npx ovsx create-namespace <publisher> -p "<token>"
   ```
5. Store the token as the GitHub Actions secret `OVSX_PAT`:
   ```sh
   gh secret set OVSX_PAT --repo <owner>/<repo>
   ```

> Both secrets are optional in CI: the corresponding publish step is skipped
> when its secret is absent (see `.github/workflows/release.yml`).

## Cutting a release

1. Bump `version` in `package.json`.
2. Commit and tag:
   ```sh
   git add package.json package-lock.json
   git commit -m "chore: vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
3. The `release` workflow (triggered by the `v*` tag) builds the `.vsix`,
   creates a GitHub Release, and publishes to any marketplace whose token is set.

Watch it:
```sh
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

## Manual publish (backfill / one-off)

Build the `.vsix` first (`npm run package`), then:

```sh
# VS Code Marketplace
npx vsce publish --packagePath <name>-<version>.vsix   # or: npx vsce login <publisher>

# Open VSX
npx ovsx publish <name>-<version>.vsix -p "<token>"
```

Verify a marketplace token without publishing:
```sh
npx vsce verify-pat <publisher> -p "<token>"
```

## Notes & gotchas

- **Extension name must be globally unique** on the VS Code Marketplace, not
  just per-publisher. If `vsce publish` reports *"already exists in the
  Marketplace"*, change `name` in `package.json` (the `displayName` can stay).
- A given version can only be published **once** per marketplace. Re-running a
  release for an already-published version fails on that step; cut a new
  version instead.
- Never commit tokens. Keep them in `.env` (gitignored) locally and in GitHub
  Actions secrets for CI.
- If a `git push` of a tag is rejected for *email privacy*, commit with your
  GitHub `noreply` address (`git config user.email
  <id>+<user>@users.noreply.github.com`).
