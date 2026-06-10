// engine.js — WASM loader + ABI wrapper. A drop-in for engine-mock.js: it
// exports the same createEngine(teamCount, opts) so ranking.js swaps the import
// line and nothing else changes.
//
// This module owns ALL marshalling and the view-invalidation rule: any wasm
// allocation can grow memory.buffer and detach existing typed-array views, so
// we always create views from the current memory.buffer right before use.
//
// The wasm is instantiated once at module load (top-level await); the engine is
// stateless between sessions — JS reloads the prior and replays picks on start.

const NROUNDS = 6; // R32, R16, QF, SF, Final, Champion
const DEFAULT_RUNS = 10000;
const DEFAULT_TAU = 1.0;

const wasmUrl = new URL("./engine.wasm", import.meta.url);
const bytes =
  typeof Bun !== "undefined"
    ? await Bun.file(wasmUrl.pathname).arrayBuffer()
    : await (await fetch(wasmUrl)).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const w = instance.exports;

function writeInterleaved(theta, tau, n) {
  const ptr = w.alloc(n * 2 * 8);
  const view = new Float64Array(w.memory.buffer, ptr, n * 2);
  for (let i = 0; i < n; i++) {
    view[2 * i] = theta[i];
    view[2 * i + 1] = tau ? tau[i] : DEFAULT_TAU;
  }
  w.load_data_strengths(ptr, n);
  w.free(ptr, n * 2 * 8);
}

function writeU8(loadFn, arr, n) {
  const ptr = w.alloc(n);
  new Uint8Array(w.memory.buffer, ptr, n).set(arr.subarray ? arr.subarray(0, n) : Array.from(arr).slice(0, n));
  loadFn(ptr, n);
  w.free(ptr, n);
}

export function createEngine(teamCount, opts = {}) {
  const { priorTheta, priorTau, groups, hosts, link } = opts;

  w.set_teams(teamCount);
  if (priorTheta) writeInterleaved(priorTheta, priorTau, teamCount);
  if (groups) writeU8(w.load_groups, groups, teamCount);
  if (hosts) writeU8(w.load_hosts, hosts, teamCount);
  if (link) w.set_link(link.mu, link.home_adv, link.scale);
  w.fit_and_fuse(); // initialize fused = prior so the first nextPair is seeded

  return {
    addPick(winner, loser) {
      w.add_pick(winner, loser);
      w.fit_and_fuse(); // keep fused + tau current for the next pairing and meter
    },
    replayPicks(picks) {
      for (const p of picks) w.add_pick(p.w, p.l);
      w.fit_and_fuse();
    },
    nextPair() {
      const packed = BigInt(w.next_pair()); // u64 -> BigInt
      return [Number(packed >> 32n), Number(packed & 0xffffffffn)];
    },
    progress() {
      return w.progress();
    },
    fitAndFuse() {
      w.fit_and_fuse();
    },
    // Per-team per-round reach probabilities, row-major: team*6 + round
    // (rounds: R32, R16, QF, SF, Final, Champion). use_user picks prior vs fused.
    simulate(runs, useUser = true) {
      const r = runs && runs > 0 ? runs : DEFAULT_RUNS;
      const ptr = w.alloc(teamCount * NROUNDS * 8);
      w.simulate(r, useUser ? 1 : 0, ptr);
      const out = new Float64Array(w.memory.buffer, ptr, teamCount * NROUNDS).slice();
      w.free(ptr, teamCount * NROUNDS * 8);
      return out;
    },
    // Current fused log-strengths (prior + user evidence), one per team.
    fusedStrengths() {
      const ptr = w.get_fused_ptr();
      return new Float64Array(w.memory.buffer, ptr, teamCount).slice();
    },
    get pickCount() {
      return w.get_pick_count();
    },
  };
}
