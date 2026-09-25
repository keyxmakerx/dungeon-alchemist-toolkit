# Dungeon Alchemist Toolkit

A Foundry VTT v14 module: imports a Dungeon Alchemist multi-floor export into
one native multi-level Scene, and adds a stairs/portal system built on
Foundry's native `teleportToken` region behavior. Plain JS (ES modules), no
build step and no CI.

## Where things live

- `scripts/` — all module logic (ES modules). `scripts/portal/` is the
  stairs/portal subsystem. See `docs/ARCHITECTURE.md` for what each file does
  and the public `DA.*` API.
- `templates/` — Handlebars templates for the dialogs and panels.
- `styles/module.css` — all module CSS (widgets don't use separate files).
- `lang/en.json` — all user-facing strings; add new keys here, not literals.
- `test/*.test.mjs` — the automated tests, for the pure logic: folder→floor
  grouping and the wall-sense mapping.
- `assets/demo/` — sample Dungeon Alchemist export used in the README preview.

## Checking a change

- `node --check scripts/<file>.js` (and any file you touched) — there is no
  Foundry runtime available outside a live world, so this is the syntax gate.
- `for f in test/*.test.mjs; do node "$f"; done` — must stay green; they guard
  folder→floor parsing and the wall-sense mapping.
- Everything else is a live check in a running Foundry v14 world (see
  `docs/STAIRS-PORTAL-DESIGN.md` for the stairs system's live-verify list).

## Conventions that still apply

- GM-gate every write path (`requireGM()` from `scripts/util.js`).
- Build on native Foundry APIs (Scene Levels, Regions V2, `teleportToken`,
  level-aware navigation) — never scrape native DOM, never duplicate a native
  editor. Defer authoritative editing (level deletion, cross-level
  visibility) to Foundry's native Levels tab.
- Validate/clamp untrusted Dungeon Alchemist JSON before writing it into a
  Scene; one bad floor entry must never abort the whole import.
- Every user-facing flow is wrapped in try/catch with a clear
  `ui.notifications` toast; a failed enhancement (an overlay, a canvas draw)
  degrades to "missing," never a crash.
- Localize user-facing strings through `lang/en.json` / `t()`, not literals.
- Comments say why, briefly: the rule the code obeys and why. No plan or audit
  IDs, dates or history in comments; those go in the PR description.

## Working with the maintainer

- Explain changes in plain language, without code; give each trade-off in one
  sentence.
- Give live checks as click-paths in Foundry: the exact menu/button, what to
  click, and what working vs. broken looks like.
- Decide and recommend rather than offering a menu of options you can judge
  yourself; ask only about real product or visual choices.
- Track work in GitHub issues, not markdown files — open an issue for
  anything you find and don't fix, and close it with `Fixes #N`.
- Put what happened in the PR description, not in a dated doc entry. Never
  append "recent work" or session-log sections to a doc; edit a doc only when
  the behavior it describes changes.
