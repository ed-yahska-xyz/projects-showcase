// Constants
const NUM_BOIDS = 500;
const BOID_RADIUS = 5;
const FLOATS_PER_BOID = 4; // x, y, vx, vy

let container = document.querySelector('#app');
const canvas = document.getElementById("canvas");
canvas.height = container.clientHeight;
canvas.width = container.clientWidth;
const margin = BOID_RADIUS / 2;
let effectiveWidth = canvas.width - margin;
let effectiveHeight = canvas.height - margin;
const ctx = canvas.getContext("2d");

// WASM memory and boid data
const memory = new WebAssembly.Memory({
  initial: 32,
  maximum: 100
});

let boidsPtr = null;
let boidsData = null;
let wasmMoveBoid = null;

function throttle(func, timeFrame) {
  var lastTime = 0;
  return function (...args) {
      var now = new Date();
      if (now - lastTime >= timeFrame) {
          func(...args);
          lastTime = now;
      }
  };
}

const importObject = {
  env: {
    memoryBase: 0,
    tableBase: 0,
    memory: memory,
    table: new WebAssembly.Table({initial: 32, element: 'anyfunc'}),
    abort: alert,
    jsRandom: function() {
      return Math.random();
    }
  }
};

WebAssembly.instantiateStreaming(fetch('/boids/boids.wasm'), importObject).then((result) => {
  const exports = result.instance.exports;
  const alloc = exports.alloc;
  wasmMoveBoid = exports.moveBoid;

  // Allocate memory for boids: NUM_BOIDS * 4 floats (x, y, vx, vy)
  const totalFloats = NUM_BOIDS * FLOATS_PER_BOID;
  boidsPtr = alloc(totalFloats);

  // Create a Float32Array view into WASM memory
  boidsData = new Float32Array(memory.buffer, boidsPtr, totalFloats);

  // Initialize boids with random positions and velocities
  for (let i = 0; i < NUM_BOIDS; i++) {
    const idx = i * FLOATS_PER_BOID;
    boidsData[idx] = Math.random() * canvas.width;      // x
    boidsData[idx + 1] = Math.random() * canvas.height; // y
    boidsData[idx + 2] = (Math.random() - 0.5) * 4;     // vx
    boidsData[idx + 3] = (Math.random() - 0.5) * 4;     // vy
  }

  init();
});

window.addEventListener('resize', function () {
  throttle(init, 1000)();
});

function init() {
  container = document.querySelector('#app');
  canvas.height = container.clientHeight;
  canvas.width = container.clientWidth;
  effectiveWidth = canvas.width - margin;
  effectiveHeight = canvas.height - margin;
  requestAnimationFrame(update);
}

function update() {
  // Clear canvas
  ctx.fillStyle = "white";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Update boids using WASM
  if (wasmMoveBoid && boidsPtr) {
    wasmMoveBoid(boidsPtr, NUM_BOIDS, canvas.width, canvas.height);
  }

  // Draw boids
  ctx.fillStyle = "black";
  ctx.beginPath();

  for (let i = 0; i < NUM_BOIDS; i++) {
    const idx = i * FLOATS_PER_BOID;
    const x = boidsData[idx];
    const y = boidsData[idx + 1];
    const vx = boidsData[idx + 2];
    const vy = boidsData[idx + 3];

    ctx.moveTo(x + BOID_RADIUS, y);
    ctx.arc(x, y, BOID_RADIUS, 0, 2 * Math.PI);

    // Optional: draw direction indicator
    // const angle = Math.atan2(vy, vx);
    // ctx.moveTo(x, y);
    // ctx.lineTo(x + Math.cos(angle) * BOID_RADIUS * 2, y + Math.sin(angle) * BOID_RADIUS * 2);
  }

  ctx.fill();
  ctx.stroke();

  requestAnimationFrame(update);
}
