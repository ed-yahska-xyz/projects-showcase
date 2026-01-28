const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Grid settings
const CELL_SIZE = 8;
let gridWidth = 0;
let gridHeight = 0;
let animationId = null;

// WASM exports
let wasmInit = null;
let wasmStep = null;
let wasmGetGridPtr = null;
let gridData = null;

// WASM memory shared with Zig
const memory = new WebAssembly.Memory({
  initial: 32,
  maximum: 100
});

// Set canvas size and calculate grid dimensions
function resizeCanvas() {
  const container = document.querySelector('#app');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  gridWidth = Math.floor(canvas.width / CELL_SIZE);
  gridHeight = Math.floor(canvas.height / CELL_SIZE);

  // Reinitialize grid if WASM is loaded
  if (wasmInit) {
    wasmInit(gridWidth, gridHeight);
    updateGridView();
    draw();
  }
}

const importObject = {
  env: {
    memoryBase: 0,
    tableBase: 0,
    memory: memory,
    table: new WebAssembly.Table({ initial: 32, element: 'anyfunc' }),
    abort: console.error,
  }
};

// Load and run WASM
WebAssembly.instantiateStreaming(fetch('/game-of-life/game-of-life.wasm'), importObject)
  .then((result) => {
    const exports = result.instance.exports;

    wasmInit = exports.init;
    wasmStep = exports.step;
    wasmGetGridPtr = exports.getGridPtr;
    wasmAddSalt = exports.addSalt;

    // Initialize
    resizeCanvas();

    // Auto-start the simulation
    animationId = requestAnimationFrame(update);

    // Add salt every 10 seconds
    setInterval(() => {
      wasmAddSalt();
    }, 20000);
  });

function updateGridView() {
  const ptr = wasmGetGridPtr();
  if (ptr) {
    gridData = new Uint8Array(memory.buffer, ptr, gridWidth * gridHeight);
  }
}

function draw() {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!gridData) return;

  ctx.fillStyle = "#ed254e";

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (gridData[y * gridWidth + x] === 1) {
        ctx.fillRect(
          x * CELL_SIZE + 1,
          y * CELL_SIZE + 1,
          CELL_SIZE - 2,
          CELL_SIZE - 2
        );
      }
    }
  }
}

function update() {
  wasmStep();
  updateGridView();
  draw();
  setTimeout(() => {
    animationId = requestAnimationFrame(update);
  }, 64);
}

window.addEventListener('resize', resizeCanvas);
