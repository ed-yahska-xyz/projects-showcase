// strength.zig — Bradley-Terry log-strengths fit from aggregate pairwise data
// via the MM / Zermelo update:
//
//     beta_i  <-  W_i / Σ_{j≠i}  n_ij / (beta_i + beta_j)
//
// W_i = total wins of i; n_ij = number of times i and j met (symmetric). The
// likelihood is concave so this converges to the unique optimum regardless of
// init. Each iteration we renormalize the played teams' betas to geometric
// mean 1, which keeps the fit bounded and lands theta = ln(beta) already
// recentered (Σ theta = 0 over the teams that actually played). Teams with no
// comparisons are left at 0 and flagged unplayed (the fusion layer pins them to
// the data prior). This same code, compiled native, fits the data strengths
// offline (Phase 1 builder).

const std = @import("std");

pub fn sigmoid(x: f64) f64 {
    return 1.0 / (1.0 + @exp(-x));
}

// reg > 0 adds a virtual match + half-win against a neutral reference (beta=1),
// shrinking strengths toward the mean. This is what keeps a sparse fit bounded:
// a team that wins all its few comparisons no longer fits to an extreme. Same
// device as the offline builder (fit_bt.py REG). reg = 0 is the pure MLE.
pub fn fit(
    n: usize,
    wins: []const f64,
    nij: []const f64,
    reg: f64,
    theta: []f64, // out: log-strengths
    beta: []f64, // scratch (>= n)
    next: []f64, // scratch (>= n)
    played: []bool, // out: which teams had any comparison
) void {
    const MAX_ITER: usize = 200;
    const TOL: f64 = 1e-12;
    const BMIN: f64 = 1e-6;
    const BMAX: f64 = 1e6;

    var num_played: usize = 0;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        var games: f64 = 0;
        var j: usize = 0;
        while (j < n) : (j += 1) games += nij[i * n + j];
        played[i] = games > 0;
        if (played[i]) num_played += 1;
        beta[i] = 1.0;
        theta[i] = 0.0;
    }
    if (num_played == 0) return;

    var iter: usize = 0;
    while (iter < MAX_ITER) : (iter += 1) {
        // MM update for each played team.
        i = 0;
        while (i < n) : (i += 1) {
            if (!played[i]) {
                next[i] = beta[i];
                continue;
            }
            var denom: f64 = reg / (beta[i] + 1.0); // virtual match vs reference
            var j: usize = 0;
            while (j < n) : (j += 1) {
                if (j == i) continue;
                const m = nij[i * n + j];
                if (m == 0) continue;
                denom += m / (beta[i] + beta[j]);
            }
            const eff_wins = wins[i] + 0.5 * reg; // virtual half-win
            var nb = if (denom > 0) eff_wins / denom else beta[i];
            if (nb < BMIN) nb = BMIN;
            if (nb > BMAX) nb = BMAX;
            next[i] = nb;
        }

        // Renormalize played betas to geometric mean 1.
        var log_sum: f64 = 0;
        i = 0;
        while (i < n) : (i += 1) {
            if (played[i]) log_sum += @log(next[i]);
        }
        const gmean = @exp(log_sum / @as(f64, @floatFromInt(num_played)));

        var max_change: f64 = 0;
        i = 0;
        while (i < n) : (i += 1) {
            if (!played[i]) continue;
            const nb = next[i] / gmean;
            const change = @abs(nb - beta[i]) / beta[i];
            if (change > max_change) max_change = change;
            beta[i] = nb;
        }
        if (max_change < TOL) break;
    }

    i = 0;
    while (i < n) : (i += 1) {
        theta[i] = if (played[i]) @log(beta[i]) else 0.0;
    }
}

// tau_user[i] = Σ_j n_ij * p_ij*(1-p_ij), the Fisher information the user
// accrued on team i. p_ij is evaluated at the supplied REFERENCE strengths —
// the data prior, i.e. the same information curve the adaptive pairing
// maximizes — not the post-hoc user fit. This is a deliberate v1 choice:
//  - it weights each comparison by how informative the matchup was a priori
//    (near-even picks earn full weight, blowouts earn little — "earned weight"),
//  - and it avoids the degeneracy where an all-wins sweep fits to an extreme
//    strength where p(1-p)->0 and the evidence would vanish.
// For the near-even matchups the pairing actually serves, this equals the
// fitted-p value anyway; they only diverge on lopsided inputs.
pub fn computeTau(n: usize, nij: []const f64, theta: []const f64, tau: []f64) void {
    var i: usize = 0;
    while (i < n) : (i += 1) {
        var s: f64 = 0;
        var j: usize = 0;
        while (j < n) : (j += 1) {
            if (j == i) continue;
            const m = nij[i * n + j];
            if (m == 0) continue;
            const p = sigmoid(theta[i] - theta[j]);
            s += m * p * (1.0 - p);
        }
        tau[i] = s;
    }
}

test "two-team fit recovers logit of the win ratio" {
    // A beats B 7 of 10  ->  theta_A - theta_B = ln(7/3), recentered to +-half.
    var wins = [_]f64{ 7, 3 };
    var nij = [_]f64{ 0, 10, 10, 0 };
    var theta = [_]f64{ 0, 0 };
    var beta = [_]f64{ 0, 0 };
    var next = [_]f64{ 0, 0 };
    var played = [_]bool{ false, false };
    fit(2, &wins, &nij, 0.0, &theta, &beta, &next, &played);
    try std.testing.expectApproxEqAbs(@log(7.0 / 3.0), theta[0] - theta[1], 1e-7);
    try std.testing.expectApproxEqAbs(@as(f64, 0), theta[0] + theta[1], 1e-9);
}

test "three-team fit matches known MLE differences" {
    // 0>1 6/10, 0>2 8/10, 1>2 7/10. Known MLE (anchor b0=0): b1=-0.44, b2=-1.336.
    var wins = [_]f64{ 14, 11, 5 };
    var nij = [_]f64{ 0, 10, 10, 10, 0, 10, 10, 10, 0 };
    var theta = [_]f64{ 0, 0, 0 };
    var beta = [_]f64{ 0, 0, 0 };
    var next = [_]f64{ 0, 0, 0 };
    var played = [_]bool{ false, false, false };
    fit(3, &wins, &nij, 0.0, &theta, &beta, &next, &played);
    try std.testing.expectApproxEqAbs(@as(f64, 0.44), theta[0] - theta[1], 0.02);
    try std.testing.expectApproxEqAbs(@as(f64, 1.336), theta[0] - theta[2], 0.02);
    try std.testing.expectApproxEqAbs(@as(f64, 0), theta[0] + theta[1] + theta[2], 1e-9);
}

test "unplayed team stays at zero and flagged" {
    var wins = [_]f64{ 1, 0, 0 };
    var nij = [_]f64{ 0, 2, 0, 2, 0, 0, 0, 0, 0 }; // only 0 and 1 meet
    var theta = [_]f64{ 9, 9, 9 };
    var beta = [_]f64{ 0, 0, 0 };
    var next = [_]f64{ 0, 0, 0 };
    var played = [_]bool{ false, false, false };
    fit(3, &wins, &nij, 0.0, &theta, &beta, &next, &played);
    try std.testing.expect(!played[2]);
    try std.testing.expectEqual(@as(f64, 0), theta[2]);
    try std.testing.expect(theta[0] > theta[1]); // 0 beat 1 both times
}

test "regularization shrinks a sparse all-wins fit toward the mean" {
    // A swept B 3-0. Unregularized the gap is ln(3/0)->extreme (clamped); reg
    // pulls it to a finite, modest value — still positive, still A>B.
    var wins = [_]f64{ 3, 0 };
    var nij = [_]f64{ 0, 3, 3, 0 };
    var theta = [_]f64{ 0, 0 };
    var beta = [_]f64{ 0, 0 };
    var next = [_]f64{ 0, 0 };
    var played = [_]bool{ false, false };

    fit(2, &wins, &nij, 0.0, &theta, &beta, &next, &played);
    const unreg = theta[0] - theta[1];
    fit(2, &wins, &nij, 1.0, &theta, &beta, &next, &played);
    const reg = theta[0] - theta[1];

    try std.testing.expect(reg > 0); // direction preserved: A stronger
    try std.testing.expect(reg < unreg); // but shrunk vs the unregularized fit
    try std.testing.expect(reg < 3.0); // and bounded to a sane magnitude
}
