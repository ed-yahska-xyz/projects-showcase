# Boids: Flocking Simulation with Zig and WebAssembly

This project implements Craig Reynolds' classic Boids algorithm using Zig compiled to WebAssembly, with a JavaScript frontend for rendering. If you're reading this after a long break, this guide will walk you through every piece of the implementation.

## What Are Boids?

Boids (bird-oid objects) simulate the flocking behavior of birds, fish, or any group of entities that move together. The magic is that complex, organic-looking group behavior emerges from three simple rules applied to each individual:

1. **Separation** - Avoid crowding nearby boids
2. **Alignment** - Steer toward the average heading of nearby boids
3. **Cohesion** - Move toward the average position of nearby boids

## Architecture Overview

```
┌─────────────────┐      ┌─────────────────┐
│   index.js      │◄────►│   boids.wasm    │
│   (Rendering)   │      │   (Simulation)  │
└─────────────────┘      └─────────────────┘
        │                         │
        ▼                         ▼
   Canvas API              Zig compiled
   JavaScript              to WebAssembly
```

The simulation runs in WebAssembly for performance, while JavaScript handles initialization and rendering. They communicate through shared memory.

## Memory Layout

Each boid is represented as 4 consecutive floats in a shared buffer:

```
[x, y, vx, vy, x, y, vx, vy, ...]
 └─ boid 0 ─┘  └─ boid 1 ─┘
```

- `x, y` - Position
- `vx, vy` - Velocity

This flat array structure allows efficient data sharing between JavaScript and WASM without serialization overhead.

## The Vec2 Type (boids.zig)

Before diving into the algorithm, we need a 2D vector type:

```zig
pub fn Vec2(T: type) type {
    return struct {
        x: T,
        y: T,
        // ...
    };
}
const Vec2f = Vec2(f32);
```

Key operations:
- `add`, `sub` - Vector arithmetic
- `scale` - Multiply by scalar
- `length` - Magnitude (√(x² + y²))
- `normalize` - Unit vector (same direction, length = 1)
- `limit` - Cap magnitude at a maximum value

The `limit` function is crucial for boids - it prevents velocities and forces from growing unbounded.

## Algorithm Parameters

```zig
const PERCEPTION_RADIUS: f32 = 50.0;   // How far boids can "see"
const SEPARATION_RADIUS: f32 = 25.0;   // Personal space bubble
const MAX_SPEED: f32 = 4.0;            // Speed limit
const MAX_FORCE: f32 = 0.1;            // How sharply boids can turn
const SEPARATION_WEIGHT: f32 = 1.5;    // Priority of avoiding others
const ALIGNMENT_WEIGHT: f32 = 1.0;     // Priority of matching direction
const COHESION_WEIGHT: f32 = 1.0;      // Priority of staying together
const FIELD_WEIGHT: f32 = 2.0;         // Strength of boundary avoidance
const BOUNDARY_MARGIN: f32 = 100.0;    // Distance from edge where turning begins
```

Tuning these creates different behaviors:
- High `SEPARATION_WEIGHT` → Boids spread out more
- High `COHESION_WEIGHT` → Tighter flocks
- Low `MAX_FORCE` → Smoother, slower turns
- High `MAX_FORCE` → Snappy, reactive movement
- High `FIELD_WEIGHT` → Sharper turns at boundaries
- Large `BOUNDARY_MARGIN` → Boids start turning earlier, smoother curves

## The Main Loop (moveBoid)

The `moveBoid` function processes all boids each frame. For each boid:

### Step 1: Gather Neighbor Information

```zig
for (0..length) |j| {
    if (i == j) continue;  // Skip self

    const diff = pos.sub(other_pos);
    const dist = diff.length();

    // Separation: very close neighbors
    if (dist > 0 and dist < SEPARATION_RADIUS) {
        const repel = diff.normalize().scale(1.0 / dist);
        separation = separation.add(repel);
        sep_count += 1;
    }

    // Alignment & Cohesion: neighbors within perception
    if (dist > 0 and dist < PERCEPTION_RADIUS) {
        alignment = alignment.add(other_vel);
        cohesion = cohesion.add(other_pos);
        // ...
    }
}
```

**Why `1.0 / dist` for separation?** Closer boids exert stronger repulsive force. A boid 5 units away pushes with force 0.2, while one 25 units away pushes with force 0.04.

### Step 2: Calculate Steering Forces

Each rule produces a "desired velocity" that gets converted to a steering force:

```zig
// Separation
separation = separation.scale(1.0 / sep_count);      // Average
separation = separation.normalize().scale(MAX_SPEED); // Desired velocity
separation = separation.sub(vel).limit(MAX_FORCE);    // Steering force
```

**Why normalize then scale to MAX_SPEED?** The accumulated vector's magnitude is arbitrary (depends on neighbor count). We only care about *direction*. Scaling to `MAX_SPEED` says "I want to go this direction at full speed."

**Why subtract current velocity?** `steering = desired - current`. If you're already going the right direction, steering force is small. If you're going the wrong way, steering force is large.

**Why limit to MAX_FORCE?** This prevents instant direction changes. Boids turn gradually, creating smooth, natural motion.

### Step 3: Apply Forces

```zig
var accel = Vec2f.init(0, 0);
accel = accel.add(separation.scale(SEPARATION_WEIGHT));
accel = accel.add(alignment.scale(ALIGNMENT_WEIGHT));
accel = accel.add(cohesion.scale(COHESION_WEIGHT));

vel = vel.add(accel).limit(MAX_SPEED);
new_pos = pos.add(vel);
```

Forces combine additively. Weights control relative priority.

### Step 4: Boundary Handling

Instead of wrapping around edges (toroidal world), boids gradually turn away from boundaries using the vector field:

```zig
// Field steering is applied as a fourth force
const field_dir = getFieldAt(pos, field_dim);
const field_strength = getFieldStrength(pos, field_dim);
const field_force = field_dir.scale(field_strength * FIELD_WEIGHT);
accel = accel.add(field_force);

// Hard clamp as safety net (boids should rarely hit this)
new_pos.x = @max(1.0, @min(new_pos.x, width - 1.0));
new_pos.y = @max(1.0, @min(new_pos.y, height - 1.0));
```

The `BOUNDARY_MARGIN` constant (default 100.0) defines how far from the edge boids start turning. This creates a smooth, natural-looking boundary behavior where boids curve back toward the center rather than teleporting.

## Vector Fields (Advanced)

Beyond the three basic rules, we've added support for environmental vector fields that influence boid movement.

### getFieldAt - Boundary Push Direction

This function returns a vector pointing away from nearby edges, guiding boids back toward the center:

```zig
fn getFieldAt(pos: Vec2f, field_dim: Vec2f) Vec2f {
    const dist_left = pos.x;
    const dist_right = field_dim.x - pos.x;
    const dist_top = pos.y;
    const dist_bottom = field_dim.y - pos.y;

    var result = Vec2f.init(0, 0);

    // Push away from each edge within margin
    if (dist_left < BOUNDARY_MARGIN) {
        result.x += 1.0 - (dist_left / BOUNDARY_MARGIN);
    }
    if (dist_right < BOUNDARY_MARGIN) {
        result.x -= 1.0 - (dist_right / BOUNDARY_MARGIN);
    }
    if (dist_top < BOUNDARY_MARGIN) {
        result.y += 1.0 - (dist_top / BOUNDARY_MARGIN);
    }
    if (dist_bottom < BOUNDARY_MARGIN) {
        result.y -= 1.0 - (dist_bottom / BOUNDARY_MARGIN);
    }

    return if (result.length() > 0) result.normalize() else Vec2f.init(0, 0);
}
```

Key features:
- **Edge-aware**: Each edge contributes independently, so corners get diagonal push vectors
- **Distance-weighted**: Closer to edge = stronger component in that direction
- **Handles all edges uniformly**: No special-casing for top/bottom vs left/right

### getFieldStrength - Boundary Avoidance

The field only activates within `BOUNDARY_MARGIN` distance from any edge, with quadratic falloff for a more aggressive turn near the boundary:

```zig
fn getFieldStrength(pos: Vec2f, field_dim: Vec2f) f32 {
    // Find minimum distance to any edge
    const dist_left = pos.x;
    const dist_right = field_dim.x - pos.x;
    const dist_top = pos.y;
    const dist_bottom = field_dim.y - pos.y;
    const min_dist = @min(@min(dist_left, dist_right), @min(dist_top, dist_bottom));

    // No force if outside boundary margin
    if (min_dist >= BOUNDARY_MARGIN) return 0.0;

    // Quadratic falloff: gentle far from edge, strong near edge
    const t = 1.0 - (min_dist / BOUNDARY_MARGIN);
    return t * t;  // 0.0 at margin, 1.0 at edge
}
```

**Why quadratic (t²)?** Linear falloff feels unnatural - boids would turn at constant rate regardless of urgency. Squaring makes the response gentle when there's room to maneuver, but aggressive when close to the edge.

To use the field as a fourth steering behavior:

```zig
const field_dir = getFieldAt(pos, field_dim);
const strength = getFieldStrength(pos, field_dim);
const field_force = field_dir.scale(strength * FIELD_WEIGHT);
accel = accel.add(field_force);
```

## JavaScript Side (index.js)

### WASM Setup

```javascript
const memory = new WebAssembly.Memory({ initial: 32, maximum: 100 });

const importObject = {
  env: {
    memory: memory,
    jsRandom: () => Math.random(),  // Zig can call this
    // ...
  }
};

WebAssembly.instantiateStreaming(fetch('./boids.wasm'), importObject)
  .then((result) => {
    const alloc = result.instance.exports.alloc;
    wasmMoveBoid = result.instance.exports.moveBoid;

    // Allocate shared buffer
    boidsPtr = alloc(NUM_BOIDS * 4);
    boidsData = new Float32Array(memory.buffer, boidsPtr, NUM_BOIDS * 4);

    // Initialize positions/velocities
    // ...
  });
```

The `Float32Array` view lets JavaScript read/write the same memory that Zig accesses.

### Render Loop

```javascript
function update() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Run simulation in WASM
  wasmMoveBoid(boidsPtr, NUM_BOIDS, canvas.width, canvas.height);

  // Draw each boid
  for (let i = 0; i < NUM_BOIDS; i++) {
    const idx = i * 4;
    const x = boidsData[idx];
    const y = boidsData[idx + 1];
    const vx = boidsData[idx + 2];
    const vy = boidsData[idx + 3];

    // Draw circle
    ctx.arc(x, y, BOID_RADIUS, 0, 2 * Math.PI);

    // Draw direction indicator
    const angle = Math.atan2(vy, vx);
    ctx.lineTo(x + Math.cos(angle) * BOID_RADIUS * 2,
               y + Math.sin(angle) * BOID_RADIUS * 2);
  }

  requestAnimationFrame(update);
}
```

## Building

From the project root:

```bash
bun run build
```

This runs `zig build` in `projects/boids/wasm/` and copies the output to `projects/boids/boids.wasm`.

## Performance Notes

The current implementation is O(n²) - each boid checks every other boid. For 100 boids, that's 10,000 distance calculations per frame. This works fine for small flocks but doesn't scale.

Possible optimizations:
- **Spatial hashing** - Divide space into grid cells, only check neighbors in adjacent cells
- **Quadtree** - Hierarchical spatial partitioning
- **GPU compute** - Move simulation to WebGPU compute shaders

## Further Reading

- [Craig Reynolds' original paper](https://www.red3d.com/cwr/boids/)
- [Nature of Code - Flocking](https://natureofcode.com/autonomous-agents/#flocking)
