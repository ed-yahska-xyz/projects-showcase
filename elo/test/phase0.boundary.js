// Phase 0 boundary proof. Run: `bun test/phase0.boundary.js`
// Verifies: instantiate the wasm engine, call a scalar export, round-trip an
// f64 array through linear memory (JS writes -> Zig computes -> JS reads), and
// handle the memory-growth view-invalidation rule that is the whole point of
// this phase.

const wasmPath = new URL("../web/engine.wasm", import.meta.url).pathname;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}

const bytes = await Bun.file(wasmPath).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const ex = instance.exports;

console.log("exports:", Object.keys(ex).sort().join(", "));
check("memory is exported", ex.memory instanceof WebAssembly.Memory);
check("expected functions exported", ["add", "alloc", "free", "sum_f64", "scale_f64"].every((f) => typeof ex[f] === "function"));

// --- scalar op ---
check("add(2,3) === 5", ex.add(2, 3) === 5);

// --- marshalling helpers (these migrate into engine.js later) ---
// Always read memory.buffer fresh: any alloc can detach prior views.
function writeF64(arr) {
  const ptr = ex.alloc(arr.length * 8);
  if (ptr === 0) throw new Error("alloc returned null");
  new Float64Array(ex.memory.buffer, ptr, arr.length).set(arr);
  return ptr;
}
function viewF64(ptr, n) {
  return new Float64Array(ex.memory.buffer, ptr, n);
}

// --- round-trip: JS writes an array, Zig sums it, JS reads the result ---
const data = [1.5, 2.25, -0.75, 10, 100.5];
const expectedSum = data.reduce((a, b) => a + b, 0);
const ptr = writeF64(data);
const got = ex.sum_f64(ptr, data.length);
check("sum_f64 round-trip", Math.abs(got - expectedSum) < 1e-12, `got ${got}, want ${expectedSum}`);

// --- Zig writes back: scale in place, JS reads mutated memory ---
ex.scale_f64(ptr, data.length, 2);
const scaled = Array.from(viewF64(ptr, data.length));
check("scale_f64 mutates memory JS reads back", scaled.every((v, i) => Math.abs(v - data[i] * 2) < 1e-12), scaled.join(","));
ex.free(ptr, data.length * 8);

// --- the gotcha: a big alloc grows linear memory and detaches old views ---
const pPtr = writeF64([7, 8, 9]);
const staleView = viewF64(pPtr, 3); // view onto the CURRENT buffer
const bufBefore = ex.memory.buffer;
const pagesBefore = ex.memory.buffer.byteLength / 65536;

// Force growth: allocate ~24 MB (far past the initial memory).
const bigPtr = ex.alloc(24 * 1024 * 1024);
check("large alloc succeeded", bigPtr !== 0);

const grew = ex.memory.buffer !== bufBefore;
const pagesAfter = ex.memory.buffer.byteLength / 65536;
check("memory grew (buffer replaced)", grew, `${pagesBefore} -> ${pagesAfter} pages`);
check("stale view is detached (byteLength 0)", staleView.byteLength === 0);

// Re-create the view from the fresh buffer at the SAME ptr — data is intact;
// only the JS view needed rebuilding.
const freshView = viewF64(pPtr, 3);
check("re-created view recovers the data", Array.from(freshView).join(",") === "7,8,9", Array.from(freshView).join(","));
check("Zig still sums the pre-growth allocation", Math.abs(ex.sum_f64(pPtr, 3) - 24) < 1e-12);

ex.free(pPtr, 24);
ex.free(bigPtr, 24 * 1024 * 1024);

console.log(failures === 0 ? "\nPHASE 0 PASS — boundary + view-invalidation proven" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
