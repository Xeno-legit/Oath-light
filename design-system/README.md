# Oath Light — Design System

The single design system shared by all four surfaces (extension popup/blocked/
options, desktop renderer, website, store assets). This is the prerequisite
layer for the full UI rebuild ([../ROADMAP.md](../ROADMAP.md) §5.1) and Serious
Mode's whole-personality flip ([../docs/VISION.md](../docs/VISION.md) §3.3):
visuals flow from `tokens.css`, copy flows from `strings.js`, and nothing ships
hardcoded per-surface again.

## Files

| File | What it is |
|---|---|
| `tokens.css` | Source of truth for every `--ol-*` token: color, type, spacing, radii, shadow, motion. Dark theme in `:root`, light in `[data-theme="light"]`, Serious Mode visual hook in `[data-serious]`. Consumption instructions are in its header comment. |
| `fonts/` | The Manrope + Instrument Serif `.woff2` files `tokens.css` references — must travel with any copy of it. |
| `tokens.js` | Metadata manifest (`OL_TOKENS`) the editor builds its controls from. Keep in sync with `tokens.css` when adding/removing a token. |
| `strings.js` | The voice layer (`OL_STRINGS`): every user-facing string in both voices (Companion / Drill Sergeant), `t(key, params)` lookup, Serious Mode force-override. Loads everywhere incl. the MV3 service worker. |
| `VOICE.md` | Copy rules: the two registers, banned language, the "status yes, map no" content rules, key conventions. |
| `preview.html` | The live editor/style guide. **This is where the visual direction gets decided.** |

## Theme model (owner decision 2026-07-19)

**Noir is the only built-in theme and the default.** There are no preset
palette variants. Instead, user-custom themes are a product feature: the app's
Themes menu (rebuilt in the UI-rebuild phase) lets the user edit any color
token themselves, applied as runtime overrides on top of the Noir defaults —
the exact inline-custom-property mechanism `preview.html` already uses. Dark
and light are both part of Noir, not separate themes.

## The editor workflow

1. Open `preview.html` directly in a browser (double-click — no server needed).
2. Tune tokens in the sidebar (grouped, live-applied), switch Dark/Light — edits
   are stored per theme side — preview Serious Mode and both voices.
   Edits persist in the browser between sessions until "Reset all" (which
   restores the Noir defaults).
3. When a direction feels right: **Copy tokens.css** or **Download tokens.css**
   and save it over `design-system/tokens.css`. That file is now the system.

The sample components in the preview (`.ol-*` classes in `preview.html`) are
the component reference for the UI rebuild — token-driven only, no hardcoded
values.
