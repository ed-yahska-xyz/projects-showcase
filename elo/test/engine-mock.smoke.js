// Runtime smoke test for the mock engine. Run: `bun test/engine-mock.smoke.js`
// Validates the JS engine interface contract that ranking.js depends on.
import { createEngine } from "../web/engine-mock.js";

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

const N = 48;
// Descending prior strengths (team 0 strongest), mean ~0.
const prior = Array.from({ length: N }, (_, i) => (N / 2 - i) * 0.06);

const eng = createEngine(N, { priorTheta: prior });

// nextPair returns two distinct, in-range indices.
let pairOk = true;
for (let k = 0; k < 200; k++) {
  const [i, j] = eng.nextPair();
  if (i === j || i < 0 || j < 0 || i >= N || j >= N) pairOk = false;
}
check("nextPair always returns distinct in-range indices", pairOk);

// Pairs are biased toward near-even matchups (small prior gap) early on.
let nearEven = 0;
for (let k = 0; k < 300; k++) {
  const [i, j] = eng.nextPair();
  if (Math.abs(prior[i] - prior[j]) < 0.25) nearEven += 1;
}
check("pairing favors near-even matchups (>40% within 0.25)", nearEven / 300 > 0.4);

// progress starts at 0 and rises monotonically as informative picks land.
check("progress starts at 0", eng.progress() === 0);
const before = eng.progress();
for (let k = 0; k < 40; k++) {
  const [i, j] = eng.nextPair();
  // pick the stronger-prior team as "winner" to simulate a coherent user.
  if (prior[i] >= prior[j]) eng.addPick(i, j);
  else eng.addPick(j, i);
}
const after = eng.progress();
check("progress increases after 40 picks", after > before);
check("progress stays within [0,1]", after >= 0 && after <= 1);

// simulate returns per-team per-round reach probs (row-major team*6+round).
// The champion column (round 5) is a normalized distribution over teams.
const champ = (out) => Array.from({ length: N }, (_, i) => out[i * 6 + 5]);
const odds = eng.simulate(0, true);
check("simulate returns n*6 per-round array", odds.length === N * 6);
check("simulate(user) champion column sums to 1", Math.abs(champ(odds).reduce((a, b) => a + b, 0) - 1) < 1e-9);
const base = eng.simulate(0, false);
check("simulate(data) champion column sums to 1", Math.abs(champ(base).reduce((a, b) => a + b, 0) - 1) < 1e-9);
// R32 column sums to 32 (qualifiers).
check("R32 column sums to 32", Math.abs(Array.from({ length: N }, (_, i) => base[i * 6]).reduce((a, b) => a + b, 0) - 32) < 1e-9);

// replayPicks reproduces fused state deterministically (same picks -> same sim).
const picks = [];
for (let k = 0; k < 20; k++) picks.push({ w: k % N, l: (k + 7) % N });
const e1 = createEngine(N, { priorTheta: prior });
e1.replayPicks(picks);
const e2 = createEngine(N, { priorTheta: prior });
for (const p of picks) e2.addPick(p.w, p.l);
const s1 = Array.from(e1.simulate(0, true));
const s2 = Array.from(e2.simulate(0, true));
check("replayPicks == addPick loop", s1.every((v, i) => Math.abs(v - s2[i]) < 1e-12));

// Boosting one team raises its championship odds; sinking another lowers theirs.
const e3 = createEngine(N, { priorTheta: prior });
const base3 = champ(e3.simulate(0, true));
for (let k = 0; k < 30; k++) e3.addPick(0, 1); // team 0 beats team 1 repeatedly
const moved3 = champ(e3.simulate(0, true));
check("heavily-picked winner (id 0) gains championship odds", moved3[0] > base3[0]);
check("heavily-beaten team (id 1) loses championship odds", moved3[1] < base3[1]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
