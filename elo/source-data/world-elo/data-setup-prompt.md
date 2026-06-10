# Prompt: set up data utilization for the World Cup predictor

You are integrating a precomputed data prior into a World Cup predictor (Zig/WASM compute engine + HTML/JS/CSS front end). Read `worldcup-predictor-plan.md` first for the architecture and the **JS engine interface**; do not relitigate the locked design decisions.

## Inputs (place under `/assets/`)

- `teams.json` — `{ teams: [{ id, name, group }] }`. The 48-team field and group membership, derived and validated from the official scheduled fixtures (membership cross-checked against the official Group A). **The group LETTERS are alphabetical-by-convenience, not the official A–L** — reconcile them with the official draw before wiring the Round-of-32 combination table, since that table maps specific official letters to bracket slots.
- `theta_data.json` — `{ link: {mu, home_adv, scale}, teams: [{ name, theta, tau }] }`. Bradley–Terry log-strengths (`theta`), per-team precisions (`tau`, used as the user-agency weight in fusion), and the calibrated Poisson supremacy link. Contains 222 teams; the 48 in the field are a subset.

`teams.json` and `theta_data.json` use the **same source names**, so the name join is exact — no aliasing needed. (Display spellings like "Türkiye" / "Czechia" / "Korea Republic" differ from the dataset's "Turkey" / "Czech Republic" / "South Korea"; add a separate `display_name` only if the UI needs official spellings.)

## Tasks

1. **`data.js`**: load both files; build `theta[]` and `tau[]` in `teams.json` index order by joining on `name`. If any tournament team has no fitted strength, **fail loudly (throw)** — a silent fallback would ship a real team as average-strength and is the most likely silent break in production. Add a CI check that fails on any unmatched team.
2. **Feed the prior to the engine:**
   - Real engine (`engine.js`): interleave `[theta0, tau0, theta1, tau1, …]` and call the WASM `load_data_strengths`; pass `link` (`mu`, `home_adv`, `scale`) into `poisson.zig` as the supremacy-link constants.
   - Mock engine (`engine-mock.js`, current prototype): pass `Array.from(theta)` as the `priorTheta` argument to `createMockEngine(teamCount, priorTheta)` so adaptive pairing starts from real strengths today.
3. **Do not re-derive strengths in JS.** `theta_data.json` is the source of truth. Regenerate it by re-running `fit_bt.py` (the offline ratings builder) with a later `ref_date` as group results come in — this is the Phase 6 live-update hook.

## Provenance & caveats to respect

- Source: `martj42/international_results` (CC BY) + `shootouts.csv`, window 2024-01-01 → 2026-06-08, recency half-life 540 days, competition-weighted (WC qualifiers + Nations League at full weight; friendlies as cross-confederation connective tissue).
- Penalty shootouts credited 0.6 to the winner (not a pure draw), so Portugal's Nations League title and the playoff advancements are reflected.
- Strengths (`theta`) are a MAP Bradley–Terry fit shrunk **tightly** toward a World Football Elo prior (Elo over the full match history; prior_sigma=0.2) — effectively World Football Elo with a small recent-form nudge. Best configuration in out-of-sample backtesting (~11% lower log-loss than shrinking toward flat; on par with pure Elo). Win/draw/loss likelihood (note: Elo is already margin-aware via its score multiplier).
- `tau` is the **recent-evidence precision used as the user-agency weight** in fusion — deliberately modest (~2–3), NOT the prior's large statistical precision — so the user's ~40 picks can still meaningfully perturb the prior. Treat `theta` as the **prior the user perturbs**, not a final prediction.
- Already verified: Portugal's NL results match UEFA exactly; inferred group membership matches the official draw; 48 unique teams in 12 groups of 4; the one duplicate fixture removed.

## Deliverable

`data.js` wired to both engines, a CI check that throws on any unmatched team, `poisson.zig` reading the link params, and a confirmation that the prototype runs with real strengths seeded (the first served matchup should be a genuinely close pair, not a random one).
