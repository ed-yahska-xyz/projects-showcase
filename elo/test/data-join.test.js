// CI check for the data prior. Run: `bun test/data-join.test.js`
// Fails (exit 1) if any tournament team has no fitted strength — a silent
// fallback would ship a real team at average strength. Also confirms the
// prototype seeds from real strengths and opens on a genuinely close matchup.
import { createEngine } from "../web/engine-mock.js";

const dir = new URL("../assets/", import.meta.url).pathname;
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}

const teams = (await Bun.file(dir + "teams.json").json()).teams.slice().sort((a, b) => a.id - b.id);
const fitDoc = await Bun.file(dir + "theta_data.json").json();
const byName = new Map(fitDoc.teams.map((t) => [t.name, t]));

// --- the join must be total (exact names, no fallback) ---
const missing = teams.filter((t) => !byName.has(t.name)).map((t) => t.name);
check("48 teams in the field", teams.length === 48, `${teams.length}`);
check("ids are contiguous 0..47", teams.every((t, i) => t.id === i));
check("every tournament team has a fitted strength", missing.length === 0, missing.join(", "));

const counts = {};
for (const t of teams) counts[t.group] = (counts[t.group] || 0) + 1;
check("12 groups of 4", Object.keys(counts).length === 12 && Object.values(counts).every((c) => c === 4), JSON.stringify(counts));

// --- the calibrated Poisson link is present (poisson.zig will consume it) ---
const link = fitDoc.link;
check("link has mu / home_adv / scale", link && ["mu", "home_adv", "scale"].every((k) => typeof link[k] === "number"), JSON.stringify(link));

// --- every team has a flag (manifest covers the field, exact name join) ---
const flags = (await Bun.file(dir + "flags/manifest.json").json()).flags;
const flagByName = new Map(flags.map((f) => [f.name, f]));
const noFlag = teams.filter((t) => !flagByName.has(t.name)).map((t) => t.name);
check("every team has a flag in the manifest", noFlag.length === 0, noFlag.join(", "));
const badCode = flags.filter((f) => !f.code || !f.flag_4x3 || !f.flag_1x1).map((f) => f.name);
check("every flag entry has code + 4x3 + 1x1 paths", badCode.length === 0, badCode.join(", "));

// --- seeded pairing opens on a close pair, and favors near-even overall ---
const theta = teams.map((t) => byName.get(t.name).theta);
const eng = createEngine(teams.length, { priorTheta: theta });
const gap = (i, j) => Math.abs(theta[i] - theta[j]);

const [i0, j0] = eng.nextPair();
check("first served pair is close (|Δθ| < 0.5)", gap(i0, j0) < 0.5, `Δθ=${gap(i0, j0).toFixed(3)} (${teams[i0].name} vs ${teams[j0].name})`);

let sum = 0;
const ROUNDS = 200;
for (let k = 0; k < ROUNDS; k++) {
  const [i, j] = eng.nextPair();
  sum += gap(i, j);
}
const avgServed = sum / ROUNDS;
// Average gap of uniformly random pairs, for comparison.
let rsum = 0;
for (let k = 0; k < 2000; k++) {
  const i = (Math.random() * teams.length) | 0;
  let j = (Math.random() * teams.length) | 0;
  if (j === i) j = (j + 1) % teams.length;
  rsum += gap(i, j);
}
const avgRandom = rsum / 2000;
check("adaptive pairing is much closer than random", avgServed < 0.5 * avgRandom, `served ${avgServed.toFixed(2)} vs random ${avgRandom.toFixed(2)}`);

console.log(failures === 0 ? "\nDATA JOIN PASS — real prior wired, 48/48 matched, pairing seeded" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
