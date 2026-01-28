// Constants
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
let numBoids = null;

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
  const setParams = exports.setParams;
  wasmMoveBoid = exports.moveBoid;
  wasmresetBoids = exports.resetBoids;

  // Read params from URL query string
  const params = readParams();
  numBoids = params.noOfBoids;

  // Set WASM parameters
  setParams(
    params.perceptionRadius,
    params.separationRadius,
    params.maxSpeed,
    params.maxForce,
    params.separationWeight,
    params.alignmentWeight,
    params.cohesionWeight,
    params.fieldWeight,
    params.boundaryMargin
  );

  // Allocate memory for boids: numBoids * 4 floats (x, y, vx, vy)
  const totalFloats = numBoids * FLOATS_PER_BOID;
  boidsPtr = alloc(totalFloats);

  // Create a Float32Array view into WASM memory
  boidsData = new Float32Array(memory.buffer, boidsPtr, totalFloats);

  // Initialize boids with random positions and velocities
  for (let i = 0; i < numBoids; i++) {
    const idx = i * FLOATS_PER_BOID;
    boidsData[idx] = Math.random() * canvas.width;      // x
    boidsData[idx + 1] = Math.random() * canvas.height; // y
    boidsData[idx + 2] = (Math.random() - 0.5) * 4;     // vx
    boidsData[idx + 3] = (Math.random() - 0.5) * 4;     // vy
  }

  init();
});

let animationRequestFrameId;

window.addEventListener('resize', function () {
  cancelAnimationFrame(animationRequestFrameId);
  //resetBoids(boidsPtr, numBoids);
  throttle(init, 1000)();
});

function init() {
  cancelAnimationFrame(animationRequestFrameId)
  container = document.querySelector('#app');
  canvas.height = container.clientHeight;
  canvas.width = container.clientWidth;
  effectiveWidth = canvas.width - margin;
  effectiveHeight = canvas.height - margin;
  animationRequestFrameId = requestAnimationFrame(update);
}

function update() {
  // Clear canvas
  ctx.fillStyle = "white";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Update boids using WASM
  if (wasmMoveBoid && boidsPtr) {
    wasmMoveBoid(boidsPtr, numBoids, canvas.width, canvas.height);
  }

  // Draw boids
  ctx.fillStyle = "#901f3b";
  ctx.beginPath();

  for (let i = 0; i < numBoids; i++) {
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

  animationRequestFrameId = requestAnimationFrame(update);
}

// Default values matching Zig defaults
const DEFAULTS = {
  noOfBoids: 500,
  perceptionRadius: 50.0,
  separationRadius: 25.0,
  maxSpeed: 4.0,
  maxForce: 0.1,
  separationWeight: 1.0,
  alignmentWeight: 1.0,
  cohesionWeight: 0.5,
  fieldWeight: 1.0,
  boundaryMargin: 100.0
};

function readParams() {
  const urlSearchParams = new URLSearchParams(window.location.search);

  const getFloat = (key) => {
    const val = urlSearchParams.get(key);
    return val !== null ? parseFloat(val) : DEFAULTS[key];
  };

  const getInt = (key) => {
    const val = urlSearchParams.get(key);
    return val !== null ? parseInt(val, 10) : DEFAULTS[key];
  };

  return {
    noOfBoids: getInt("noOfBoids"),
    perceptionRadius: getFloat("perceptionRadius"),
    separationRadius: getFloat("separationRadius"),
    maxSpeed: getFloat("maxSpeed"),
    maxForce: getFloat("maxForce"),
    separationWeight: getFloat("separationWeight"),
    alignmentWeight: getFloat("alignmentWeight"),
    cohesionWeight: getFloat("cohesionWeight"),
    fieldWeight: getFloat("fieldWeight"),
    boundaryMargin: getFloat("boundaryMargin")
  };
}
