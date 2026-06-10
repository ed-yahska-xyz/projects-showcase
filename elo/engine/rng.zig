// rng.zig — seedable PRNG (xoshiro256**) + a Poisson sampler. Deterministic
// given a seed, so identical picks yield identical predictions and the
// your-vs-data diff is honest (same seed for both runs).

const std = @import("std");

pub const Rng = struct {
    s: [4]u64,

    pub fn init(seed: u64) Rng {
        // splitmix64 to spread the seed across the 256-bit state.
        var z = seed;
        var st: [4]u64 = undefined;
        for (&st) |*x| {
            z +%= 0x9E3779B97F4A7C15;
            var r = z;
            r = (r ^ (r >> 30)) *% 0xBF58476D1CE4E5B9;
            r = (r ^ (r >> 27)) *% 0x94D049BB133111EB;
            r = r ^ (r >> 31);
            x.* = r;
        }
        return .{ .s = st };
    }

    pub fn next(self: *Rng) u64 {
        const result = std.math.rotl(u64, self.s[1] *% 5, 7) *% 9;
        const t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = std.math.rotl(u64, self.s[3], 45);
        return result;
    }

    /// Uniform in [0, 1).
    pub fn float(self: *Rng) f64 {
        return @as(f64, @floatFromInt(self.next() >> 11)) * (1.0 / 9007199254740992.0);
    }

    /// Poisson(lambda) via Knuth — fine for the small lambdas of football goals.
    pub fn poisson(self: *Rng, lambda: f64) u32 {
        const L = @exp(-lambda);
        var k: u32 = 0;
        var p: f64 = 1.0;
        while (true) {
            k += 1;
            p *= self.float();
            if (p <= L) break;
        }
        return k - 1;
    }
};

test "poisson mean tracks lambda" {
    var r = Rng.init(12345);
    const lambda: f64 = 1.7;
    var sum: f64 = 0;
    const N: usize = 200000;
    var i: usize = 0;
    while (i < N) : (i += 1) sum += @floatFromInt(r.poisson(lambda));
    const mean = sum / @as(f64, @floatFromInt(N));
    try std.testing.expectApproxEqAbs(lambda, mean, 0.03);
}

test "float stays in unit interval" {
    var r = Rng.init(7);
    var i: usize = 0;
    while (i < 10000) : (i += 1) {
        const f = r.float();
        try std.testing.expect(f >= 0.0 and f < 1.0);
    }
}
