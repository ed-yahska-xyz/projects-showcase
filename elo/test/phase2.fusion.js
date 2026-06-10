// Phase 2 integration proof. Run: `bun test/phase2.fusion.js`
// Pushes synthetic picks through the WASM ABI and checks the fused strengths,
// exercising the full load_data -> add_pick -> fit_and_fuse -> readback path.

const wasmPath = new URL("../web/engine.wasm", import.meta.url).pathname;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

const bytes = await Bun.file(wasmPath).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const ex = instance.exports;

// Marshalling helpers (read memory.buffer fresh; any alloc can detach views).
function loadData(thetaData, tauData) {
  const n = thetaData.length;
  const ptr = ex.alloc(n * 2 * 8);
  const view = new Float64Array(ex.memory.buffer, ptr, n * 2);
  for (let i = 0; i < n; i++) {
    view[2 * i] = thetaData[i];
    view[2 * i + 1] = tauData[i];
  }
  ex.load_data_strengths(ptr, n);
  ex.free(ptr, n * 2 * 8);
}
const fused = (n) => Array.from(new Float64Array(ex.memory.buffer, ex.get_fused_ptr(), n));
const userTheta = (n) => Array.from(new Float64Array(ex.memory.buffer, ex.get_user_theta_ptr(), n));
const tauUser = (n) => Array.from(new Float64Array(ex.memory.buffer, ex.get_tau_user_ptr(), n));

// === Test A: 2-team BT through the ABI, with a near-zero data prior so the
// fused result is essentially the user fit. A beats B 7 of 10. ===
{
  ex.set_teams(2);
  loadData([0, 0], [1e-9, 1e-9]); // negligible prior precision
  for (let k = 0; k < 7; k++) ex.add_pick(0, 1);
  for (let k = 0; k < 3; k++) ex.add_pick(1, 0);
  ex.fit_and_fuse();

  const ut = userTheta(2);
  const f = fused(2);
  const tu = tauUser(2);
  check("A: pick count is 10", ex.get_pick_count() === 10);
  // The fit is regularized (USER_REG), so the gap is positive but shrunk just
  // below the pure MLE ln(7/3).
  const uDiff = ut[0] - ut[1];
  check("A: user theta diff positive, shrunk below ln(7/3)", uDiff > 0.7 && uDiff < Math.log(7 / 3), uDiff.toFixed(5));
  check("A: fused tracks the user fit (tiny prior)", close(f[0] - f[1], uDiff, 1e-3), `${(f[0] - f[1]).toFixed(5)}`);
  // tau uses the data prior (theta=[0,0] -> p=0.5): 10*0.25 = 2.5 per team.
  check("A: tau_user == 10*0.25 == 2.5", close(tu[0], 2.5, 1e-9) && close(tu[1], 2.5, 1e-9), `${tu[0].toFixed(4)}`);
}

// === Test B: an untouched team stays exactly at its prior; a heavily-winning
// team rises above its prior; tau_user is 0 only for the untouched team. ===
{
  ex.set_teams(4);
  const prior = [0.5, 0.0, -0.5, 0.2];
  loadData(prior, [2, 2, 2, 2]);
  // Teams 0,1,2 get compared; team 3 is never touched.
  for (let k = 0; k < 8; k++) ex.add_pick(0, 1);
  for (let k = 0; k < 2; k++) ex.add_pick(1, 0);
  for (let k = 0; k < 7; k++) ex.add_pick(0, 2);
  for (let k = 0; k < 3; k++) ex.add_pick(2, 0);
  for (let k = 0; k < 6; k++) ex.add_pick(1, 2);
  for (let k = 0; k < 4; k++) ex.add_pick(2, 1);
  ex.fit_and_fuse();

  const f = fused(4);
  const tu = tauUser(4);
  check("B: untouched team 3 == its prior exactly", close(f[3], prior[3], 1e-12), `${f[3]}`);
  check("B: untouched team 3 has tau_user 0", tu[3] === 0);
  check("B: dominant team 0 rises above prior", f[0] > prior[0], `${f[0].toFixed(4)} > ${prior[0]}`);
  check("B: touched teams accrued positive tau", tu[0] > 0 && tu[1] > 0 && tu[2] > 0);
  // Ordering among the contested teams reflects 0 > 1 > 2.
  check("B: fused ordering 0 > 1 > 2", f[0] > f[1] && f[1] > f[2]);
}

// === Test C: reset_picks clears user influence (back to the data prior). ===
{
  ex.set_teams(3);
  const prior = [0.3, -0.1, -0.2];
  loadData(prior, [1, 1, 1]);
  for (let k = 0; k < 5; k++) ex.add_pick(2, 0); // make underdog 2 beat 0
  ex.fit_and_fuse();
  const moved = fused(3);
  ex.reset_picks();
  ex.fit_and_fuse();
  const back = fused(3);
  check("C: a pick moved fused away from prior", !close(moved[2], prior[2], 1e-6));
  check("C: reset restores the data prior", back.every((v, i) => close(v, prior[i], 1e-12)));
  check("C: pick count is 0 after reset", ex.get_pick_count() === 0);
}

console.log(failures === 0 ? "\nPHASE 2 PASS — synthetic picks produce correct fused strengths" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
