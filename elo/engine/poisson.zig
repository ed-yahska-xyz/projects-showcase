// poisson.zig — v1 single-index "supremacy" link from fused strengths to
// expected goals, then a sampled scoreline. The link matches the offline
// calibration in source-data/fit_bt.py exactly:
//
//   lambda_home = exp(mu + home_adv*H + scale*(theta_home - theta_away))
//   lambda_away = exp(mu              - scale*(theta_home - theta_away))
//
// H = 1 when the home side has home advantage (a host nation playing), else 0.
// mu, home_adv, scale are calibrated offline and shipped in theta_data.json.

const std = @import("std");
const Rng = @import("rng.zig").Rng;

pub const Link = struct {
    mu: f64 = 0,
    home_adv: f64 = 0,
    scale: f64 = 0,
};

pub fn lambdas(theta_home: f64, theta_away: f64, home: f64, link: Link) [2]f64 {
    const dth = theta_home - theta_away;
    const lh = @exp(link.mu + link.home_adv * home + link.scale * dth);
    const la = @exp(link.mu - link.scale * dth);
    return .{ lh, la };
}

/// Sample a scoreline (home goals, away goals).
pub fn sampleScore(r: *Rng, theta_home: f64, theta_away: f64, home: f64, link: Link) [2]u32 {
    const lam = lambdas(theta_home, theta_away, home, link);
    return .{ r.poisson(lam[0]), r.poisson(lam[1]) };
}

test "stronger team has the higher expected goals; home adds to home side" {
    const link = Link{ .mu = 0.0907, .home_adv = 0.2072, .scale = 0.4282 };
    const neutral = lambdas(1.5, 0.0, 0.0, link);
    try std.testing.expect(neutral[0] > neutral[1]); // stronger scores more
    const withHome = lambdas(1.5, 0.0, 1.0, link);
    try std.testing.expect(withHome[0] > neutral[0]); // home boosts the home side
    try std.testing.expectApproxEqAbs(neutral[1], withHome[1], 1e-12); // away unchanged
}
