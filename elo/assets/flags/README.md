# FootyViz — World Cup 2026 Nation Flags

SVG flags for all 48 qualified nations.

## Contents
- `4x3/` — rectangular flags (standard display), named by ISO 3166-1 alpha-2 code
- `1x1/` — square flags (compact UI: chips, avatars, iOS list rows)
- `manifest.json` — `{ id, name, group, code, flag_4x3, flag_1x1 }` per team

## Naming
Files use ISO 3166-1 alpha-2 codes (e.g. `ar.svg`, `de.svg`). FIFA home nations
use the British subdivision codes: England = `gb-eng`, Scotland = `gb-sct`.
Look up a team's file via `manifest.json` (keyed to your `teams.json` ids/names).

## Usage
Web: `<img src="flags/4x3/${code}.svg" alt="${name}">`
iOS: add the `4x3`/`1x1` folders to the asset bundle; resolve `code` from the manifest.

## Source & license
Flags from **flag-icons** (https://github.com/lipis/flag-icons), MIT licensed.
Flag artwork itself is public domain. Keep this attribution if redistributing.
