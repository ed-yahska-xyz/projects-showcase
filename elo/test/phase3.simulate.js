// Phase 3 sanity gate. Run: `bun test/phase3.simulate.js`
// Loads the real data prior, runs the data-only 10k-tournament Monte Carlo, and
// checks structural invariants (each round's probabilities sum to the number of
// teams reaching it; per-team reach is monotone) plus that the champion-odds
// favorites are sane against public bookmaker expectations.

const wasmPath = new URL("../web/engine.wasm", import.meta.url).pathname;
const dir = new URL("../assets/", import.meta.url).pathname;
const ROUNDS = ["R32", "R16", "QF", "SF", "Final", "Champion"];
const HOSTS = new Set(["United States", "Mexico", "Canada"]);

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}
const close = (a, b, tol) => Math.abs(a - b) < tol;

// --- load + join data ---
const teams = (await Bun.file(dir + "teams.json").json()).teams.slice().sort((a, b) => a.id - b.id);
const fitDoc = await Bun.file(dir + "theta_data.json").json();
const byName = new Map(fitDoc.teams.map((t) => [t.name, t]));
const n = teams.length;

// --- instantiate + configure engine ---
const { instance } = await WebAssembly.instantiate(await Bun.file(wasmPath).arrayBuffer(), {});
const ex = instance.exports;
ex.set_teams(n);

// data strengths, interleaved [theta0, tau0, ...]
const dptr = ex.alloc(n * 2 * 8);
const dview = new Float64Array(ex.memory.buffer, dptr, n * 2);
teams.forEach((t, i) => {
  const hit = byName.get(t.name);
  dview[2 * i] = hit.theta;
  dview[2 * i + 1] = hit.tau;
});
ex.load_data_strengths(dptr, n);
ex.free(dptr, n * 2 * 8);

// groups (0..11) and hosts
const gptr = ex.alloc(n);
const gview = new Uint8Array(ex.memory.buffer, gptr, n);
teams.forEach((t, i) => (gview[i] = t.group.charCodeAt(0) - 65));
ex.load_groups(gptr, n);
ex.free(gptr, n);

const hptr = ex.alloc(n);
const hview = new Uint8Array(ex.memory.buffer, hptr, n);
teams.forEach((t, i) => (hview[i] = HOSTS.has(t.name) ? 1 : 0));
ex.load_hosts(hptr, n);
ex.free(hptr, n);

const link = fitDoc.link;
ex.set_link(link.mu, link.home_adv, link.scale);

// --- run the data-only sim ---
const RUNS = 10000;
function runSim(useUser) {
  const out = ex.alloc(n * ROUNDS.length * 8);
  ex.simulate(RUNS, useUser, out);
  const probs = Array.from(new Float64Array(ex.memory.buffer, out, n * ROUNDS.length));
  ex.free(out, n * ROUNDS.length * 8);
  return probs;
}
const probs = runSim(0);
const reach = (teamId, round) => probs[teamId * ROUNDS.length + round];

// --- structural invariants: each round's mass = teams reaching it ---
const expectedMass = [32, 16, 8, 4, 2, 1];
for (let rnd = 0; rnd < ROUNDS.length; rnd++) {
  let sum = 0;
  for (let t = 0; t < n; t++) sum += reach(t, rnd);
  check(`${ROUNDS[rnd]} probabilities sum to ${expectedMass[rnd]}`, close(sum, expectedMass[rnd], 0.02), sum.toFixed(3));
}

// --- per-team reach is monotone non-increasing across rounds ---
let mono = true;
for (let t = 0; t < n; t++) {
  for (let rnd = 1; rnd < ROUNDS.length; rnd++) {
    if (reach(t, rnd) > reach(t, rnd - 1) + 1e-9) mono = false;
  }
}
check("per-team reach is monotone (R32 >= ... >= Champion)", mono);

// --- favorites are sane vs bookmaker expectations ---
const ranked = teams
  .map((t) => ({ name: t.name, champ: reach(t.id, 5), r32: reach(t.id, 0) }))
  .sort((a, b) => b.champ - a.champ);

console.log("\n  top-10 championship odds (data-only):");
for (const r of ranked.slice(0, 10)) console.log(`    ${r.name.padEnd(16)} ${(r.champ * 100).toFixed(1)}%  (reach R32 ${(r.r32 * 100).toFixed(0)}%)`);

const STRONG = new Set(["Spain", "Argentina", "France", "England", "Brazil", "Portugal", "Germany", "Netherlands", "Morocco"]);
const top5 = ranked.slice(0, 5).map((r) => r.name);
check("at least 4 of the top-5 favorites are established powers", top5.filter((nm) => STRONG.has(nm)).length >= 4, top5.join(", "));
check("clear favorite is double-digit but not absurd (8%-30%)", ranked[0].champ > 0.08 && ranked[0].champ < 0.30, `${ranked[0].name} ${(ranked[0].champ * 100).toFixed(1)}%`);
check("a strong team almost certainly clears the group (reach R32 > 85%)", ranked[0].r32 > 0.85, `${ranked[0].name} ${(ranked[0].r32 * 100).toFixed(0)}%`);

// --- determinism: same seed -> identical output ---
const probs2 = runSim(0);
check("simulation is deterministic (same seed)", probs.every((v, i) => v === probs2[i]));

console.log(failures === 0 ? "\nPHASE 3 PASS — data-only bracket odds are structurally sound and sane" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
