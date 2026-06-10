// fusion.zig — per-team precision-weighted pool of the data prior and the
// user's evidence:
//
//   theta_fused[i] = (tau_data[i]*theta_data[i] + tau_user[i]*theta_user[i])
//                    / (tau_data[i] + tau_user[i])
//
// tau_user[i] is the Fisher information the user accrued on team i (from
// strength.computeTau). Teams the user never compared have tau_user = 0 and
// stay pinned to the data prior. This is the MAP estimate under Gaussian
// priors, so it is concave with a unique optimum — the "earned weight" fusion
// from the docs, not a UI slider.

const std = @import("std");

pub fn fuse(
    n: usize,
    theta_data: []const f64,
    tau_data: []const f64,
    theta_user: []const f64,
    tau_user: []const f64,
    fused: []f64,
) void {
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const td = tau_data[i];
        const tu = tau_user[i];
        const denom = td + tu;
        fused[i] = if (denom > 0)
            (td * theta_data[i] + tu * theta_user[i]) / denom
        else
            theta_data[i];
    }
}

test "fusion pins unplayed teams to prior and blends played" {
    var theta_data = [_]f64{ 0.5, 0.0, -0.5 };
    var tau_data = [_]f64{ 2, 2, 2 };
    var theta_user = [_]f64{ 1.0, -1.0, 0.0 };
    var tau_user = [_]f64{ 1.0, 1.0, 0.0 }; // team 2 unplayed
    var fused = [_]f64{ 0, 0, 0 };
    fuse(3, &theta_data, &tau_data, &theta_user, &tau_user, &fused);

    // team 2: tau_user 0 -> exactly the prior.
    try std.testing.expectApproxEqAbs(@as(f64, -0.5), fused[2], 1e-12);
    // team 0: (2*0.5 + 1*1.0)/3 = 2/3.
    try std.testing.expectApproxEqAbs(@as(f64, 2.0 / 3.0), fused[0], 1e-12);
    // team 1: (2*0.0 + 1*-1.0)/3 = -1/3.
    try std.testing.expectApproxEqAbs(@as(f64, -1.0 / 3.0), fused[1], 1e-12);
}

test "more user information pulls harder toward the user" {
    var theta_data = [_]f64{ 1.0, 0.0 };
    var tau_data = [_]f64{ 1, 1 };
    var theta_user = [_]f64{ 0.0, 0.0 };
    var fused = [_]f64{ 0, 0 };

    var weak = [_]f64{ 0.5, 0.5 };
    fuse(2, &theta_data, &tau_data, &theta_user, &weak, &fused);
    const weak0 = fused[0];

    var strong = [_]f64{ 9.0, 9.0 };
    fuse(2, &theta_data, &tau_data, &theta_user, &strong, &fused);
    const strong0 = fused[0];

    // Both pull team 0 below its prior of 1.0; more info pulls further.
    try std.testing.expect(weak0 < 1.0 and weak0 > strong0);
}
