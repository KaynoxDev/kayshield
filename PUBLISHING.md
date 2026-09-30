# Publishing KayShield

## Manifest status

Every placeholder is gone: `publisher` is `KaynoxDev`, and `repository`, `bugs`
and `homepage` point at <https://github.com/KaynoxDev/kayshield>, from which the
README images resolve.

The extension identifier is `KaynoxDev.kayshield`. It is never hardcoded in the
source - the settings menu reads it from `context.extension.id` and the
integration suite from the manifest - so changing the publisher cannot leave a
stale literal behind.

**Why `repository.url` matters more than it looks:** `vsce` rewrites every
relative image path in `README.md` to `<repository>/raw/HEAD/<path>` when
packaging. The logo and the screenshots all go through this rewrite, so a
repository that is missing, renamed or private turns the Marketplace page into a
wall of broken images. Re-check after any change to the README or the repo:

```bash
npm run package
unzip -p kayshield-1.0.0.vsix extension/readme.md   | grep -oE 'https://[^ ")]*\.png' | sort -u   | while read -r url; do echo "$(curl -s -o /dev/null -w '%{http_code}' -L "$url")  $url"; done
```

Every line must start with `200`.

## The short path: no token, no Azure DevOps

All you strictly need is a Microsoft account and a publisher.

1. **Create the publisher** —
   <https://marketplace.visualstudio.com/manage/createpublisher>, signing in
   with any Microsoft account.

   The **publisher ID is permanent**. It becomes part of the extension URL
   (`marketplace.visualstudio.com/items?itemName=<publisher>.kayshield`) and of
   the install command, and it cannot be renamed later.

2. **Set it in the manifest** — `package.json` → `"publisher": "<your-id>"`. It
   must match exactly, or the upload is rejected.

3. **Build and upload**

   ```bash
   npm run package
   ```

   Then <https://marketplace.visualstudio.com/manage> → your publisher →
   _New extension_ → _Visual Studio Code_ → drop `kayshield-1.0.0.vsix`.

That is the whole process. The trade-off is that every future release means
repeating the build and the upload by hand.

An Azure DevOps organisation is **not** required for this path. If the sign-up
flow offers to create one anyway, it is free and it is only a namespace - not a
company, and unrelated to Azure the cloud platform, which is the paid product
people usually have in mind.

## The longer path: publishing from the command line

Worth setting up once you release often enough that the manual upload becomes
tedious. It replaces steps 3 above with a single command.

1. **Azure DevOps organisation** — <https://dev.azure.com>. Free tier, no card.
   It is used only to issue the token; you never host code there.

2. **Personal Access Token (PAT)** — Azure DevOps → user icon (top right) →
   _Personal access tokens_ → _New Token_:

   - **Organization: `All accessible organizations`** — the most common cause of
     a `401 Unauthorized` at publish time is leaving this on a single org.
   - **Scopes:** _Custom defined_ → _Marketplace_ → tick **Manage**.
   - Expiration: up to one year.

   Copy the token immediately; it is shown once. It belongs in your terminal and
   nowhere else - never in a chat, an issue or a commit.

3. **Publish**

   ```bash
   npx vsce login <your-publisher-id>   # paste the PAT when prompted
   npx vsce publish
   ```

`vsce publish` runs `vscode:prepublish` first, which is wired to
`npm run check && npm run build -- --minify` - typecheck, lint, format check and
the unit tests all have to pass before anything is uploaded. That gate is
deliberate: keep it.

The extension appears in search within a few minutes; the page itself is live
immediately.

### Releasing a new version

Never edit `version` by hand. Let `vsce` bump the manifest:

```bash
npx vsce publish patch    # 1.0.0 -> 1.0.1
npx vsce publish minor    # 1.0.0 -> 1.1.0
npx vsce publish major    # 1.0.0 -> 2.0.0
```

Add the matching section to `CHANGELOG.md` first: the Marketplace renders it as
the extension's _Changelog_ tab.

On the manual path, bump `version` in `package.json` yourself, then rebuild and
re-upload.

## Installing locally, without the Marketplace

To test the real packaged artifact, or to use it privately:

```bash
npx vsce package --no-dependencies
code --install-extension kayshield-1.0.0.vsix
```

This is also how you distribute it inside a company without publishing.

## Open VSX (optional)

VSCodium, Cursor, Windsurf, Gitpod and Eclipse Theia do not use the Microsoft
Marketplace. For an extension aimed at streamers — an audience that skews toward
those editors — publishing to Open VSX as well is usually worth it:

```bash
npx ovsx create-namespace <your-publisher-id> -p <open-vsx-token>
npx ovsx publish kayshield-1.0.0.vsix -p <open-vsx-token>
```

Tokens come from <https://open-vsx.org> (sign in with GitHub → _Access Tokens_).

## Pre-flight checklist

- [x] `repository.url`, `bugs.url` and `homepage` point at a real public repository
- [x] The repository is pushed, so the README images resolve
- [x] Screenshots exist and are committed
- [x] `LICENSE` names the right copyright holder
- [x] `CHANGELOG.md` has a section for this version
- [x] `npm run check` passes
- [x] `npm run test:integration` passes
- [x] The `.vsix` was installed locally and opened on a real `.env` file
- [x] `publisher` is your real publisher ID
- [ ] No real `.env` is tracked by git (`git ls-files | grep -x .env` must print nothing)
