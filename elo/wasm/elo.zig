const std = @import("std");
const build_options = @import("build_options");

// Each particle is 4 f32s: x, y, vx, vy.
const max_particles = 512;
const stride = 4;

var particles: [max_particles * stride]f32 = undefined;
var count: usize = 0;

// Simple xorshift RNG so the starter doesn't need any host imports.
var rng_state: u32 = 0x9E3779B9;

fn nextRandom() u32 {
    var x = rng_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rng_state = x;
    return x;
}

// Returns a float in [0, 1).
fn randomFloat() f32 {
    return @as(f32, @floatFromInt(nextRandom() >> 8)) / @as(f32, @floatFromInt(1 << 24));
}

/// Seed `n` particles spread across a `width` x `height` field.
export fn init(n: usize, width: f32, height: f32) void {
    count = if (n > max_particles) max_particles else n;
    rng_state = 0x9E3779B9 ^ @as(u32, @intFromFloat(width * height));

    var i: usize = 0;
    while (i < count) : (i += 1) {
        const base = i * stride;
        particles[base + 0] = randomFloat() * width; // x
        particles[base + 1] = randomFloat() * height; // y
        particles[base + 2] = (randomFloat() - 0.5) * 240.0; // vx (px/s)
        particles[base + 3] = (randomFloat() - 0.5) * 240.0; // vy (px/s)
    }
}

/// Advance the simulation by `dt` seconds, bouncing off the field edges.
export fn step(dt: f32, width: f32, height: f32) void {
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const base = i * stride;
        var x = particles[base + 0] + particles[base + 2] * dt;
        var y = particles[base + 1] + particles[base + 3] * dt;

        if (x < 0) {
            x = 0;
            particles[base + 2] = -particles[base + 2];
        } else if (x > width) {
            x = width;
            particles[base + 2] = -particles[base + 2];
        }
        if (y < 0) {
            y = 0;
            particles[base + 3] = -particles[base + 3];
        } else if (y > height) {
            y = height;
            particles[base + 3] = -particles[base + 3];
        }

        particles[base + 0] = x;
        particles[base + 1] = y;
    }
}

/// Pointer to the particle buffer so JS can read positions directly.
export fn getParticlesPtr() [*]f32 {
    return &particles;
}

/// Number of active particles.
export fn getCount() usize {
    return count;
}
