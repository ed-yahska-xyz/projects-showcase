// Phase 4 proof. Run: `bun test/phase4.engine.js`
// Exercises the REAL engine.js (WASM) through the same JS interface ranking.js
// uses, and proves resume: replaying a pick list reproduces the incremental
// state exactly (so a refresh resumes mid-ranking).
import { createEngine } from "../web/engine.js";

const dir = new URL("../assets/", import.meta.url).pathname;
const HOSTS = new Set(["United States", "Mexico", "Canada"]);

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}

// Build the engine config from the real data (same as data.js does).
const teams = (await Bun.file(dir + "teams.json").json()).teams.slice().sort((a, b) => a.id - b.id);
const fit = await Bun.file(dir + "theta_data.json").json();
const byName = new Map(fit.teams.map((t) => [t.name, t]));
const n = teams.length;
const priorTheta = Float64Array.from(teams.map((t) => byName.get(t.name).theta));
const priorTau = Float64Array.from(teams.map((t) => byName.get(t.name).tau));
const groups = Uint8Array.from(teams.map((t) => t.group.charCodeAt(0) - 65));
const hosts = Uint8Array.from(teams.map((t) => (HOSTS.has(t.name) ? 1 : 0)));
const config = { priorTheta, priorTau, groups, hosts, link: fit.link };

// --- interface basics ---
const eng = createEngine(n, config);
const gap = (i, j) => Math.abs(priorTheta[i] - priorTheta[j]);

let ok = true;
for (let k = 0; k < 100; k++) {
  const [i, j] = eng.nextPair();
  if (i === j || i < 0 || j < 0 || i >= n || j >= n) ok = false;
}
check("nextPair returns distinct in-range indices", ok);

check("progress starts at 0", createEngine(n, config).progress() === 0);

// --- a user can FORCE a favored top team to win: the top tier is round-robined
// (tracking the fused order), so a favorite gets shown enough to become #1. ---
const top10 = [...Array(n).keys()].sort((a, b) => priorTheta[b] - priorTheta[a]).slice(0, 10);
const top10set = new Set(top10);
const fav = top10[3]; // 4th-strongest — a clear contender, not the default #1
const engF = createEngine(n, config);
let favAppear = 0;
for (let k = 0; k < 45; k++) {
  const [i, j] = engF.nextPair();
  if (i === fav || j === fav) {
    engF.addPick(fav, i === fav ? j : i);
    favAppear++;
  } else {
    const w = priorTheta[i] < priorTheta[j] ? i : j; // suppress the stronger rival
    engF.addPick(w, w === i ? j : i);
  }
}
engF.fitAndFuse();
const fs = engF.fusedStrengths();
const fusedTop = [...Array(n).keys()].reduce((a, b) => (fs[b] > fs[a] ? b : a), 0);
check("a favored top team is presented enough to force it (>=5 of 45)", favAppear >= 5, `appeared ${favAppear}`);
check("favoring a top team makes it the fused #1 (would win the bracket)", fusedTop === fav, `#1 is team ${fusedTop}`);
void top10set;

// --- a coherent user (always picks the data-stronger team) drives progress up ---
const eng2 = createEngine(n, config);
const picks = [];
for (let k = 0; k < 40; k++) {
  const [i, j] = eng2.nextPair();
  const [wn, ls] = priorTheta[i] >= priorTheta[j] ? [i, j] : [j, i];
  eng2.addPick(wn, ls);
  picks.push({ w: wn, l: ls });
}
const prog = eng2.progress();
check("progress rises after 40 picks and stays in [0,1]", prog > 0 && prog <= 1, prog.toFixed(3));
check("pickCount reflects adds", eng2.pickCount === 40, `${eng2.pickCount}`);

// --- simulate returns per-team per-round probs; champion column sums to 1 ---
const champCol = (out) => Array.from({ length: n }, (_, i) => out[i * 6 + 5]);
const sim = eng2.simulate(2000, false);
check("simulate returns n*6 per-round array", sim.length === n * 6);
const csum = champCol(sim).reduce((a, b) => a + b, 0);
check("champion probabilities sum to 1", Math.abs(csum - 1) < 0.02, csum.toFixed(3));

// --- RESUME: replay the saved pick list reproduces the incremental state ---
const engReplay = createEngine(n, config); // fresh instance, fresh pair RNG
engReplay.replayPicks(picks);
const progReplay = engReplay.progress();
const seqReplay = [engReplay.nextPair(), engReplay.nextPair(), engReplay.nextPair()];

const engIncr = createEngine(n, config); // fresh again
for (const p of picks) engIncr.addPick(p.w, p.l);
const progIncr = engIncr.progress();
const seqIncr = [engIncr.nextPair(), engIncr.nextPair(), engIncr.nextPair()];

check("resume: replay progress == incremental progress", Math.abs(progReplay - progIncr) < 1e-12, `${progReplay.toFixed(4)} vs ${progIncr.toFixed(4)}`);
check("resume: replay nextPair sequence == incremental", JSON.stringify(seqReplay) === JSON.stringify(seqIncr), JSON.stringify(seqReplay));

// --- the engine.js simulate contract matches what bracket.js consumes ---
const engB = createEngine(n, config);
for (let k = 0; k < 12; k++) engB.addPick(0, 1 + (k % 5)); // boost team 0
engB.fitAndFuse();
const dataOdds = champCol(engB.simulate(2000, false));
const userOdds = champCol(engB.simulate(2000, true));
check("user picks move team 0's championship odds up vs data baseline", userOdds[0] > dataOdds[0], `${(dataOdds[0] * 100).toFixed(1)}% -> ${(userOdds[0] * 100).toFixed(1)}%`);

console.log(failures === 0 ? "\nPHASE 4 PASS — real engine.js is a drop-in; resume reproduces state" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
