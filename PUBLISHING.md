# Publishing EnvShield

## Before anything: three fields to replace

The repository ships with placeholders. Publishing without changing them produces
a broken Marketplace page.

| File           | Field            | Current (placeholder)                        | Must become                   |
| -------------- | ---------------- | -------------------------------------------- | ----------------------------- |
| `package.json` | `publisher`      | `envshield`                                  | Your Marketplace publisher ID |
| `package.json` | `repository.url` | `https://github.com/envshield/envshield.git` | Your real repository          |
| `package.json` | `bugs.url`       | same                                         | Your real issue tracker       |

**Why `repository.url` matters more than it looks:** `vsce` rewrites every
relative image path in `README.md` to
`<repository>/raw/HEAD/<path>` when packaging. The logo and the four screenshots
all go through this rewrite. If the repository does not exist or is private, the
Marketplace page shows five broken images. Verify with:

```bash
npx vsce package --no-dependencies
unzip -p envshield-1.0.0.vsix extension/readme.md | grep -o 'https://[^ ")]*\.png'
```

Every URL printed must resolve in a browser.

The screenshots themselves (`images/screenshot-*.png`) are placeholders and do
not exist yet. Either produce them and commit them, or remove the Screenshots
section from `README.md` before publishing.

## One-time setup

1. **Microsoft account** — any personal account works.

2. **Azure DevOps organization** — <https://dev.azure.com>. The Marketplace uses
   it only for authentication; you never have to host code there.

3. **Personal Access Token (PAT)** — Azure DevOps → user icon (top right) →
   _Personal access tokens_ → _New Token_:

   - **Organization: `All accessible organizations`** — the most common cause of
     a `401 Unauthorized` at publish time is leaving this on a single org.
   - **Scopes:** _Custom defined_ → _Marketplace_ → tick **Manage**.
   - Expiration: up to one year.

   Copy the token immediately; it is shown once.

4. **Create the publisher** —
   <https://marketplace.visualstudio.com/manage/createpublisher>.

   The **publisher ID is permanent** and becomes part of the extension URL
   (`marketplace.visualstudio.com/items?itemName=<publisher>.envshield`) and of
   the install command. Choose it carefully; it cannot be renamed later.

5. **Set it in the manifest** — `package.json` → `"publisher": "<your-id>"`. It
   must match the publisher exactly, or publishing is rejected.

## Publishing

```bash
npx vsce login <your-publisher-id>   # paste the PAT when prompted
npx vsce publish
```

`vsce publish` runs `vscode:prepublish` first, which is wired to
`npm run check && npm run build -- --minify` — typecheck, lint, format check and
the 165 unit tests all have to pass before anything is uploaded. That gate is
deliberate: keep it.

The extension appears in search within a few minutes; the page itself is live
immediately.

### Releasing a new version

Never edit `version` by hand. Let `vsce` bump the manifest and create the tag:

```bash
npx vsce publish patch    # 1.0.0 -> 1.0.1
npx vsce publish minor    # 1.0.0 -> 1.1.0
npx vsce publish major    # 1.0.0 -> 2.0.0
```

Add the corresponding section to `CHANGELOG.md` first: the Marketplace renders it
as the extension's _Changelog_ tab.

### Publishing without a PAT

If you would rather not create a token, upload the `.vsix` by hand:

1. `npx vsce package --no-dependencies`
2. <https://marketplace.visualstudio.com/manage> → your publisher →
   _New extension_ → _Visual Studio Code_ → drop the `.vsix`.

Same result, but you have to repeat it for every release.

## Installing locally, without the Marketplace

To test the real packaged artifact, or to use it privately:

```bash
npx vsce package --no-dependencies
code --install-extension envshield-1.0.0.vsix
```

This is also how you distribute it inside a company without publishing.

## Open VSX (optional)

VSCodium, Cursor, Windsurf, Gitpod and Eclipse Theia do not use the Microsoft
Marketplace. For an extension aimed at streamers — an audience that skews toward
those editors — publishing to Open VSX as well is usually worth it:

```bash
npx ovsx create-namespace <your-publisher-id> -p <open-vsx-token>
npx ovsx publish envshield-1.0.0.vsix -p <open-vsx-token>
```

Tokens come from <https://open-vsx.org> (sign in with GitHub → _Access Tokens_).

## Pre-flight checklist

- [ ] `publisher` is your real publisher ID
- [ ] `repository.url` and `bugs.url` point to a real, **public** repository
- [ ] The repository is pushed, so the README images resolve
- [ ] Screenshots exist, or the Screenshots section is removed
- [ ] `LICENSE` names the right copyright holder
- [ ] `CHANGELOG.md` has a section for this version
- [ ] `npm run check` passes
- [ ] `npm run test:integration` passes
- [ ] Installed the `.vsix` locally and opened a real `.env` file once
