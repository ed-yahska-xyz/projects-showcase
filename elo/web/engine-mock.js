// engine-mock.js — a pure-JS stand-in for the Zig/WASM engine, implementing the
// JS engine interface from PLAN.md so the ranking loop runs before the WASM
// engine exists. engine.js (the real WASM wrapper) must implement this same
// shape so swapping the import in ranking.js requires no other change.
//
// Interface:
//   createEngine(teamCount, priorTheta?) -> engine
//   engine.addPick(winner, loser)
//   engine.replayPicks(picks)            // picks: [{ w, l }, ...]
//   engine.nextPair()                    // -> [i, j]
//   engine.progress()                    // -> 0..1
//   engine.fitAndFuse()
//   engine.simulate(runs, useUser=true)  // -> Float64Array of champion probs
//
// The mock approximates the real model: a running Elo update stands in for the
// BT fit, per-team Fisher information (sum of p(1-p)) stands in for tau_user,
// and precision-weighted pooling fuses user evidence with the data prior. The
// pairing maximizes that same p(1-p) information. The simulator is a simplified
// softmax over fused strengths — the real engine replaces it with the Poisson
// scoreline + Monte Carlo tournament.

const K = 0.30; // learning rate for the running (Elo-style) user update
const TAU_DATA = 2.0; // prior precision per team (how confident the data is)
const EPS = 0.18; // chance of a cross-tier "anchor" pair instead of near-even
const RECENT = 12; // how many recent pairs to avoid repeating
const TARGET_INFO = 18; // total user information ~ "fully expressed" ranking

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// Same signature as engine.js: createEngine(teamCount, { priorTheta, priorTau,
// groups, hosts, link }). The mock ignores groups/hosts/link (its simulator is
// a softmax over strengths); the real engine uses them.
export function createEngine(teamCount, opts = {}) {
  const { priorTheta, priorTau } = opts;
  const prior = priorTheta
    ? Float64Array.from(priorTheta)
    : new Float64Array(teamCount);
  // Per-team data precision when provided (thin/stale data => lower tau => the
  // user's gut earns weight faster there); falls back to a constant.
  const tauData = priorTau ? Float64Array.from(priorTau) : null;

  // thetaUser starts at the prior and drifts as the user picks.
  const thetaUser = Float64Array.from(prior);
  const tauUser = new Float64Array(teamCount); // accrued Fisher information
  const fused = Float64Array.from(prior);
  const recent = []; // recent pair keys, to avoid repeats
  let pickCount = 0;

  // The strongest TOP_N teams (by CURRENT fused order) are round-robined
  // head-to-head, so a user can rank/force any genuine contender — and a team
  // they keep picking climbs into the tier. pickedPairs tracks done matchups.
  const TOP_N = 10;
  const priority = new Array(teamCount).fill(false);
  const pickedPairs = new Set();
  function computeTopN() {
    priority.fill(false);
    [...Array(teamCount).keys()]
      .sort((a, b) => fused[b] - fused[a])
      .slice(0, Math.min(TOP_N, teamCount))
      .forEach((i) => (priority[i] = true));
  }

  const pairKey = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);

  function refuse() {
    // Recompute fused strengths from prior + user evidence (precision-weighted).
    for (let i = 0; i < teamCount; i++) {
      const td = tauData ? tauData[i] : TAU_DATA;
      const tu = tauUser[i];
      fused[i] = (td * prior[i] + tu * thetaUser[i]) / (td + tu);
    }
  }

  function addPick(winner, loser) {
    pickedPairs.add(pairKey(winner, loser));
    const p = sigmoid(thetaUser[winner] - thetaUser[loser]);
    const delta = K * (1 - p); // surprise-scaled, like an Elo update
    thetaUser[winner] += delta;
    thetaUser[loser] -= delta;
    const info = p * (1 - p); // Fisher information this comparison carried
    tauUser[winner] += info;
    tauUser[loser] += info;
    pickCount++;
    refuse();
  }

  function replayPicks(picks) {
    for (const { w, l } of picks) addPick(w, l);
  }

  function nextPair() {
    computeTopN(); // the round-robin tier tracks the current fused order
    // Never anchor the very first matchup. Round-robin the top-N first: an
    // as-yet-unplayed priority-vs-priority pair gets a large bonus.
    const anchor = pickCount > 0 && Math.random() < EPS;
    let bestKey = null;
    let best = -Infinity;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < teamCount; i++) {
      for (let j = i + 1; j < teamCount; j++) {
        const key = pairKey(i, j);
        if (recent.includes(key)) continue;
        const p = sigmoid(fused[i] - fused[j]);
        const info = p * (1 - p);
        const jit = 0.85 + 0.3 * Math.random();
        let score = anchor ? jit : info * jit; // anchor -> uniform-random pair
        if (!anchor && priority[i] && priority[j] && !pickedPairs.has(key)) score += 100;
        if (score > best) {
          best = score;
          bestKey = key;
          bi = i;
          bj = j;
        }
      }
    }
    if (bestKey) {
      recent.push(bestKey);
      while (recent.length > RECENT) recent.shift();
    }
    // Randomize which side each team appears on.
    return Math.random() < 0.5 ? [bi, bj] : [bj, bi];
  }

  function progress() {
    let total = 0;
    for (let i = 0; i < teamCount; i++) total += tauUser[i];
    return Math.min(1, total / TARGET_INFO);
  }

  function fitAndFuse() {
    refuse();
  }

  function simulate(runs = 0, useUser = true) {
    // Simplified stand-in for the real Monte Carlo tournament: top-32 by
    // strength qualify (groupless), seeded strongest-vs-weakest, and an exact
    // single-elimination bracket DP gives per-team per-round reach probs. Same
    // row-major team*6+round shape as engine.js. The real engine adds the group
    // stage, Poisson scorelines, and the actual bracket.
    const NR = 6;
    const theta = useUser ? fused : prior;
    const out = new Float64Array(teamCount * NR);

    const order = Array.from({ length: teamCount }, (_, i) => i).sort((a, b) => theta[b] - theta[a]);
    const Q = Math.min(32, teamCount);
    const bracket = [];
    for (let i = 0; i < Q / 2; i++) {
      bracket.push(order[i]);
      bracket.push(order[Q - 1 - i]);
    }
    for (let p = 0; p < Q; p++) out[bracket[p] * NR + 0] = 1; // reach R32

    const pbeat = (i, j) => 1 / (1 + Math.exp(-(theta[i] - theta[j])));
    let reach = new Float64Array(Q).fill(1);
    const knockoutRounds = Math.log2(Q); // 5 for 32
    for (let k = 0; k < knockoutRounds; k++) {
      const half = 1 << k;
      const block = 1 << (k + 1);
      const next = new Float64Array(Q);
      for (let p = 0; p < Q; p++) {
        const start = Math.floor(p / block) * block;
        const inFirst = p - start < half;
        const lo = inFirst ? start + half : start;
        const hi = inFirst ? start + block : start + half;
        let s = 0;
        for (let q = lo; q < hi; q++) s += reach[q] * pbeat(bracket[p], bracket[q]);
        next[p] = reach[p] * s;
      }
      reach = next;
      for (let p = 0; p < Q; p++) out[bracket[p] * NR + (k + 1)] = reach[p];
    }
    return out;
  }

  return {
    addPick,
    replayPicks,
    nextPair,
    progress,
    fitAndFuse,
    simulate,
    fusedStrengths() {
      return Float64Array.from(fused);
    },
    get pickCount() {
      return pickCount;
    },
  };
}
