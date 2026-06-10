// tournament.zig — one 48-team World Cup instance + the Monte Carlo driver.
// 12 groups of 4 -> top 2 + best 8 third-placed -> R32 -> R16 -> QF -> SF ->
// Final. Group fixtures are the round-robin implied by membership; scorelines
// come from poisson.zig; knockout draws resolve by a win-probability coin flip.
//
// The knockout uses the OFFICIAL 2026 bracket from assets/schedule.json: the 16
// R32 slot definitions (W_x / RU_x / 3rd:set), the third-place->slot assignment
// (bipartite-matched per run against each slot's allowed group set), and the
// W74/L101-style feed graph through to the final. Group letters are the
// teams.json convention (A=0 .. L=11), matching schedule.json.

const std = @import("std");
const Rng = @import("rng.zig").Rng;
const poisson = @import("poisson.zig");
const Link = poisson.Link;

const MAX_TEAMS = 64;
const NGROUPS = 12;
const GSIZE = 4;
pub const NROUNDS = 6; // [0]=R32 [1]=R16 [2]=QF [3]=SF [4]=Final [5]=Champion

// --- official bracket structure (mirrors schedule.json meta) -----------------
// A slot source: a group winner (0), runner-up (1), or a 3rd-place slot (2).
const Src = struct { kind: u8, idx: u8 };
const W = 0; // group winner; idx = group
const R = 1; // runner-up;    idx = group
const T = 2; // third-place;  idx = third-slot index 0..7

// R32 matches 73..88 (index k = match 73+k).
const R32_HOME = [16]Src{
    .{ .kind = R, .idx = 0 },  .{ .kind = W, .idx = 4 },  .{ .kind = W, .idx = 5 },  .{ .kind = W, .idx = 2 },
    .{ .kind = W, .idx = 8 },  .{ .kind = R, .idx = 4 },  .{ .kind = W, .idx = 0 },  .{ .kind = W, .idx = 11 },
    .{ .kind = W, .idx = 3 },  .{ .kind = W, .idx = 6 },  .{ .kind = R, .idx = 10 }, .{ .kind = W, .idx = 7 },
    .{ .kind = W, .idx = 1 },  .{ .kind = W, .idx = 9 },  .{ .kind = W, .idx = 10 }, .{ .kind = R, .idx = 3 },
};
const R32_AWAY = [16]Src{
    .{ .kind = R, .idx = 1 }, .{ .kind = T, .idx = 0 }, .{ .kind = R, .idx = 2 }, .{ .kind = R, .idx = 5 },
    .{ .kind = T, .idx = 1 }, .{ .kind = R, .idx = 8 }, .{ .kind = T, .idx = 2 }, .{ .kind = T, .idx = 3 },
    .{ .kind = T, .idx = 4 }, .{ .kind = T, .idx = 5 }, .{ .kind = R, .idx = 11 }, .{ .kind = R, .idx = 9 },
    .{ .kind = T, .idx = 6 }, .{ .kind = R, .idx = 7 }, .{ .kind = T, .idx = 7 }, .{ .kind = R, .idx = 6 },
};
// Allowed group set per 3rd-place slot (slots 0..7 -> matches 74,77,79,80,81,82,85,87).
const THIRD_SLOT_ALLOWED = [8][5]u8{
    .{ 0, 1, 2, 3, 5 }, .{ 2, 3, 5, 6, 7 }, .{ 2, 4, 5, 7, 8 }, .{ 4, 7, 8, 9, 10 },
    .{ 1, 4, 5, 8, 9 }, .{ 0, 4, 7, 8, 9 }, .{ 4, 5, 6, 8, 9 }, .{ 3, 4, 8, 9, 11 },
};

// Feed graph for matches 89..104 (index i = match 89+i). take_loser only for M103.
const FeedSrc = struct { match: u8, loser: bool };
const FEED = [16][2]FeedSrc{
    .{ .{ .match = 74, .loser = false }, .{ .match = 77, .loser = false } }, // 89
    .{ .{ .match = 73, .loser = false }, .{ .match = 75, .loser = false } }, // 90
    .{ .{ .match = 76, .loser = false }, .{ .match = 78, .loser = false } }, // 91
    .{ .{ .match = 79, .loser = false }, .{ .match = 80, .loser = false } }, // 92
    .{ .{ .match = 83, .loser = false }, .{ .match = 84, .loser = false } }, // 93
    .{ .{ .match = 81, .loser = false }, .{ .match = 82, .loser = false } }, // 94
    .{ .{ .match = 86, .loser = false }, .{ .match = 88, .loser = false } }, // 95
    .{ .{ .match = 85, .loser = false }, .{ .match = 87, .loser = false } }, // 96
    .{ .{ .match = 89, .loser = false }, .{ .match = 90, .loser = false } }, // 97
    .{ .{ .match = 93, .loser = false }, .{ .match = 94, .loser = false } }, // 98
    .{ .{ .match = 91, .loser = false }, .{ .match = 92, .loser = false } }, // 99
    .{ .{ .match = 95, .loser = false }, .{ .match = 96, .loser = false } }, // 100
    .{ .{ .match = 97, .loser = false }, .{ .match = 98, .loser = false } }, // 101
    .{ .{ .match = 99, .loser = false }, .{ .match = 100, .loser = false } }, // 102
    .{ .{ .match = 101, .loser = true }, .{ .match = 102, .loser = true } }, // 103 (3rd place)
    .{ .{ .match = 101, .loser = false }, .{ .match = 102, .loser = false } }, // 104 (final)
};

// The round a winner of match m reaches (R32 winners are marked directly).
fn roundOf(m: usize) usize {
    if (m <= 96) return 2; // R16 winners -> QF
    if (m <= 100) return 3; // QF -> SF
    if (m <= 102) return 4; // SF -> Final
    return 5; // 104 final -> Champion
}

const Standing = struct {
    team: u32,
    pts: f64 = 0,
    gf: i32 = 0,
    ga: i32 = 0,
    key: u64 = 0, // random tiebreaker (drawing of lots), stable within a run
};

// Rank higher (sort earlier): points, then GD, then GF, then the random draw.
// (head-to-head and fair-play deferred — see PLAN.md.)
fn ranksAbove(_: void, a: Standing, b: Standing) bool {
    if (a.pts != b.pts) return a.pts > b.pts;
    const agd = a.gf - a.ga;
    const bgd = b.gf - b.ga;
    if (agd != bgd) return agd > bgd;
    if (a.gf != b.gf) return a.gf > b.gf;
    return a.key < b.key;
}

fn thirdRanksAbove(ctx: *const [NGROUPS]Standing, a: u8, b: u8) bool {
    return ranksAbove({}, ctx[a], ctx[b]);
}

fn inAllowed(slot: usize, group: u8) bool {
    for (THIRD_SLOT_ALLOWED[slot]) |g| if (g == group) return true;
    return false;
}

// Kuhn augmenting path: match qualified third groups onto the 8 third slots.
fn augment(group: u8, visited: *[8]bool, group_of_slot: *[8]u8) bool {
    var s: usize = 0;
    while (s < 8) : (s += 1) {
        if (visited[s] or !inAllowed(s, group)) continue;
        visited[s] = true;
        if (group_of_slot[s] == 255 or augment(group_of_slot[s], visited, group_of_slot)) {
            group_of_slot[s] = group;
            return true;
        }
    }
    return false;
}

const Sim = struct {
    n: usize,
    strengths: []const f64,
    groups: []const u8,
    hosts: []const u8,
    link: Link,

    fn homeOf(self: *const Sim, i: u32, j: u32) struct { h: u32, a: u32, flag: f64 } {
        if (self.hosts[i] == 1 and self.hosts[j] == 0) return .{ .h = i, .a = j, .flag = 1.0 };
        if (self.hosts[j] == 1 and self.hosts[i] == 0) return .{ .h = j, .a = i, .flag = 1.0 };
        return .{ .h = i, .a = j, .flag = 0.0 };
    }

    fn playGroup(self: *const Sim, r: *Rng, st: []Standing, i: u32, j: u32) void {
        const m = self.homeOf(i, j);
        const sc = poisson.sampleScore(r, self.strengths[m.h], self.strengths[m.a], m.flag, self.link);
        const gh: i32 = @intCast(sc[0]);
        const ga: i32 = @intCast(sc[1]);
        st[m.h].gf += gh;
        st[m.h].ga += ga;
        st[m.a].gf += ga;
        st[m.a].ga += gh;
        if (gh > ga) {
            st[m.h].pts += 3;
        } else if (ga > gh) {
            st[m.a].pts += 3;
        } else {
            st[m.h].pts += 1;
            st[m.a].pts += 1;
        }
    }

    // Knockout: sample a scoreline; a draw goes to a win-probability coin flip.
    fn playKnockout(self: *const Sim, r: *Rng, i: u32, j: u32) u32 {
        const m = self.homeOf(i, j);
        const sc = poisson.sampleScore(r, self.strengths[m.h], self.strengths[m.a], m.flag, self.link);
        if (sc[0] > sc[1]) return m.h;
        if (sc[1] > sc[0]) return m.a;
        const p_i = 1.0 / (1.0 + @exp(-(self.strengths[i] - self.strengths[j])));
        return if (r.float() < p_i) i else j;
    }

    fn resolveSrc(src: Src, winner: [NGROUPS]u32, runner: [NGROUPS]u32, third: [NGROUPS]u32, gos: [8]u8) u32 {
        return switch (src.kind) {
            W => winner[src.idx],
            R => runner[src.idx],
            else => third[gos[src.idx]], // T: third of the group matched to this slot
        };
    }
};

fn runOnce(sim: *const Sim, r: *Rng, reach: []f64) void {
    var st: [MAX_TEAMS]Standing = undefined;
    var i: usize = 0;
    while (i < sim.n) : (i += 1) st[i] = .{ .team = @intCast(i), .key = r.next() };

    // Gather group members.
    var members: [NGROUPS][GSIZE]u32 = undefined;
    var gc = [_]usize{0} ** NGROUPS;
    i = 0;
    while (i < sim.n) : (i += 1) {
        const g = sim.groups[i];
        members[g][gc[g]] = @intCast(i);
        gc[g] += 1;
    }

    // Play each group's round-robin and rank it.
    var winner: [NGROUPS]u32 = undefined;
    var runner: [NGROUPS]u32 = undefined;
    var third: [NGROUPS]u32 = undefined;
    var third_standing: [NGROUPS]Standing = undefined;
    var g: usize = 0;
    while (g < NGROUPS) : (g += 1) {
        const m = members[g];
        var a: usize = 0;
        while (a < GSIZE) : (a += 1) {
            var b: usize = a + 1;
            while (b < GSIZE) : (b += 1) sim.playGroup(r, &st, m[a], m[b]);
        }
        var tbl: [GSIZE]Standing = .{ st[m[0]], st[m[1]], st[m[2]], st[m[3]] };
        std.sort.insertion(Standing, &tbl, {}, ranksAbove);
        winner[g] = tbl[0].team;
        runner[g] = tbl[1].team;
        third[g] = tbl[2].team;
        third_standing[g] = tbl[2];
    }

    // Best 8 of the 12 third-placed teams qualify (rank groups by their third).
    var third_order = [_]u8{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
    std.sort.insertion(u8, &third_order, &third_standing, thirdRanksAbove);
    var qualified = [_]bool{false} ** NGROUPS;
    i = 0;
    while (i < 8) : (i += 1) qualified[third_order[i]] = true;

    // Bipartite-match the 8 qualified third groups onto the 8 third-place slots.
    var group_of_slot = [_]u8{255} ** 8;
    var gi: u8 = 0;
    while (gi < NGROUPS) : (gi += 1) {
        if (!qualified[gi]) continue;
        var visited = [_]bool{false} ** 8;
        _ = augment(gi, &visited, &group_of_slot);
    }

    // Resolve the 16 R32 matches; everyone in them has reached R32 (round 0).
    var win_of: [105]u32 = undefined;
    var lose_of: [105]u32 = undefined;
    var k: usize = 0;
    while (k < 16) : (k += 1) {
        const home = Sim.resolveSrc(R32_HOME[k], winner, runner, third, group_of_slot);
        const away = Sim.resolveSrc(R32_AWAY[k], winner, runner, third, group_of_slot);
        reach[home * NROUNDS + 0] += 1;
        reach[away * NROUNDS + 0] += 1;
        const w = sim.playKnockout(r, home, away);
        const m = 73 + k;
        win_of[m] = w;
        lose_of[m] = if (w == home) away else home;
        reach[w * NROUNDS + 1] += 1; // R32 winner reaches R16
    }

    // Matches 89..104 follow the feed graph (skip 103, the untracked 3rd place).
    i = 0;
    while (i < 16) : (i += 1) {
        const m = 89 + i;
        if (m == 103) continue;
        const f0 = FEED[i][0];
        const f1 = FEED[i][1];
        const home = if (f0.loser) lose_of[f0.match] else win_of[f0.match];
        const away = if (f1.loser) lose_of[f1.match] else win_of[f1.match];
        const w = sim.playKnockout(r, home, away);
        win_of[m] = w;
        lose_of[m] = if (w == home) away else home;
        reach[w * NROUNDS + roundOf(m)] += 1;
    }
}

pub fn runMonteCarlo(
    runs: u32,
    n: usize,
    strengths: []const f64,
    groups: []const u8,
    hosts: []const u8,
    link: Link,
    seed: u64,
    reach_out: []f64, // n * NROUNDS, accumulates then normalizes to probabilities
) void {
    @memset(reach_out, 0);
    var sim = Sim{ .n = n, .strengths = strengths, .groups = groups, .hosts = hosts, .link = link };
    var r = Rng.init(seed);
    var run: u32 = 0;
    while (run < runs) : (run += 1) runOnce(&sim, &r, reach_out);

    const inv = 1.0 / @as(f64, @floatFromInt(runs));
    for (reach_out) |*v| v.* *= inv;
}

// --- structure transcription guards (catch hand-encoding errors) -------------
test "R32 sources cover all 12 winners, 12 runners, and 8 third-slots once" {
    var wc = [_]u8{0} ** NGROUPS;
    var rc = [_]u8{0} ** NGROUPS;
    var tc = [_]u8{0} ** 8;
    for (R32_HOME ++ R32_AWAY) |s| {
        switch (s.kind) {
            W => wc[s.idx] += 1,
            R => rc[s.idx] += 1,
            else => tc[s.idx] += 1,
        }
    }
    for (wc) |c| try std.testing.expectEqual(@as(u8, 1), c);
    for (rc) |c| try std.testing.expectEqual(@as(u8, 1), c);
    for (tc) |c| try std.testing.expectEqual(@as(u8, 1), c);
}

test "feed graph references each upstream match the right number of times" {
    var fed = [_]u32{0} ** 105;
    for (FEED) |pair| {
        fed[pair[0].match] += 1;
        fed[pair[1].match] += 1;
    }
    var m: usize = 73;
    while (m <= 100) : (m += 1) try std.testing.expectEqual(@as(u32, 1), fed[m]); // each fed forward once
    try std.testing.expectEqual(@as(u32, 2), fed[101]); // SF1 -> final + 3rd place
    try std.testing.expectEqual(@as(u32, 2), fed[102]); // SF2 -> final + 3rd place
    try std.testing.expectEqual(@as(u32, 0), fed[103]); // 3rd place is terminal
    try std.testing.expectEqual(@as(u32, 0), fed[104]); // final is terminal
}

test "third-slot matching yields a valid distinct assignment" {
    // With all groups available a perfect matching of the 8 slots must exist.
    var gos = [_]u8{255} ** 8;
    var gi: u8 = 0;
    while (gi < NGROUPS) : (gi += 1) {
        var visited = [_]bool{false} ** 8;
        _ = augment(gi, &visited, &gos);
    }
    var used = [_]bool{false} ** NGROUPS;
    for (gos, 0..) |grp, slot| {
        try std.testing.expect(grp != 255); // every slot assigned
        try std.testing.expect(inAllowed(slot, grp)); // honors the allowed set
        try std.testing.expect(!used[grp]); // distinct group per slot
        used[grp] = true;
    }
}
