// exports.zig — the WASM ABI. Owns the engine state and the allocator; defers
// the modeling to strength.zig / fusion.zig. All params/returns are numbers;
// arrays cross the boundary as (ptr, len) into the exported linear memory.
//
// Phase 0: alloc/free/add/sum_f64/scale_f64 (boundary proof, kept as a smoke).
// Phase 2: set_teams / load_data_strengths / load_groups / reset_picks /
//          add_pick / fit_and_fuse, plus get_*_ptr readback for tests + the
//          eventual simulate.

const std = @import("std");
const strength = @import("strength.zig");
const fusion = @import("fusion.zig");
const poisson = @import("poisson.zig");
const tournament = @import("tournament.zig");
const pairing = @import("pairing.zig");
const Rng = @import("rng.zig").Rng;

const allocator = std.heap.wasm_allocator;

// ---------------------------------------------------------------------------
// Phase 0 boundary exports
// ---------------------------------------------------------------------------
export fn alloc(len: usize) ?[*]u8 {
    const slice = allocator.alloc(u8, len) catch return null;
    return slice.ptr;
}
export fn free(ptr: [*]u8, len: usize) void {
    allocator.free(ptr[0..len]);
}
export fn add(a: i32, b: i32) i32 {
    return a +% b;
}
export fn sum_f64(ptr: [*]const f64, n: usize) f64 {
    var total: f64 = 0;
    var i: usize = 0;
    while (i < n) : (i += 1) total += ptr[i];
    return total;
}
export fn scale_f64(ptr: [*]f64, n: usize, k: f64) void {
    var i: usize = 0;
    while (i < n) : (i += 1) ptr[i] *= k;
}

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------
var n_teams: usize = 0;
var theta_data: []f64 = &.{};
var tau_data: []f64 = &.{};
var theta_user: []f64 = &.{};
var tau_user: []f64 = &.{};
var fused: []f64 = &.{};
var wins: []f64 = &.{}; // W_i
var nij: []f64 = &.{}; // dense n*n meeting counts (symmetric)
var groups: []u8 = &.{}; // group index 0..11 per team
var hosts: []u8 = &.{}; // 1 if host nation, else 0
var link: poisson.Link = .{}; // calibrated strength->goals link

// Adaptive-pairing state.
const RECENT_CAP = 16;
const TARGET_INFO: f64 = 18.0; // total tau_user that reads as a "full" ranking
const USER_REG: f64 = 1.0; // regularize the sparse user fit (keeps it bounded)
var recent_buf: [RECENT_CAP]u32 = undefined;
var recent_count: usize = 0;
var recent_head: usize = 0;
var pair_rng: Rng = undefined;
const TOP_N = 10; // the strongest N teams get a head-to-head round-robin first
var priority: []bool = &.{}; // top-N by data prior
// scratch for the fit
var beta_scratch: []f64 = &.{};
var next_scratch: []f64 = &.{};
var played: []bool = &.{};
var total_picks: u32 = 0;

fn freeF64(s: *[]f64) void {
    if (s.len > 0) allocator.free(s.*);
    s.* = &.{};
}

fn allocF64(n: usize) []f64 {
    const s = allocator.alloc(f64, n) catch unreachable;
    @memset(s, 0);
    return s;
}

/// Declare the team count and (re)allocate all state.
export fn set_teams(count: u32) void {
    // free any prior allocation (slices carry their own lengths)
    freeF64(&theta_data);
    freeF64(&tau_data);
    freeF64(&theta_user);
    freeF64(&tau_user);
    freeF64(&fused);
    freeF64(&wins);
    freeF64(&nij);
    freeF64(&beta_scratch);
    freeF64(&next_scratch);
    if (groups.len > 0) {
        allocator.free(groups);
        groups = &.{};
    }
    if (hosts.len > 0) {
        allocator.free(hosts);
        hosts = &.{};
    }
    if (priority.len > 0) {
        allocator.free(priority);
        priority = &.{};
    }
    if (played.len > 0) {
        allocator.free(played);
        played = &.{};
    }

    const n: usize = count;
    n_teams = n;
    if (n == 0) return;

    theta_data = allocF64(n);
    tau_data = allocF64(n);
    theta_user = allocF64(n);
    tau_user = allocF64(n);
    fused = allocF64(n);
    wins = allocF64(n);
    nij = allocF64(n * n);
    beta_scratch = allocF64(n);
    next_scratch = allocF64(n);
    groups = allocator.alloc(u8, n) catch unreachable;
    @memset(groups, 0);
    hosts = allocator.alloc(u8, n) catch unreachable;
    @memset(hosts, 0);
    priority = allocator.alloc(bool, n) catch unreachable;
    @memset(priority, false);
    played = allocator.alloc(bool, n) catch unreachable;
    @memset(played, false);
    total_picks = 0;

    // Reset adaptive-pairing state; seed deterministically from the team count.
    recent_count = 0;
    recent_head = 0;
    pair_rng = Rng.init(0x50A17A6 ^ @as(u64, n));
}

/// Write theta_data + tau_data, interleaved as [theta0, tau0, theta1, tau1, ...].
export fn load_data_strengths(ptr: [*]const f64, count: u32) void {
    var i: usize = 0;
    while (i < count and i < n_teams) : (i += 1) {
        theta_data[i] = ptr[2 * i];
        tau_data[i] = ptr[2 * i + 1];
    }

}

// Mark the current strongest TOP_N teams by `src` strength. Recomputed before
// each pairing from the FUSED strengths, so a team the user keeps picking climbs
// into the round-robin tier (and a suppressed favorite drops out of it).
fn computeTopN(src: []const f64) void {
    @memset(priority, false);
    const k_target = @min(@as(usize, TOP_N), n_teams);
    var c: usize = 0;
    while (c < k_target) : (c += 1) {
        var best_i: usize = 0;
        var best_v: f64 = -std.math.inf(f64);
        var found = false;
        var t: usize = 0;
        while (t < n_teams) : (t += 1) {
            if (!priority[t] and (!found or src[t] > best_v)) {
                best_v = src[t];
                best_i = t;
                found = true;
            }
        }
        if (found) priority[best_i] = true;
    }
}

/// Group index (0..11) per team, used by the tournament sim.
export fn load_groups(ptr: [*]const u8, count: u32) void {
    var i: usize = 0;
    while (i < count and i < n_teams) : (i += 1) groups[i] = ptr[i];
}

/// Host flag (1 = host nation) per team, for the home-advantage term.
export fn load_hosts(ptr: [*]const u8, count: u32) void {
    var i: usize = 0;
    while (i < count and i < n_teams) : (i += 1) hosts[i] = ptr[i];
}

/// Calibrated strength->goals link params (from theta_data.json).
export fn set_link(mu: f64, home_adv: f64, scale: f64) void {
    link = .{ .mu = mu, .home_adv = home_adv, .scale = scale };
}

/// Clear all user comparisons (keeps the loaded data prior).
export fn reset_picks() void {
    @memset(wins, 0);
    @memset(nij, 0);
    @memset(tau_user, 0);
    @memset(theta_user, 0);
    total_picks = 0;
}

/// Record one user comparison (winner beat loser).
export fn add_pick(winner: u32, loser: u32) void {
    if (winner >= n_teams or loser >= n_teams or winner == loser) return;
    wins[winner] += 1;
    nij[winner * n_teams + loser] += 1;
    nij[loser * n_teams + winner] += 1;
    total_picks += 1;
}

/// BT-fit the user picks, align the user level to the data prior over the teams
/// the user actually compared, accrue tau_user, then precision-pool into fused.
export fn fit_and_fuse() void {
    if (n_teams == 0) return;

    strength.fit(n_teams, wins, nij, USER_REG, theta_user, beta_scratch, next_scratch, played);

    // The user fit is identified only up to an additive constant (it sums to 0
    // over played teams). Shift it onto the data's level so per-team pooling is
    // comparing like with like: match the mean of the data prior over the same
    // played teams.
    var sum_data: f64 = 0;
    var n_played: f64 = 0;
    var i: usize = 0;
    while (i < n_teams) : (i += 1) {
        if (played[i]) {
            sum_data += theta_data[i];
            n_played += 1;
        }
    }
    if (n_played > 0) {
        const shift = sum_data / n_played;
        i = 0;
        while (i < n_teams) : (i += 1) {
            if (played[i]) theta_user[i] += shift;
        }
    }

    // tau_user weights each comparison by how informative the matchup was at
    // the data prior (the pairing's information curve), not the post-hoc fit.
    strength.computeTau(n_teams, nij, theta_data, tau_user);
    fusion.fuse(n_teams, theta_data, tau_data, theta_user, tau_user, fused);
}

/// Monte Carlo the tournament. use_user=0 runs on the data prior (the baseline
/// bracket), use_user!=0 runs on the fused strengths (the user's bracket). Same
/// seed for both, so the your-vs-data diff is honest. Writes per-team per-round
/// reach probabilities into out_ptr (n_teams * 6: R32/R16/QF/SF/Final/Champion).
export fn simulate(runs: u32, use_user: u32, out_ptr: [*]f64) void {
    if (n_teams == 0 or runs == 0) return;
    const strengths = if (use_user != 0) fused else theta_data;
    const out = out_ptr[0 .. n_teams * tournament.NROUNDS];
    tournament.runMonteCarlo(runs, n_teams, strengths, groups, hosts, link, 0x2026CAFE, out);
}

/// Adaptive next pair to show, as two u32 team indices packed (first << 32 | second).
/// Round-robins the top-N teams (so a user can rank/force any of them) before
/// falling back to information-maximizing pairing over the field.
export fn next_pair() u64 {
    if (n_teams < 2) return 0;

    computeTopN(fused); // the round-robin tier tracks the current fused order
    const pr = pairing.select(n_teams, fused, recent_buf[0..recent_count], total_picks, &pair_rng, priority, nij);
    const a = pr[0];
    const b = pr[1];

    const lo: u32 = @min(a, b);
    const hi: u32 = @max(a, b);
    recent_buf[recent_head] = lo * @as(u32, @intCast(n_teams)) + hi;
    recent_head = (recent_head + 1) % RECENT_CAP;
    if (recent_count < RECENT_CAP) recent_count += 1;

    // Randomize which side each team appears on.
    return if (pair_rng.float() < 0.5)
        (@as(u64, a) << 32) | @as(u64, b)
    else
        (@as(u64, b) << 32) | @as(u64, a);
}

/// Fraction (0..1) of the attainable user signal captured — drives the meter
/// and early-stop. Sum of tau_user over a target; valid after fit_and_fuse.
export fn progress() f64 {
    if (n_teams == 0) return 0;
    var s: f64 = 0;
    for (tau_user) |v| s += v;
    const p = s / TARGET_INFO;
    return if (p > 1.0) 1.0 else p;
}

// Readback pointers (into the exported memory) for tests + downstream sim.
export fn get_fused_ptr() [*]f64 {
    return fused.ptr;
}
export fn get_user_theta_ptr() [*]f64 {
    return theta_user.ptr;
}
export fn get_tau_user_ptr() [*]f64 {
    return tau_user.ptr;
}
export fn get_pick_count() u32 {
    return total_picks;
}
