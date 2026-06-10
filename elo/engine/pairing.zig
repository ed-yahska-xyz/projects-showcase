// pairing.zig — adaptive next-pair selection. Given the current fused
// strengths, with prob (1-EPS) serve the most informative not-recently-shown
// pair (max p(1-p), i.e. nearest to 50/50), with prob EPS a cross-tier "anchor"
// pair to keep the user's ranking globally anchored. The first shown pair is
// never an anchor (a seeded user should open on a genuinely close matchup).
// Jitter breaks ties so we don't keep serving the single closest pair; the side
// (which team is left/right) is randomized.

const std = @import("std");
const Rng = @import("rng.zig").Rng;

pub const EPS = 0.18;

fn sigmoid(x: f64) f64 {
    return 1.0 / (1.0 + @exp(-x));
}

fn contains(recent: []const u32, key: u32) bool {
    for (recent) |k| if (k == key) return true;
    return false;
}

// To let a user force any top team to win, the strongest `priority` teams are
// round-robined first: an as-yet-unplayed pair of two priority teams gets a
// large bonus, so all C(top,2) top-team matchups are served (most informative
// first) before the pairing falls back to the wider field. `nij` (the pick
// matrix) tells us which pairs have already been played. With prob EPS we
// instead serve a uniform-random pair (any team can surface — so a user can
// pull a dark horse in and boost it into the tier), not just near-even ones.
const PRIORITY_BONUS = 100.0;

pub fn select(
    n: usize,
    fused: []const f64,
    recent: []const u32,
    pick_count: u32,
    r: *Rng,
    priority: []const bool,
    nij: []const f64,
) [2]u32 {
    const anchor = pick_count > 0 and r.float() < EPS;
    var best: f64 = 0;
    var bi: u32 = 0;
    var bj: u32 = 1;
    var found = false;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        var j: usize = i + 1;
        while (j < n) : (j += 1) {
            const key: u32 = @intCast(i * n + j);
            if (contains(recent, key)) continue;
            const p = sigmoid(fused[i] - fused[j]);
            const info = p * (1.0 - p);
            const jitter = 0.85 + 0.3 * r.float();
            // anchor -> uniform-random pair; otherwise near-even (info).
            var score = if (anchor) jitter else info * jitter;
            if (!anchor and priority[i] and priority[j] and nij[i * n + j] == 0) {
                score += PRIORITY_BONUS; // round-robin the top tier first
            }
            if (!found or score > best) {
                best = score;
                bi = @intCast(i);
                bj = @intCast(j);
                found = true;
            }
        }
    }
    return .{ bi, bj }; // ordered; the caller randomizes which side is shown
}

test "select returns distinct in-range indices and favors near-even" {
    const n = 10;
    var fused: [10]f64 = undefined;
    for (&fused, 0..) |*v, k| v.* = @as(f64, @floatFromInt(k)) * 0.5;
    var r = Rng.init(99);
    const empty: [0]u32 = .{};
    const no_priority = [_]bool{false} ** 10;
    const no_picks = [_]f64{0} ** (10 * 10);
    var near: usize = 0;
    var t: usize = 0;
    while (t < 200) : (t += 1) {
        const pr = select(n, &fused, &empty, 0, &r, &no_priority, &no_picks);
        try std.testing.expect(pr[0] != pr[1] and pr[0] < n and pr[1] < n);
        if (@abs(fused[pr[0]] - fused[pr[1]]) <= 0.5 + 1e-9) near += 1;
    }
    // pick_count 0 -> never anchors -> always an adjacent (closest) pair.
    try std.testing.expect(near == 200);
}
