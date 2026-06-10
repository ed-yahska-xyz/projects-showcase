# World Cup Predictor — Implementation Plan

A pairwise-ranking World Cup predictor. The user expresses beliefs by repeatedly picking one team over another (Elo-style); those picks fuse with recency-weighted real results into a single strength per team; a Poisson scoreline model + Monte Carlo simulation turn strengths into bracket probabilities for the 48-team / 12-group 2026 format.

## Current status (handoff)

Built, served, and tested today (the `/web` prototype runs end-to-end on the mock engine — responsive for phone + desktop). ES modules need http; serve the repo root with `bun serve.js` and open `/elo/web/` (or `python3 -m http.server`):

- `index.html`, `styles.css` — the this-or-that screen. Matchday theme, every color/type/space value a CSS variable for reskinning into FootyViz. Mobile-first: cards stack on phones, side-by-side ≥720px; safe-area insets, `100dvh`, touch + keyboard. **Complete.**
- `storage.js` — `localStorage` persistence: versioned key, incremental save, replay-on-load, undo (`popPick`), in-memory fallback. **Complete.**
- `ranking.js` — the full pick loop: adaptive-pair render, pick → persist → advance, information-driven progress meter, floor/target/cap budget (25/40/55), keyboard picks (←/→ or 1/2, `U` undo), finish → `bracket.js`. **Complete.**
- `engine-mock.js` — stand-in implementing the JS engine interface. Running Elo update (stands in for the BT fit), per-team Fisher-information `tau_user`, precision-weighted fusion **seeded with the real per-team `tau_data`**, `p(1-p)` adaptive pairing (never anchors the first pair), and a **simplified softmax simulator** (placeholder for the Poisson + Monte Carlo tournament). **Complete.**
- `data.js` — loads the real `teams.json` + `theta_data.json`, **exact** name join, **throws** on any unmatched team (no silent fallback), decorates teams with display rating/rank/strength, and returns `priorTheta`/`priorTau`/`link`. **Complete.**
- `bracket.js` — v1 finish view: the **your-vs-data** title-odds comparison (sim run on prior vs fused). **Minimal** — full per-round bracket lands with the real engine (Phase 5).
- `assets/teams.json` + `assets/theta_data.json` — the **real** 48-team field + data prior (`theta`, `tau`, calibrated Poisson `link`; 222 teams, the 48 are a subset). Names join exactly. **Current model (`source-data/world-elo/`):** `theta` is a MAP Bradley-Terry fit shrunk tightly toward a World Football Elo prior (≈ World Elo + small recent-form nudge; best out-of-sample log-loss). `tau` (~0.5–3.9) is the modest **user-agency weight** for fusion, NOT the prior's large statistical precision, so ~40 picks can still perturb it. Built by `source-data/world-elo/fit_bt.py`. **NOTE:** group LETTERS are alphabetical-by-convenience — reconcile with the official draw before wiring the R32 table.
- `test/engine-mock.smoke.js` (11 checks), `test/data-join.test.js` (CI: throws on any unmatched team + confirms seeded pairing opens close). All passing.

Not yet built (the implementation to hand off):

- `assets/schedule.json` is now present (official fixtures + R32 slot definitions + knockout feed graph) and **wired into the interactive bracket** (`web/tournament.js` + `web/bracket-view.js` + `web/finish.js`): a concrete editable WC2026 bracket filled from the user's fused Elo (group standings → R32 via the official third-place→slot bipartite matching → knockout). The finish screen now has **Bracket** (editable, default) and **Odds** tabs; on load a stored Elo jumps straight to the bracket with Start-over/Keep-ranking. The Zig Monte Carlo (`tournament.zig`, the Odds tab) **now uses the same official structure** — the R32 slot definitions, per-run third-place→slot bipartite matching, and the W74/L101 feed graph are encoded as constants (mirroring `schedule.json`) with native tests guarding the transcription (R32 source coverage, feed-graph reference counts, matching validity). Both tabs share the official bracket.
- Head-to-head / fair-play group tiebreakers (currently points→GD→GF→draw).
- Offline ratings builder is **provided** as `source-data/world-elo/fit_bt.py` — re-run with a later `ref_date` for the Phase 6 live refresh.

The Zig/WASM engine and `engine.js` wrapper are **done** (Phases 0–4): `exports.zig`/`strength.zig`/`fusion.zig`/`poisson.zig`/`rng.zig`/`tournament.zig`/`pairing.zig` + `web/engine.js`, with `ranking.js` driving the real engine.

Note: a throwaway particle-WASM starter still sits at `/elo` root (`index.html`, `index.js`, `wasm/elo.zig`); it predates this plan. The app is at `/elo/web/`. Safe to delete the root starter or repoint `/elo` → `/elo/web/`.

Zig version: **resolved** — targeting `0.16.0-dev` (the installed toolchain, matching boids/game-of-life). `engine/build.zig` uses the 0.16 `createModule` + `root_module` API; memory exported, `entry = .disabled`, `rdynamic = true`.

## Locked design decisions

These were settled before this plan and should not be relitigated without cause:

- **Scope:** full tournament — group stage through final, not knockout-only.
- **Shared currency:** one Bradley–Terry log-strength `theta[i]` per team. Both real results and user picks update the *same* scalar.
- **Outcome layer:** Poisson scorelines (needed because group advancement breaks ties on goal difference and goals scored — a W/D/L-only model cannot rank groups or third-place teams).
- **v1 strength→goals link:** single-index "supremacy" reduction of Dixon–Coles (one theta per team, defense mirrors attack). Attack/defense split is a documented v2 upgrade, deferred because user pairwise picks only inform overall strength.
- **Fusion:** per-team precision-weighted pooling (Bayesian, *not* a UI slider, *not* a latent mixture). The user's weight on a team is earned from the Fisher information of the comparisons involving it. Concave, unique optimum preserved.
- **Pairing:** adaptive — serve binary "this or that" matchups, picking near-even pairs (maximize `p(1-p)`) seeded from data strengths, with occasional cross-tier anchoring.
- **Pick budget:** soft target **~40** picks; usable floor **~25**; hard cap **~55** (a normal bracket's effort, ~2 min at ~2s/pick). Don't hardcode a count — drive an early-stop off the same Fisher information the pairing maximizes, surfaced as a progress meter; let users finish early once "locked in" or push to the cap. Fewer than a from-scratch ranking because picks *perturb* the data prior rather than build a ranking from nothing.
- **Local persistence:** store the **raw pick list** (not derived strengths) in `localStorage`, schema-versioned key, written incrementally so a refresh resumes mid-ranking.
- **Differentiator:** show "your prediction vs the data baseline" side by side.

## Architecture

Client-side app. "Backend" = the Zig/WASM compute engine running in the browser; "frontend" = JS/HTML/CSS for UI and orchestration. No server required for v1; real-match strengths are precomputed offline and shipped as static assets.

```
Real results ──▶ [offline ratings builder] ──▶ theta_data.json (strengths + precisions)
                                                      │
                                                      ▼
                        ┌─────────────────────────────────────────┐
  User picks ──(JS)──▶  │  WASM engine (Zig)                       │
                        │   fit user theta → fuse → simulate 10k   │ ──▶ bracket probs ──(JS)──▶ UI
                        └─────────────────────────────────────────┘
```

Three build targets from one Zig codebase:
1. `wasm32-freestanding` — the browser engine (primary).
2. native CLI — the offline ratings builder (reuses `strength.zig`).
3. (optional) `wasm32-wasi` — same engine server-side later, if live simulation moves to a server.

## Repository layout

```
/engine            Zig source
  exports.zig      WASM ABI: exported fns + allocator (entry point)
  strength.zig     BT log-strengths; MM fit from comparisons
  fusion.zig       per-team precision-weighted pooling
  poisson.zig      strength-diff → (lambda_home, lambda_away); scoreline sampling
  pairing.zig      adaptive next-pair selection
  tournament.zig   group sim + tiebreakers + third-place ranking + R32 table + knockout
  mc.zig           Monte Carlo driver; tallies per-team per-round counts
  rng.zig          seedable PRNG (xoshiro/PCG) + Poisson sampler
  ratings_main.zig native CLI entry for the offline builder
  build.zig
/web               Frontend
  index.html       [built] app shell: meter, two-card stage, finish panel
  styles.css       [built] matchday theme; all tokens are CSS variables
  storage.js       [built] localStorage persistence of the raw pick list
  ranking.js       [built] binary this-or-that loop + meter + budget + resume
  engine-mock.js   [built] stand-in for engine.js (same JS interface)
  engine.js        [todo]  WASM loader + ABI wrapper (marshalling lives here)
  data.js          [todo]  fetch + load static assets into WASM
  bracket.js       [todo]  results: probabilities + your-vs-data comparison
/assets            Static data (build-time)
  teams.json       48 teams, ids, group assignment
  schedule.json    group fixtures + R32 combination table
  theta_data.json  precomputed data strengths + precisions + theta→lambda link params
/test              Zig unit tests + JS integration smoke tests
```

## The WASM ↔ JS contract (design this first)

WASM passes only numbers across the boundary; arrays/structs go through linear memory. This boundary is the single biggest footgun, so it is Phase 0 and gets pinned down before any modeling code.

**Memory model:** the engine exports an allocator so JS can hand it variable-length input.

| Exported Zig fn | Signature | Purpose |
|---|---|---|
| `alloc` | `(len: usize) -> [*]u8` | JS requests a buffer in WASM memory |
| `free` | `(ptr: [*]u8, len: usize) -> void` | release it |
| `init` | `(seed: u64) -> void` | seed RNG, reset state |
| `set_teams` | `(count: u32) -> void` | declare team count, allocate state |
| `load_data_strengths` | `(ptr: [*]f64, n: u32) -> void` | write theta_data + tau_data (interleaved) |
| `load_groups` | `(ptr: [*]u8, n: u32) -> void` | group assignment per team |
| `reset_picks` | `() -> void` | clear user comparisons |
| `add_pick` | `(winner: u32, loser: u32) -> void` | record one user comparison |
| `fit_and_fuse` | `() -> void` | BT-fit user picks, then precision-pool into fused theta |
| `next_pair` | `() -> u64` | adaptive pairing; returns two u32 indices packed |
| `progress` | `() -> f64` | 0..1 fraction of attainable user signal captured (drives meter + early-stop) |
| `simulate` | `(runs: u32, out_ptr: [*]f64) -> void` | run MC, write per-team per-round probs |

**Marshalling pattern (JS side, in `engine.js`):**

```js
// write an f64 array into WASM memory, return a pointer
function writeF64(wasm, arr) {
  const ptr = wasm.alloc(arr.length * 8);
  new Float64Array(wasm.memory.buffer, ptr, arr.length).set(arr);
  return ptr;
}
// read results back (out buffer of teams × rounds)
function readProbs(wasm, ptr, teams, rounds) {
  return new Float64Array(wasm.memory.buffer, ptr, teams * rounds);
}
```

Note: any Zig allocation can grow `memory.buffer` and invalidate existing typed-array views — re-create the view after calls that allocate. Document this rule in `engine.js`.

**JS engine interface (the swap seam).** `ranking.js` talks to an engine object, never to WASM directly. `engine-mock.js` implements this shape today; `engine.js` must implement the same shape so it drops in with no change to `ranking.js`. This is the contract for the handoff:

| JS method | Returns | Backed by ABI |
|---|---|---|
| `createEngine(teamCount, priorTheta?)` | engine object | `set_teams`, `load_data_strengths` |
| `addPick(winner, loser)` | void | `add_pick` |
| `replayPicks(picks)` | void | loop of `add_pick`; picks are `{ w, l }` |
| `nextPair()` | `[i, j]` team indices | `next_pair` (unpack the packed u64) |
| `progress()` | float 0..1 | `progress` |
| `fitAndFuse()` | void | `fit_and_fuse` (used by `bracket.js`) |
| `simulate(runs)` | per-team per-round probabilities | `simulate` (read the out buffer) |

`engine.js` owns all marshalling and the view-invalidation rule; `ranking.js` stays pure UI and orchestration.

## Zig core modules

### strength.zig
Bradley–Terry log-strengths fit from a set of pairwise comparisons via the MM / Zermelo update (closed-form, monotone, globally convergent because the likelihood is concave — no init sensitivity):

```
beta_i ← W_i / Σ_{j≠i} n_ij / (beta_i + beta_j)
```
where `W_i` = wins of i, `n_ij` = times i and j met. Iterate to convergence, then `theta_i = ln(beta_i)`, recenter so `Σ theta = 0`. Used to fit the **user** strengths from picks. Same code, compiled native, fits the **data** strengths offline.

### fusion.zig
Per-team precision-weighted pool of data prior and user evidence:
```
theta_fused[i] = (tau_data[i]*theta_data[i] + tau_user[i]*theta_user[i]) / (tau_data[i] + tau_user[i])
```
`tau_user[i]` is the Fisher information the user accrued on team i — the sum of `p_c*(1-p_c)` over comparisons c involving i (the same information curve the pairing maximizes). Teams the user never compared get `tau_user = 0` and stay pinned to the data prior. Let thin/stale data lower `tau_data[i]` so the user's gut earns weight faster exactly where the data is weak.

### poisson.zig
v1 single-index supremacy link from fused strengths to expected goals:
```
log lambda_home = mu + home_adv + (theta_home - theta_away)
log lambda_away = mu             - (theta_home - theta_away)
```
`mu`, `home_adv`, and the strength scale are calibrated offline (regress historical goals on strength differences) and shipped in `theta_data.json`. Hosts (USA/Mexico/Canada) get the home term. Sample each team's goals Poisson(lambda); optionally apply the Dixon–Coles low-score correction (note: that correction makes the *fitting* objective mildly non-concave — only matters for the offline calibration, not the per-match sampling).

### pairing.zig
Given current fused strengths, pick the next pair to show: with probability `1-eps`, the pair whose expected `p(1-p)` is largest among not-recently-shown pairs (most informative, near 50/50); with probability `eps`, a random cross-tier pair to keep the user's ranking globally anchored. Early on, when everything sits near the data prior, this naturally behaves like informed sampling rather than uniform. Also expose `progress()`: the accumulated `tau_user` summed across teams as a fraction of an attainable target, so JS can render the meter and trigger early-stop when the next pair's expected information falls below threshold.

### tournament.zig
The simulator for one tournament instance:
1. **Groups:** for each of 12 groups, simulate the 3 round-robin fixtures via `poisson.zig`; accumulate points, GF, GA.
2. **Rank within group** by the official cascade: points → goal difference → goals scored → head-to-head (points, GD, GF among tied) → fair-play → drawing of lots (RNG).
3. **Third-place table:** rank all 12 third-placed teams by points → GD → goals scored → conduct → FIFA-ranking fallback; take the best 8.
4. **R32 seeding:** the matchups depend on *which* groups the 8 third-place teams come from — implement FIFA's predetermined combination lookup table (source the official table into `schedule.json`). This is the fiddliest piece; treat it as real logic with its own tests.
5. **Knockout:** R32 → R16 → QF → SF → final. Each tie sampled from the model; resolve draws (extra time / penalties) by a win-probability coin flip (optionally a slight shootout adjustment).
6. Record the deepest round each team reached.

Keep all scratch buffers preallocated and reused across runs — no per-match or per-run allocation in the hot loop.

### mc.zig
Run `simulate` over N (~10k) instances, tally per-team counts of reaching each round and winning, divide by N → probabilities, write to the JS-visible out buffer. Reproducible given a fixed seed.

## Frontend modules

- **engine.js** — instantiate WASM, wrap the ABI in ergonomic async functions, own all marshalling and the view-invalidation rule.
- **data.js** — fetch `teams.json` / `schedule.json` / `theta_data.json`, load into the engine via the ABI.
- **storage.js** — `localStorage` persistence of the raw pick list. Save after every pick; load and replay into the engine on startup so a refresh resumes mid-ranking. Owns the key, schema version, and (later) export/import.
- **ranking.js** — the pick loop: `next_pair()` → render two team cards (binary this-or-that) → on click `add_pick(winner, loser)` + persist via `storage.js` → repeat. Render a progress meter from `progress()`; enable a "see my bracket" finish once past the ~25 floor, nudge toward ~40, hard-stop at ~55. Reuse the Elo-pick interaction already prototyped.
- **bracket.js** — on demand (or after enough picks): `fit_and_fuse()` → `simulate()` → render each team's probability to reach each round and to win, plus the **your-vs-data** comparison (run the sim once with `tau_user = 0` for the baseline, once fused, and diff them).
- State stays in JS (the pick list, persisted to `localStorage`); the engine is stateless between sessions except for what JS loads.

## Local persistence

Picks live in `localStorage` — the data is a few KB even at the cap, far under the ~5 MB limit, so no IndexedDB.

- **Store inputs, not outputs.** Persist only the raw pick list (`[{w, l, t}, …]`), never the fused strengths. The strengths are re-derived on load, so a model change or refreshed data prior never strands a saved session.
- **Versioned key,** e.g. `wcpredictor:v1:picks:2026`, so schema migrations are clean.
- **Incremental save + resume.** Write after each `add_pick`; on startup, load the list and replay it through the engine, then continue the pairing loop where it left off (drives the resume + the progress meter together).
- **Caveat / later:** `localStorage` is per-origin and lost on site-data clear or device switch. Fine for v1; if shareable or cross-device brackets matter later, add export/import (serialize the pick list to a short code or URL fragment) rather than standing up a server.

## Offline ratings builder

A native Zig CLI (`ratings_main.zig`) that ingests recent international results, applies recency decay and competition weights (a qualifier outweighs a friendly), fits data strengths via the shared `strength.zig`, calibrates the `theta→lambda` link, and emits `theta_data.json` (theta_data, tau_data, mu, home_adv, scale). For v1 this can run once pre-tournament; wiring it to the existing FootyViz data pipeline for live group-stage refresh is a later step.

## Phased milestones

Each phase has a concrete "done when."

**Phase 0 — Boundary & toolchain. ✅ Done.** `engine/exports.zig` (`alloc`/`free`/`add`/`sum_f64`/`scale_f64`) + `engine/build.zig` build to `web/engine.wasm` (`cd engine && zig build && cp zig-out/bin/engine.wasm ../web/`). `test/phase0.boundary.js` (`bun test/phase0.boundary.js`) round-trips an f64 array (JS writes → Zig sums → JS reads), reads back in-place mutation, and exercises the view-invalidation rule by forcing memory growth (19→531 pages), asserting the stale view detaches and a re-created view recovers the data. Memory is **exported** by the module (allocator owns growth); `engine.js` reads `instance.exports.memory` and must re-create any typed-array view after a call that allocates.

**Phase 1 — Data & ratings builder. ◑ Mostly done.** `teams.json` + `theta_data.json` (real BT prior, built by `source-data/world-elo/fit_bt.py`) are wired via `data.js` and load into the (mock) engine; `test/data-join.test.js` guards the join. *Remaining:* `schedule.json` (fixtures + official FIFA R32 combination table) and reconciling the alphabetical-by-convenience group letters with the official A–L draw.

**Phase 2 — Strength + fusion. ✅ Done.** `strength.zig` (MM/Zermelo BT fit, geometric-mean recentering) + `fusion.zig` (precision-weighted pool), exported via `set_teams`/`load_data_strengths`/`reset_picks`/`add_pick`/`fit_and_fuse` + `get_*_ptr` readback. Native Zig unit tests (`zig test strength.zig`/`fusion.zig`: 2-team → ln(7/3), 3-team → known MLE, unplayed pinned) and `test/phase2.fusion.js` (12 checks: fused via the full ABI). Design note: `tau_user` weights each comparison by `p(1-p)` at the **data prior** (the pairing's information curve), not the post-hoc fit — avoids the all-wins degeneracy where the fitted p→0/1 zeroes the evidence.

**Phase 3 — Outcome model + simulator. ✅ Done (sanity gate passed).** `rng.zig` (xoshiro256** + Knuth Poisson), `poisson.zig` (the exact `fit_bt.py` supremacy link, incl. `scale`), `tournament.zig` (group round-robin → tiebreakers → third-place ranking → R32 → knockout, MC driver). ABI: `set_link`, `load_hosts`, `simulate(runs, use_user, out_ptr)` (use_user=0 → data prior, =1 → fused; same seed both → honest diff). `test/phase3.simulate.js`: 10k runs in ~0.2s; round masses sum exactly to 32/16/8/4/2/1, reach is monotone, deterministic, favorites are established powers (Spain/Argentina/Germany + host Mexico). **Bracket:** the knockout uses the official `schedule.json` structure (R32 slot definitions + third-place→slot matching + feed graph), encoded in `tournament.zig` with transcription tests. Group tiebreak is still points→GD→GF→draw (head-to-head/fair-play deferred). With the World-Elo-anchored prior, champion ordering is market-like (Spain 26%, Argentina 22%, France 10%, England 5%, Brazil 5%).

**Phase 4 — Ranking UX. ✅ Done.** `pairing.zig` (adaptive near-even selection + recent-pair ring + cross-tier anchor) and the `next_pair`/`progress` ABI. **Top-N round-robin:** the strongest 10 teams (by data prior) are round-robined head-to-head first — every top-10 matchup is served before the field, tracked via the pick matrix `nij` — so a user can concentrate picks on the contenders and *force any top-10 team to win* (each appears ~8–12× over ~45 picks vs ~2× before; verified end-to-end). The ~18% eps pairs still surface field teams. `engine.js` (the WASM wrapper — owns marshalling + the view-recreate rule, instantiates once via top-level await, works in browser + bun). `ranking.js` now imports `engine.js` — the import line is the only change from the mock; the shared `createEngine(teamCount, opts)` signature is honored by both. `test/phase4.engine.js`: the real engine drives the interface, and **resume reproduces state** (replay == incremental for both progress and the RNG-seeded pair sequence). 40 coherent picks → progress 0.948 (meter hits "locked in" at the target). `engine-mock.js` retained for fast headless tests + as a fallback.

**Phase 5 — Results & comparison UI. ✅ Done.** `simulate` now returns per-team per-round reach probs (row-major team*6+round) from both engines (the mock via an exact groupless bracket DP). `bracket.js` runs the sim twice (data prior vs fused) and renders the your-vs-data view: a "where your picks moved the needle" movers callout, championship-odds bars, and tap-to-expand round-by-round paths (`buildComparison` is pure + unit-tested in `test/phase5.bracket.js`). **Sparse-fit fix shipped here:** the user BT fit was unregularized, so a few consistent picks swung odds wildly (Spain 28%→3%). Added `fit_bt.py`-style regularization (`strength.fit(reg)`, `USER_REG=1.0`) — the response is now proportional to the evidence (mild picks barely move; 24 emphatic picks move a lot).

**Phase 6 — Live + calibration (post-v1).** Ingest group results as they land (re-weight, re-simulate); track Brier score / log-loss for calibration; performance-tune the hot loop if needed.

## Risks & notes

- **Boundary first.** Most WASM project pain is marshalling and memory-view invalidation — Phase 0 exists to kill it early.
- **Concavity is on your side.** BT and the data-only Poisson fit are concave, so the offline fits and the user fit converge to unique optima regardless of initialization. The only non-concave corner is the optional Dixon–Coles correction in offline calibration.
- **Performance.** 10k tournaments is small for WASM if the hot loop is allocation-free. Preallocate group tables, knockout brackets, and scratch arrays once; Zig's explicit allocators make this natural. The likely hot spots are Poisson sampling and the tiebreaker sort.
- **Determinism.** Seedable RNG so identical picks yield identical predictions — essential for debugging and for the your-vs-data diff to be honest (same seed for both runs).
- **Deferred fork.** v1 uses a single scalar theta per team. The attack/defense split (decoupled Dixon–Coles) is a real upgrade but complicates fusion, because user pairwise picks only inform a 1-D projection of a 2-D strength. Revisit only if calibration shows the single-index link mispredicting goal totals.
- **R32 table.** Source FIFA's official third-place combination table verbatim into `schedule.json`; it is the most error-prone logic and deserves dedicated tests.