const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const PARTICLE_COUNT = 200;
const STRIDE = 4; // x, y, vx, vy per particle

// WASM exports
let wasmInit = null;
let wasmStep = null;
let wasmGetParticlesPtr = null;
let wasmGetCount = null;

// WASM memory shared with Zig
const memory = new WebAssembly.Memory({
  initial: 32,
  maximum: 100,
});

function resizeCanvas() {
  const container = document.querySelector("#app");
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  if (wasmInit) {
    wasmInit(PARTICLE_COUNT, canvas.width, canvas.height);
  }
}

const importObject = {
  env: {
    memoryBase: 0,
    tableBase: 0,
    memory: memory,
    table: new WebAssembly.Table({ initial: 32, element: "anyfunc" }),
    abort: console.error,
  },
};

let lastTime = 0;

WebAssembly.instantiateStreaming(fetch("/elo/elo.wasm"), importObject).then(
  (result) => {
    const exports = result.instance.exports;

    wasmInit = exports.init;
    wasmStep = exports.step;
    wasmGetParticlesPtr = exports.getParticlesPtr;
    wasmGetCount = exports.getCount;

    resizeCanvas();
    requestAnimationFrame(update);
  },
);

function draw() {
  ctx.fillStyle = "#011936";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const count = wasmGetCount();
  const ptr = wasmGetParticlesPtr();
  const data = new Float32Array(memory.buffer, ptr, count * STRIDE);

  ctx.fillStyle = "#ed254e";
  for (let i = 0; i < count; i++) {
    const x = data[i * STRIDE + 0];
    const y = data[i * STRIDE + 1];
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function update(time) {
  const dt = lastTime ? (time - lastTime) / 1000 : 0;
  lastTime = time;

  wasmStep(dt, canvas.width, canvas.height);
  draw();

  requestAnimationFrame(update);
}

window.addEventListener("resize", resizeCanvas);
