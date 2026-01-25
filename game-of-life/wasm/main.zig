const game = @import("src/game-of-life.zig");

const GameOfLife = game.GameOfLife(u8);

var instance: ?GameOfLife = null;

export fn init(width: usize, height: usize) void {
    // Clean up existing instance
    if (instance) |inst| {
        inst.deinit();
    }

    // Seed RNG with a value derived from dimensions (for variety)
    game.seedRandom(@truncate(width *% height *% 31337));

    instance = GameOfLife.initDefault(height, width) catch null;
}

export fn step() void {
    if (instance) |inst| {
        inst.step();
    }
}

export fn getGridPtr() ?[*]u8 {
    if (instance) |inst| {
        return inst.getGridPtr();
    }
    return null;
}

export fn addSalt() void {
    if (instance) |inst| {
        inst.addSalt();
    }
}
