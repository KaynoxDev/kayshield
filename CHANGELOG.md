# Changelog

All notable changes to KayShield are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-07

First public release.

### Added

**Secure editor**

- `CustomTextEditorProvider` for `.env` files: a table of variables with sensitive
  values masked before the first frame is painted.
- Inline editing, renaming, deleting and adding variables, each producing the
  smallest possible text edit so comments, spacing and ordering are preserved.
- Name-only search, "Hide all", "Reveal all", and a one-click "Open as text".
- `Esc` acts as a panic gesture inside the editor.

**Detection**

- Scored detection model (0-100) with four severity bands.
- Name heuristics with tokenization and a penalty for explicitly public names.
- 22 built-in credential formats: GitHub, GitHub fine-grained, GitLab, AWS,
  JWT, Stripe, OpenAI, Anthropic, Discord (token and webhook), Slack (token and
  webhook), Google API keys, SendGrid, npm, Twilio, Square, Google OAuth
  secrets, PEM blocks, URLs carrying credentials and hardcoded bearer tokens.
- Entropy analysis with guards against URLs, paths, prose, booleans and numbers.
- User-defined patterns through `kayshield.secretPatterns`.
- `alwaysMask`, `neverMask` and `ignoredVariables` rules, with glob support.

**Streamer Mode and Screen Safe**

- `KayShield: Toggle Streamer Mode` (`Ctrl+Shift+Alt+E`), persisted across reloads.
- Reveal is refused on the extension host while engaged, not merely hidden in the UI.
- Panic button `KayShield: Hide All Secrets` (`Ctrl+Shift+Alt+H`) cancelling every
  timer and re-masking every surface.
- Automatic re-masking when the editor tab is hidden or the window loses focus.
- `ProtectionProvider` extension point for future protected surfaces.

**Workspace**

- KayShield section in the Explorer listing environment files and their variables.
- `KayShield: Scan Workspace` reporting hardcoded secrets in `.json`, `.yaml`,
  `.yml` and `.toml` as VS Code diagnostics.
- Ignored findings stored as salted SHA-256 fingerprints in `SecretStorage`.
- Status bar item with three states: Protected, _n_ revealed, Stream Safe.

**Privacy and safety**

- Entirely local: no network call, no telemetry, no analytics, no external API.
- `safeLog` redacts every message and argument; there is no bypass.
- Webview locked down with a strict CSP, nonce-gated scripts and restricted
  local resource roots.
- Bulk webview payloads never contain a plaintext secret; a revealed value is
  delivered on its own, one variable at a time.

**Project**

- English and French localization (manifest and runtime), plus a bundle checker.
- 163 unit tests (Vitest, jsdom for the webview) and 14 integration tests
  (real VS Code instance).
- ESLint, Prettier, strict TypeScript, esbuild bundling, zero runtime dependency.

### Known limitations

KayShield protects what it renders inside VS Code. The extension API provides no
way to mask the integrated terminal, the debug console, output channels owned by
other extensions, Git diff views, or anything outside the editor. These are
documented rather than faked.
