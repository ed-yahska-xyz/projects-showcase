const std = @import("std");
const expect = std.testing.expect;
const builtin = @import("builtin");

const is_wasm = builtin.cpu.arch == .wasm32 or builtin.cpu.arch == .wasm64;

// Use WASM page allocator when targeting WASM, otherwise allow passing an allocator
pub const wasm_allocator = if (is_wasm)
    std.heap.wasm_allocator
else
    @compileError("wasm_allocator only available on WASM targets");

pub fn getDefaultAllocator() std.mem.Allocator {
    if (is_wasm) {
        return std.heap.wasm_allocator;
    } else {
        return std.heap.page_allocator;
    }
}

// Simple xorshift PRNG for WASM compatibility
var rng_state: u32 = 12345;

pub fn seedRandom(seed: u32) void {
    rng_state = if (seed == 0) 1 else seed;
}

fn nextRandom() u32 {
    var x = rng_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rng_state = x;
    return x;
}

fn randomBool() bool {
    return (nextRandom() & 1) == 1;
}

pub fn GameOfLife(comptime T: type) type {
    return struct {
        const Self = @This();
        width: usize,
        height: usize,
        cells: []T, // Flat 1D array for WASM compatibility
        allocator: std.mem.Allocator,

        // Initialize with default allocator (WASM page allocator for WASM targets)
        pub fn initDefault(height: usize, width: usize) !Self {
            return init(getDefaultAllocator(), height, width);
        }

        pub fn init(allocator: std.mem.Allocator, height: usize, width: usize) !Self {
            const cells = try allocator.alloc(T, width * height);

            // Initialize with random cells alive
            for (cells) |*cell| {
                cell.* = if (randomBool()) 1 else 0;
            }

            return Self{ .width = width, .height = height, .cells = cells, .allocator = allocator };
        }

        pub fn deinit(self: Self) void {
            self.allocator.free(self.cells);
        }

        // Get pointer to the flat array for WASM interop
        pub fn getGridPtr(self: Self) [*]T {
            return self.cells.ptr;
        }

        // Helper to get/set cells using x,y coordinates
        pub fn getCell(self: Self, x: usize, y: usize) T {
            return self.cells[y * self.width + x];
        }

        pub fn setCell(self: Self, x: usize, y: usize, value: T) void {
            self.cells[y * self.width + x] = value;
        }

        pub fn print(self: Self) !void {
            const clear_sequence = "\x1B[2J\x1B[H";
            const stdout = std.io.getStdOut().writer();
            try stdout.print(clear_sequence, .{});
            for (0..self.height) |y| {
                for (0..self.width) |x| {
                    try stdout.print("{}", .{self.getCell(x, y)});
                }
                try stdout.print("\n", .{});
            }
        }

        pub fn step(self: Self) void {
            for (0..self.height) |y| {
                for (0..self.width) |x| {
                    const numOfNeighbors = self.getNeighbours(x, y);
                    const isAlive = self.getCell(x, y) == 1;
                    if (isAlive) {
                        if (numOfNeighbors < 2 or numOfNeighbors > 3) {
                            self.setCell(x, y, 2); // Mark for death
                        }
                    }
                    if (!isAlive) {
                        if (numOfNeighbors == 3) {
                            self.setCell(x, y, 3); // Mark for birth
                        }
                    }
                }
            }
            for (0..self.height) |y| {
                for (0..self.width) |x| {
                    const cell = self.getCell(x, y);
                    self.setCell(x, y, if (cell == 1 or cell == 3) 1 else 0);
                }
            }
        }

        pub fn getNeighbours(self: Self, x: usize, y: usize) usize {
            const left = if (x == 0) self.width - 1 else x - 1;
            const right = if (x >= self.width - 1) 0 else x + 1;
            const top = if (y == 0) self.height - 1 else y - 1;
            const bottom = if (y >= self.height - 1) 0 else y + 1;

            var neighbors: usize = 0;
            const tl = self.getCell(left, top);
            const tc = self.getCell(x, top);
            const tr = self.getCell(right, top);
            const ml = self.getCell(left, y);
            const mr = self.getCell(right, y);
            const bl = self.getCell(left, bottom);
            const bc = self.getCell(x, bottom);
            const br = self.getCell(right, bottom);

            if (tl == 1 or tl == 2) neighbors += 1;
            if (tc == 1 or tc == 2) neighbors += 1;
            if (tr == 1 or tr == 2) neighbors += 1;
            if (ml == 1 or ml == 2) neighbors += 1;
            if (mr == 1 or mr == 2) neighbors += 1;
            if (bl == 1 or bl == 2) neighbors += 1;
            if (bc == 1 or bc == 2) neighbors += 1;
            if (br == 1 or br == 2) neighbors += 1;

            return neighbors;
        }

        pub fn addSalt(self: Self) void {
            for (0..self.height) |y| {
                for (0..self.width) |x| {
                    const isAlive = self.getCell(x, y);
                    const makeAlive: T = if (randomBool() and randomBool() and randomBool() and randomBool()) 1 else 0;
                    if (isAlive == 0 and makeAlive == 1) {
                        self.setCell(x, y, 1);
                    }
                }
            }
        }
    };
}

test "game of life getNeighbors" {
    const allocator = std.testing.allocator;
    var grid = try GameOfLife(u8).init(allocator, 5, 5);
    defer grid.deinit();

    // Set up a known 5x5 pattern:
    // 0 0 0 0 0
    // 0 1 1 1 0
    // 0 1 0 1 0
    // 0 1 1 1 0
    // 0 0 0 0 0
    grid.setCell(1, 1, 1);
    grid.setCell(2, 1, 1);
    grid.setCell(3, 1, 1);
    grid.setCell(1, 2, 1);
    grid.setCell(3, 2, 1);
    grid.setCell(1, 3, 1);
    grid.setCell(2, 3, 1);
    grid.setCell(3, 3, 1);

    // Test center cell (2,2) - should have 8 neighbors (all surrounding cells are alive)
    try expect(grid.getNeighbours(2, 2) == 8);

    // Test cell (1,1) - neighbors are (0,0),(0,1),(0,2),(1,0),(1,2),(2,0),(2,1),(2,2)
    // Alive neighbors: (2,1)=1, (1,2)=1 => 2 neighbors
    try expect(grid.getNeighbours(1, 1) == 2);

    // Test cell (2,2) with no neighbors - clear surrounding
    for (0..5) |y| {
        for (0..5) |x| {
            grid.setCell(x, y, 0);
        }
    }
    grid.setCell(2, 2, 1);
    try expect(grid.getNeighbours(2, 2) == 0);

    // Test with single neighbor
    grid.setCell(1, 1, 1);
    try expect(grid.getNeighbours(2, 2) == 1);
}
