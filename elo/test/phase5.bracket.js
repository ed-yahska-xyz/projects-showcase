// Phase 5 proof. Run: `bun test/phase5.bracket.js`
// Verifies the real per-round simulate contract feeding the results UI, and the
// pure buildComparison() that powers the your-vs-data view (sorted rows, movers,
// per-round paths).
import { createEngine } from "../web/engine.js";
import { buildComparison } from "../web/bracket.js";

const dir = new URL("../assets/", import.meta.url).pathname;
const HOSTS = new Set(["United States", "Mexico", "Canada"]);
const NR = 6;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}

const teams = (await Bun.file(dir + "teams.json").json()).teams.slice().sort((a, b) => a.id - b.id);
const fit = await Bun.file(dir + "theta_data.json").json();
const byName = new Map(fit.teams.map((t) => [t.name, t]));
const n = teams.length;
for (const t of teams) {
  const hit = byName.get(t.name);
  t.theta = hit.theta;
  t.rank = 0; // not needed here
}
const config = {
  priorTheta: Float64Array.from(teams.map((t) => byName.get(t.name).theta)),
  priorTau: Float64Array.from(teams.map((t) => byName.get(t.name).tau)),
  groups: Uint8Array.from(teams.map((t) => t.group.charCodeAt(0) - 65)),
  hosts: Uint8Array.from(teams.map((t) => (HOSTS.has(t.name) ? 1 : 0))),
  link: fit.link,
};

const eng = createEngine(n, config);

// --- per-round contract: shape + round masses + monotonicity ---
const dataRounds = eng.simulate(0, false);
check("simulate returns n*6 array", dataRounds.length === n * NR);
const expectedMass = [32, 16, 8, 4, 2, 1];
for (let r = 0; r < NR; r++) {
  let s = 0;
  for (let t = 0; t < n; t++) s += dataRounds[t * NR + r];
  check(`round ${r} mass = ${expectedMass[r]}`, Math.abs(s - expectedMass[r]) < 0.03, s.toFixed(2));
}
let mono = true;
for (let t = 0; t < n; t++)
  for (let r = 1; r < NR; r++) if (dataRounds[t * NR + r] > dataRounds[t * NR + (r - 1)] + 1e-9) mono = false;
check("per-team reach is monotone across rounds", mono);

// --- a coherent set of picks, then the your-vs-data comparison ---
// The user loves the USA: pick them over a dozen stronger sides.
const fav = teams.findIndex((t) => t.name === "United States");
const strongerOpponents = teams
  .filter((t) => t.id !== fav && config.priorTheta[t.id] > config.priorTheta[fav])
  .slice(0, 12);
for (const opp of strongerOpponents) {
  eng.addPick(fav, opp.id);
  eng.addPick(fav, opp.id);
}

const userRounds = eng.simulate(0, true);
const cmp = buildComparison(teams, dataRounds, userRounds);

check("buildComparison returns a row per team", cmp.rows.length === n);
check("rows sorted by user champion odds (desc)", cmp.rows.every((r, i) => i === 0 || cmp.rows[i - 1].champUser >= r.champUser));
check("champion field matches round-5 of the arrays", cmp.rows.every((r) => Math.abs(r.champUser - userRounds[r.team.id * NR + 5]) < 1e-12));
check("there are movers after picks (your bracket differs from data)", cmp.up.length + cmp.down.length > 0, `up ${cmp.up.length}, down ${cmp.down.length}`);

const favRow = cmp.rows.find((r) => r.team.name === "United States");
check("the boosted favourite moved up", favRow.delta > 0, `Δ ${(favRow.delta * 100).toFixed(1)} pts (${(favRow.champData * 100).toFixed(1)}% → ${(favRow.champUser * 100).toFixed(1)}%)`);
check("each row carries a full 6-round path", cmp.rows.every((r) => r.data.length === NR && r.user.length === NR));

console.log("\n  biggest movers:");
for (const r of [...cmp.up, ...cmp.down]) console.log(`    ${r.team.name.padEnd(16)} ${(r.champData * 100).toFixed(1)}% → ${(r.champUser * 100).toFixed(1)}%`);

console.log(failures === 0 ? "\nPHASE 5 PASS — per-round sim + your-vs-data comparison" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
