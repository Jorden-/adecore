# basmilius/adecore

The core that agentic development environments share, released together under one version. Every app that uses it is a variant of one: a desktop app on Electron in which a person works with agents. `@adecore/ui` (`packages/ui`) is the page's: components, a theme, formatters and a settings dialog, on React 19, Base UI, Lucide and Tailwind 4. `@adecore/terminal` (`packages/terminal`) is a terminal pane on xterm.js for the page. `@adecore/shell` (`packages/shell`) is the main process's: the application menu, the updater, the set of windows with their state and the web guards. Up to `0.13.x` they were `@basmilius/desktop-ui` and `@basmilius/desktop-shell`, in `basmilius/desktop`; `@adecore/ui` was `@basmilius/react-ui` before that, up to `0.4.x`. Each package's `README.md` is for people who use it; this file is for agents who work on it.

## Who uses it

Three apps, and later more:

- Ruimte, `../ruimte` (`/Users/bas/Development/Projects/ruimte`, public). The UI is in `apps/client/src` and `packages/agents-react/src`, the shell in `apps/desktop/src` and `packages/desktop-bridge/src`. Its root `CLAUDE.md` holds its design rules.
- AfterMotion, `../aftermotion` (`/Users/bas/Development/Projects/aftermotion`, private). The UI is in `apps/client/src`, the shell in `apps/desktop/src` and `packages/desktop-bridge/src`.
- Solvidi Command Center, `../../Axilium/Solvidi/command-center` (`/Users/bas/Development/Axilium/Solvidi/command-center`, private, `solvidi/command-center`). The UI is in `apps/client/src`, the shell in `apps/desktop/src` and `packages/desktop-bridge/src`. Its issues carry the `Command Center` label.

Each depends on the release on npm and swap in this checkout with `bun link` (run in the package's folder) while a change is in progress. They read `src` through the `source` export condition, so none needs a build of it.

An issue from any app has three sections: `## Problem` (what is missing or wrong, with the app's call sites and its workaround), `## Wish` (the need, not a fix) and `## Impact on <the other apps>` (their call sites a change would touch). Take the impact section as a starting point, not as the answer: read the call sites in every app yourself before you choose an API. An issue that lacks a section gets a comment asking for it before any work starts.

## Changing the public API

- Before you change anything an entry point exports (a name, a prop, a default, a class a component puts on its element), read its call sites in every app: `grep -rn "<Name\b" ../ruimte/apps/client/src ../ruimte/packages/agents-react/src ../aftermotion/apps/client/src ../../Axilium/Solvidi/command-center/apps/client/src` for `ui`, and `grep -rn "\bname\b" ../ruimte/apps/desktop/src ../ruimte/packages/desktop-bridge/src ../aftermotion/apps/desktop/src ../aftermotion/packages/desktop-bridge/src ../../Axilium/Solvidi/command-center/apps/desktop/src ../../Axilium/Solvidi/command-center/packages/desktop-bridge/src` for `shell`.
- A request from one app gets a shape that describes the need, not the app. The answer may be a different API than the one asked for, or a no: something only one app needs stays in that app.
- No option exists for one app only unless its shape is generic enough that a third app could want it.
- A breaking change lists the call sites in every app, carries a migration note in the PR, and gets the `Breaking` label.
- Library code, `README.md` and any docs never name the apps. Describe the need ("a panel along the right edge", "a dialog opened over another"). Only this file and the issue templates may name them.
- `packages/ui/src/__snapshots__/exports.test.ts.snap` lists every exported name, types included, and the parts of every compound component. A change there is an API change: accept it with `bun test --update-snapshots` only when you meant it.

## Layout

Bun workspaces: every package in `packages/`, published from its own folder with the `files` whitelist in its `package.json`, and the docs site in `docs`. The root holds the shared config (`tsconfig.base.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.editorconfig`) and the scripts that run over every package. Paths in the list below are relative to `packages/ui` unless they start with `docs`; `shell` has a section of its own.

- `src/index.ts`: the barrel, `@adecore/ui`. Explicit named exports only, no `export *` except the `export * as` of a compound component.
- `src/settings/index.ts`, `src/format/index.ts`, `src/testing/index.ts`: the other entry points. `src/testing/dedupe.ts` is one too, a `bun test` preload that exports nothing.
- `src/theme.css`: the tokens, the type scale and the rules utilities cannot write (`.icon-btn`, `.field`, `.menu-popup`, `.menu-item`, `.dialog-popup`, `.tooltip-popup`, ...). Exported as `./theme.css`.
- `src/menu`, `src/context-menu`, `src/dialog`, `src/popover`, `src/preview-card`: the compound components. `parts.tsx` holds the parts under their full names (`MenuItem`), `index.parts.ts` maps them onto the namespace (`Menu.Item`). A context menu reuses every part of a menu except its root and trigger.
- `src/locales/en.json`, `nl.json`: the `ui` namespace. English is the source; Dutch has every key English has (`locales.test.ts`).
- Internal modules (not exported): `dialog-layer.ts`, `popup-layer.ts`, `error-boundary.ts`, `file-icon.ts` except `FILE_TREE_ICONS`, `shortcut-hints.ts`, `wipe-split.ts`, `class-name.ts`, `merge-refs.ts`, `field-context.ts`, `placement.ts`, `icon-button-size.ts`, `icon-picker.ts` except the type `IconPickerGroup`, `zoom.ts` except `ZOOM_PRESETS`.
- `scripts/build.ts`: `tsc` into `dist`, one `.js` and one `.d.ts` per source file, then the theme copied.
- `docs`: the VitePress site of every package at `https://adecore.dev`, deployed as a Cloudflare Worker with static assets (`wrangler.toml`) by `release.yml`, or from main by `docs.yml`. It resolves `@adecore/ui` to `src` through the `source` condition of every entry point (`.vitepress/library-source.ts`), so the docs never wait for a build. The home page and `docs/guide` cover the repository; each package has its own folder (`docs/ui`) and its own sidebar in `.vitepress/navigation.ts`, and its links start with that folder. A page shows a demo with `<Demo src="group/name" />`, which mounts `docs/demos/group/name.tsx` as a React island and prints the file under it; `docs/demos/shared` holds what demos import and is no demo. The theme page reads its tokens from `src/theme.css` at build time.
- `docs/docs.test.ts` fails when a name in the export snapshot or a part of a compound component is mentioned on no page; `docs/demos.test.tsx` renders every demo. Both run in `bun run test`, so a new export needs a line in the docs in the same change.

## shell

- `src/index.ts` is the main process (`@adecore/shell`), `src/bridge/index.ts` the shapes that cross IPC (`/bridge`). The bridge never imports Electron, so a preload and a page read it too (`boundary.test.ts`).
- Nothing in the package registers an IPC handler or listens to an app-wide Electron event; it only follows the windows and the app the app hands it (`window-state.ts`, `windows.ts` with its `attach(app)`). An app wires each channel behind its own check of the sender and calls in; a package that listened by itself would bypass that check.
- Electron and electron-updater are optional peers and imported as types only, so every decision is a pure function or a factory with its clock, timer and updater injected, and the tests run in Bun without Electron.
- The IPC channel names the package sends on (`menu:run`) are part of its API, as the preload of every app listens on them.

## database

- Three layers: the views and the client for the page (`.`), the host for the app's backend (`/host`, Bun or Node), and the Rust helper in `helper/` (binary `adecore-database`, SQLite through rusqlite and MySQL/MariaDB through mysql_async) that the host spawns. `/protocol` is the contract between all three and imports nothing; `/testing` is an in-memory fake of the protocol for demos and the apps' tests.
- The protocol is written in TypeScript (`src/protocol`) and mirrored by hand in `helper/src/protocol.rs`. `fixtures/protocol/*.json` are read by the tests on both sides; a change to a message changes the fixtures, both sides and `PROTOCOL_VERSION`.
- The host registers no channel, like `shell`: the app checks the sender and calls `handle(request, owner)`. Ruimte runs it in its Bun daemon, the Command Center in its Electron utility process.
- `bun run --cwd packages/database helper:check`, `helper:test` and `helper:build` run cargo. `bun run test:helper` runs `helper.integration.test.ts`, joining the page, host and helper outside the default suite. Local runs skip without a compatible release build; CI sets `ADECORE_REQUIRE_DATABASE_HELPER=1` so a missing or incompatible helper fails. The MySQL tests of the helper run when `ADECORE_TEST_MYSQL_URL` is set; CI runs them against MariaDB and MySQL.
- `examples/database` is a private Electron app over both sides. Bas starts it with `bun run --cwd examples/database start`.

## terminal

- `TerminalView` is the terminal Ruimte builds by hand in `apps/client/src/terminal/xterm.ts`, `webgl-budget.ts` and `webgl-slots.ts`, lifted out so Ruimte can switch to it with no change in behavior. Ruimte is the reference: a change here keeps what its `TerminalBody`, `LaunchTerminal` and `LoginTerminal` would do on top of it, or it is a breaking change.
- What only one app needs (Ruimte's key bindings, OSC 52, its registry of terminals) stays in the app and reaches xterm through `terminal` on the handle, never through a prop.
- The fit and the pointer fix under a scaled ancestor read private fields of xterm (`xterm-internals.ts`). Widening the peer range of `@xterm/xterm` means checking those fields first.
- `terminal.css` holds the `--term-*` tokens and the box; it relies on the `--accent`, `--selection` and `--font-mono` of the theme of `ui`, and the package imports nothing from `ui`.

## Scripts

- `bun run check`: typecheck and oxlint; a warning fails.
- `bun run test`: `bun test`, tests next to the code.
- `bun run build`: `dist`.
- `bun run format`: oxfmt.

All three of check, test and build pass before a commit, and so does `bun run --cwd docs build` when the docs changed. CI (`.github/workflows/ci.yml`) runs them on every push to main and every PR. Never start a dev or preview server; Bas runs the docs site himself when a change needs a look.

## Working here

- Work happens on `main`, and every commit there passes check, test and build: an app that links this checkout breaks with it.
- An issue closes through its commit: `Closes #<n>` in the message body, with a line on why this API and not the one proposed. Commit freely; push and release only when Bas asks.
- Never `git stash`, `git reset`, `git restore` or `git clean`, and never rewrite a commit: other agents may work in this checkout at the same time.

## Releases

- Releases are immutable once published, so a release starts as a draft: `gh release create v<version> --draft [--prerelease] --notes-file <notes>`, then `gh workflow run release.yml -f version=<version>`. The workflow tags the commit it runs on, sets the version in every package, checks, tests, builds, publishes every package that is not `private` with npm Trusted Publishing (a prerelease under `next`), deploys the docs and publishes the release last. Every `package.json` stays at `0.0.0`. A version already on npm is skipped, so a failed run can run again while the release is still a draft.
- A new package gets its first version on npm by hand, with a token, before its trusted publisher (`basmilius/adecore`, `release.yml`) can be set; until then it stays `private`.
- While the version is `0.x`, a breaking change bumps the minor and everything else the patch.
- An app takes a release only when its own repository bumps the version. Neither happens from here: after a release, name the version on the issues it closed so the apps know what to take.

## Design rules

`scripts/check-design-conventions.ts` checks UI and database sources during `bun run lint` using the shared rules in `scripts/design-conventions.ts`:

- Type in the sizes of the theme's scale, never a size in brackets, nothing below 12px.
- A hint is a `Tooltip`, never a `title`.
- Icons are 12, 14, 16 or 20px. An icon button draws the icon of its size (`icon-button-size.ts`) and never sets its own height, width or radius.
- A button with a word in it is a `Button`.
- Only `src/format` builds an `Intl` formatter.
- Colors are tokens of the theme: no hex, `rgb()` or `hsl()` in a component, and none in `theme.css` outside the two token blocks.
- Whole pixels: no fractional `px`, and every `rem` or `em` in the theme inside `round(…, 1px)`.
- Keyboard focus is the accent outline, never a ring. Labels are sentence case, never `uppercase`.
- A key listener on the window only where the list in the test says why.

And these, which the tests do not catch:

- The theme stays neutral. The app sets its own accent; nothing here assumes one.
- A border is an alpha over what is behind it. Every surface clips its background to the padding box (the base layer does that for all).
- Every component takes `className` and `ref` (React 19, no `forwardRef`). A part that is one element takes Base UI's `render` prop through `useRender`.
- Props follow Base UI: `value`/`onValueChange`, `checked`/`onCheckedChange`, `open`/`onOpenChange`. Variants and sizes are props, never class strings the caller passes. Nothing exports a class string.
- A component's own utilities and a caller's must not set the same property: Tailwind does not decide between two utilities by their order in `class`. Where a caller needs another value, that is a prop.
- No module does work at import time (`sideEffects` lists only the CSS and the test preload). A DOM write goes in an effect; a costly value is built on first use.
- Words live in the `ui` namespace, in English and Dutch. A component reads them through `useTranslation('ui')`, never through the global `i18next`.
- Every number, date and duration a person reads comes from `src/format`.

## Conventions

- TypeScript, React 19, Bun. 4 spaces, LF; `.editorconfig` is the rule.
- American English in code, comments, docs and UI text. Never an em dash or an en dash anywhere.
- Always curly braces, also for a one-line early return. No one-letter names except `i`, `e`, `x`, `y`.
- Arrow functions inside functions; a class method is never an arrow property. Named components are `function` declarations.
- Comments say why, never what the code already says. Keep the comment density of the file you are in.
- Conventional commits in English (`feat:`, `fix:`, `build:`, `ci:`, `docs:`, `test:`, `refactor:`). No attribution lines.

## Shared extraction and integration

Adecore owns reusable agent contracts, backend hosts and React views, merge algorithms, drawing, diagram and plan cores, generic user service managers, and the shared tree in UI/database. New packages stay private at `0.0.0` until first publication and Trusted Publishing are configured. Adecore also owns editor-core, editor, lsp and editor-react. Preserve their current limitations and remaining feature work; the extraction does not complete them.

Application catalogs/actions, full wire contracts, IPC sender checks/channels, CSP policy, account/auth product behavior, views/canvas navigation, daemon defaults and branding stay in consumers. A rename must preserve persisted records and wire shapes. No extracted implementation may import application aliases, `@ruimte/*` or a sibling application checkout.

During parallel work, each role owns its package implementation, package-local configuration and docs pages. Root package/config files, dependency installation, `bun.lock`, release/CI scripts, shared docs navigation and source resolution belong to build integration. Do not run independent installs, repository-wide formatting or change another role's files. Every package is FSL-1.1-MIT, like the repository, and keeps its own `LICENSE`. Preserve third-party licenses and provenance.

`scripts/workspaces.ts` discovers the package graph for builds and publication. Builds include internal development dependencies; publication uses runtime, optional and peer dependencies, skips private packages and rejects a public dependency on a private package. `release:version <version>` rewrites regular/optional internal dependencies to the exact version and peers to its caret range. Only release automation changes those manifests; the checked-in version stays `0.0.0`. Run build before check on a clean checkout because compiled exports use dependency declarations.

`bun run test` excludes provider integration tests and initializes English UI/chat namespaces through `scripts/test-preload.ts`. The UI dedupe preload runs first. `bun run test:pack` packs every workspace, validates source/default/declaration and asset targets, and executes Node and Bun consumers outside this checkout. It performs no publication or registry installation. CI builds and packs once with `bun run pack <directory>`; Node 22 and 24 independently validate the same tarballs with `bun run test:pack --artifacts <directory>`. Validation reads manifests and export targets from the extracted archives. Set `ADECORE_REQUIRE_NATIVE_BINARIES=1` in release validation after downloading native artifacts.

The minimum CLI version a model needs (`minCliVersion`, such as `2.1` or `2.1.4`) lives in the catalog JSON files beside the models, `packages/agents/src/providers/claude-models.json` and `codex-models.json`. The address book serves the same files, so a new minimum reaches machines without an app release. No model ships with one until its minimum is known.

Consumer integration remains a separate application change. Ruimte must replace agent package names and reusable feature imports, scan installed agent CSS sources in Tailwind, configure the existing persistence namespace to keep drafts/preferences, compose Adecore schemas without changing its wire protocol, and retain its CLI environment filtering and desktop permission checks. AfterMotion must first align its older UI/shell and agent behavior with the extracted versions; Command Center must supply its existing tree and host adapters. Verify default packed exports and linked `source` exports in each consumer. Do not remove any original implementation from Ruimte until the application has completely switched to Adecore and the entire migration has been validated; successful package checks alone do not authorize cleanup.

Ruimte's service adapter keeps its daemon spec, RUIMTE_HOME/RUIMTE_SERVICE, executable copying and npx cache policy. It supplies `description`, launchd `label`/`logFile` and systemd `unitName` to `@adecore/service`, together with uid/home/configHome/user and runtime adapters. `platformServiceManager` now accepts explicit options; `serviceDefinition` rejects unsupported platforms. Keep executable ownership checks, install authorization and linger prompts in the application.

Legacy compatibility data remains unchanged: `ChatSubagentItemSchema.origin` retains `'ruimte'`; `RUIMTE_SESSION_VARIABLES` and the `RUIMTE_HOOK_`/`RUIMTE_CONTEXT_` prefix filters prevent inherited session callbacks. `LEGACY_MENTION_DRAG_TYPE` retains `application/x-ruimte-mention` during coordinated producer/receiver migration. Library docs describe these legacy boundaries generically and link their source definitions; this maintenance guide records their exact spellings.

## Editor and language tooling

The editor family was transferred from Ruimte revision `9729144f0df3f25628f20cc283dee54f8d9e8162`. `editor-core` owns documents/history, `editor` owns the DOM engine and host-resolved keymaps, `lsp` owns transports and language-service contracts, and `editor-react` owns feature coordination and React displays. Hosts retain files/drafts/save permissions, routing, server process/install policy, AI orchestration and Git/provenance. Import both editor CSS assets after UI theme CSS, scan editor-react source with Tailwind, and initialize its editor locale namespace. Document current accessibility, bidi and language/performance limits. Editor core retains its Apache notice alongside transferred FSL provenance.

The PHP language server lives in `basmilius/language-server-php` (`/Users/bas/Development/Projects/language-server-php`), with its own releases and no npm package. `lsp` and `editor-react` stay generic over language servers; nothing here imports it.
