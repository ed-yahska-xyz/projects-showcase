const std = @import("std");
const build_options = @import("build_options");
extern var memory: f32;

const Imports = struct {
    extern fn jsRandom() f32;
};

pub fn Vec2(T: type) type {
    return struct {
        x: T,
        y: T,

        const Self = @This();

        pub fn init(x: T, y: T) Self {
            return Self{ .x = x, .y = y };
        }

        pub fn add(self: Self, other: Self) Self {
            return Self{ .x = self.x + other.x, .y = self.y + other.y };
        }

        pub fn sub(self: Self, other: Self) Self {
            return Self{ .x = self.x - other.x, .y = self.y - other.y };
        }

        pub fn scale(self: Self, s: T) Self {
            return Self{ .x = self.x * s, .y = self.y * s };
        }

        pub fn length(self: Self) T {
            return @sqrt(self.x * self.x + self.y * self.y);
        }

        pub fn normalize(self: Self) Self {
            const len = self.length();
            if (len == 0) return Self{ .x = 0, .y = 0 };
            return Self{ .x = self.x / len, .y = self.y / len };
        }

        pub fn limit(self: Self, max: T) Self {
            const len = self.length();
            if (len > max) {
                return self.normalize().scale(max);
            }
            return self;
        }
    };
}

const Vec2f = Vec2(f32);

// Boids algorithm parameters
const PERCEPTION_RADIUS: f32 = 50.0;
const SEPARATION_RADIUS: f32 = 25.0;
const MAX_SPEED: f32 = 4.0;
const MAX_FORCE: f32 = 0.1;
const SEPARATION_WEIGHT: f32 = 1.5;
const ALIGNMENT_WEIGHT: f32 = 1.0;
const COHESION_WEIGHT: f32 = 0.5;
const FIELD_WEIGHT: f32 = 1.0;
const BOUNDARY_MARGIN: f32 = 100.0; // Distance from edge where turning begins

// var prng = std.rand.DefaultPrng.init(7777);
// const rand = prng.random();

const Boid = struct {
    location: Vec2f,
    motion: Vec2f,

    pub fn init(location: Vec2f, motion: Vec2f) Boid {
        return Boid{
            .location = location,
            .motion = motion,
        };
    }
};

var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();

export fn add(a: i32, b: i32) i32 {
    return a + b;
}

fn getFieldStrength(pos: Vec2f, field_dim: Vec2f) f32 {
    // Distance to each edge
    const dist_left = pos.x;
    const dist_right = field_dim.x - pos.x;
    const dist_top = pos.y;
    const dist_bottom = field_dim.y - pos.y;

    // Find minimum distance to any edge
    const min_x = @min(dist_left, dist_right);
    const min_y = @min(dist_top, dist_bottom);
    const min_dist = @min(min_x, min_y);

    // Only apply force within boundary margin
    if (min_dist >= BOUNDARY_MARGIN) {
        return 0.0;
    }

    // Strength increases as boid gets closer to edge (inverse relationship)
    // 0.0 at margin distance, 1.0 at edge
    const t = 1.0 - (min_dist / BOUNDARY_MARGIN);

    // Square for stronger response near edges
    return t * t;
}

fn getFieldAt(pos: Vec2f, field_dim: Vec2f) Vec2f {
    // Distance to each edge
    const dist_left = pos.x;
    const dist_right = field_dim.x - pos.x;
    const dist_top = pos.y;
    const dist_bottom = field_dim.y - pos.y;

    // Build a vector pointing away from the nearest edge(s)
    var result = Vec2f.init(0, 0);

    // Horizontal component: push away from left/right edges
    if (dist_left < BOUNDARY_MARGIN) {
        result.x += 1.0 - (dist_left / BOUNDARY_MARGIN);
    }
    if (dist_right < BOUNDARY_MARGIN) {
        result.x -= 1.0 - (dist_right / BOUNDARY_MARGIN);
    }

    // Vertical component: push away from top/bottom edges
    if (dist_top < BOUNDARY_MARGIN) {
        result.y += 1.0 - (dist_top / BOUNDARY_MARGIN);
    }
    if (dist_bottom < BOUNDARY_MARGIN) {
        result.y -= 1.0 - (dist_bottom / BOUNDARY_MARGIN);
    }

    // Add a slight tangent component for smoother turning (curves instead of hard bounces)
    const cx = field_dim.x / 2.0;
    const cy = field_dim.y / 2.0;
    const dx = pos.x - cx;
    const dy = pos.y - cy;

    // Perpendicular to center direction (clockwise rotation)
    const tangent = Vec2f.init(-dy, dx).normalize();

    // Blend: mostly direct push, slight curve
    if (result.length() > 0) {
        const direct = result.normalize();
        return direct.scale(0.8).add(tangent.scale(0.2)).normalize();
    }

    return Vec2f.init(0, 0);
}

// Boid data layout: [x, y, vx, vy] per boid (4 floats each)
// length = number of boids
export fn moveBoid(b: [*]f32, length: usize, width: f32, height: f32) void {
    const stride = 4; // x, y, vx, vy
    const field_dim = Vec2f.init(width, height);
    // Process each boid
    for (0..length) |i| {
        const idx = i * stride;
        const pos = Vec2f.init(b[idx], b[idx + 1]);
        var vel = Vec2f.init(b[idx + 2], b[idx + 3]);

        // Initialize steering forces
        var separation = Vec2f.init(0, 0);
        var alignment = Vec2f.init(0, 0);
        var cohesion = Vec2f.init(0, 0);
        var field_force = Vec2f.init(0, 0);
        var sep_count: f32 = 0;
        var align_count: f32 = 0;
        var cohesion_count: f32 = 0;

        // Check all other boids
        for (0..length) |j| {
            if (i == j) continue;

            const other_idx = j * stride;
            const other_pos = Vec2f.init(b[other_idx], b[other_idx + 1]);
            const other_vel = Vec2f.init(b[other_idx + 2], b[other_idx + 3]);

            const diff = pos.sub(other_pos);
            const dist = diff.length();

            // Separation: steer away from nearby boids
            if (dist > 0 and dist < SEPARATION_RADIUS) {
                const repel = diff.normalize().scale(1.0 / dist);
                separation = separation.add(repel);
                sep_count += 1;
            }

            // Alignment & Cohesion: consider boids within perception radius
            if (dist > 0 and dist < PERCEPTION_RADIUS) {
                alignment = alignment.add(other_vel);
                align_count += 1;

                cohesion = cohesion.add(other_pos);
                cohesion_count += 1;
            }
        }

        var accel = Vec2f.init(0, 0);

        // Apply separation
        if (sep_count > 0) {
            separation = separation.scale(1.0 / sep_count);
            separation = separation.normalize().scale(MAX_SPEED);
            separation = separation.sub(vel).limit(MAX_FORCE);
            accel = accel.add(separation.scale(SEPARATION_WEIGHT));
        }

        // Apply alignment
        if (align_count > 0) {
            alignment = alignment.scale(1.0 / align_count);
            alignment = alignment.normalize().scale(MAX_SPEED);
            alignment = alignment.sub(vel).limit(MAX_FORCE);
            accel = accel.add(alignment.scale(ALIGNMENT_WEIGHT));
        }

        // Apply cohesion
        if (cohesion_count > 0) {
            cohesion = cohesion.scale(1.0 / cohesion_count);
            const desired = cohesion.sub(pos).normalize().scale(MAX_SPEED);
            const steer = desired.sub(vel).limit(MAX_FORCE);
            accel = accel.add(steer.scale(COHESION_WEIGHT));
        }

        const field_dir = getFieldAt(pos, field_dim);
        const field_strength = getFieldStrength(pos, field_dim);
        field_force = field_dir.scale(field_strength * FIELD_WEIGHT);

        accel = accel.add(field_force);

        // Update velocity
        vel = vel.add(accel).limit(MAX_SPEED);

        // Update position
        var new_pos = pos.add(vel);

        // Clamp to boundaries (soft boundary via field steering, hard clamp as safety)
        new_pos.x = @max(1.0, @min(new_pos.x, width - 1.0));
        new_pos.y = @max(1.0, @min(new_pos.y, height - 1.0));

        // Write back
        b[idx] = new_pos.x;
        b[idx + 1] = new_pos.y;
        b[idx + 2] = vel.x;
        b[idx + 3] = vel.y;
    }
}

export fn createBoids(count: usize) ?[*]Boid {
    const arr = allocator.alloc(Boid, count) catch return null;
    for (0..arr.len) |i| {
        const x = Imports.jsRandom();
        const y = Imports.jsRandom();
        const mx = Imports.jsRandom();
        const my = Imports.jsRandom();
        arr[i] = Boid.init(Vec2f.init(x, y), Vec2f.init(mx, my));
    }
    const ptr: [*]Boid = arr.ptr;
    return ptr;
}

export fn alloc(len: usize) ?[*]f32 {
    const arr = allocator.alloc(f32, len) catch return null;
    @memset(arr, 0.0);
    const ptr: [*]f32 = arr.ptr;
    return ptr;
}

test "pointer arithmatic" {
    const x = alloc(5);
    moveBoid(x.?, 5);
    for (0..5) |i| {
        const p = x.? + i * @sizeOf(f32);
        std.debug.print("{d} ", .{p[0]});
    }
}
