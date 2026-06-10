"""Show that Bradley-Terry on the Elo rating scale *is* the Elo curve.

Elo's expected score for a player rated R_i against an opponent R_j is:

    E = 1 / (1 + 10 ** ((R_j - R_i) / 400))

Bradley-Terry uses positive strengths:  P(i beats j) = p_i / (p_i + p_j).

If we map a rating R onto a strength, there are two equivalent choices that
reproduce Elo exactly:

    base-10 strength :  p   = 10 ** (R / 400)
    natural-log form :  beta = R / S,  with  S = 400 / ln(10) ~= 173.72
                        p   = exp(beta)

With either mapping, p_i / (p_i + p_j) collapses to the Elo expected score.
This script fixes the player at 1500, sweeps the opponent's rating, and
overlays all three so you can see they are the same curve (the right panel
plots the residuals, which are just floating-point noise ~1e-16).
"""

import numpy as np
import matplotlib.pyplot as plt


CENTER = 1500              # player's fixed rating
SPREAD = 1200             # how far around the center to sweep the opponent
ELO_SCALE = 400           # Elo logistic scale
NAT_SCALE = ELO_SCALE / np.log(10.0)   # ~173.72, the natural-log strength scale


def elo_expected(rating, opponent, scale=ELO_SCALE):
    return 1.0 / (1.0 + 10.0 ** ((opponent - rating) / scale))


def bt_base10(rating, opponent):
    """Bradley-Terry using base-10 strengths p = 10 ** (R / 400)."""
    p_i = 10.0 ** (rating / ELO_SCALE)
    p_j = 10.0 ** (opponent / ELO_SCALE)
    return p_i / (p_i + p_j)


def bt_natural(rating, opponent):
    """Bradley-Terry using natural-log strengths p = exp(R / S)."""
    p_i = np.exp(rating / NAT_SCALE)
    p_j = np.exp(opponent / NAT_SCALE)
    return p_i / (p_i + p_j)


def main():
    opponent = np.linspace(CENTER - SPREAD, CENTER + SPREAD, 400)

    elo = elo_expected(CENTER, opponent)
    bt10 = bt_base10(CENTER, opponent)
    btln = bt_natural(CENTER, opponent)

    fig, (ax_curve, ax_resid) = plt.subplots(1, 2, figsize=(13, 5))

    # Left: the three curves overlaid (they coincide).
    ax_curve.plot(opponent, elo, color="#264653", linewidth=6, alpha=0.35,
                  label="Elo expected score")
    ax_curve.plot(opponent, bt10, color="#ed254e", linewidth=2,
                  label="Bradley-Terry  p = 10^(R/400)")
    ax_curve.plot(opponent, btln, color="#2a9d8f", linewidth=2,
                  linestyle="--", label="Bradley-Terry  p = exp(R/173.7)")
    ax_curve.axhline(0.5, color="#888", linestyle="--", linewidth=1)
    ax_curve.axvline(CENTER, color="#888", linestyle=":", linewidth=1)
    ax_curve.set_title(f"Bradley-Terry on the Elo scale (player = {CENTER})")
    ax_curve.set_xlabel("Opponent rating")
    ax_curve.set_ylabel("P(player beats opponent)")
    ax_curve.set_ylim(0, 1)
    ax_curve.grid(True, alpha=0.3)
    ax_curve.legend()

    # Right: residuals vs Elo, to prove the overlap is exact.
    ax_resid.plot(opponent, bt10 - elo, color="#ed254e", linewidth=2,
                  label="base-10 BT  -  Elo")
    ax_resid.plot(opponent, btln - elo, color="#2a9d8f", linewidth=2,
                  linestyle="--", label="natural-log BT  -  Elo")
    ax_resid.axhline(0.0, color="#888", linestyle="--", linewidth=1)
    ax_resid.set_title("Difference from Elo (floating-point noise)")
    ax_resid.set_xlabel("Opponent rating")
    ax_resid.set_ylabel("Bradley-Terry  -  Elo")
    ax_resid.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))
    ax_resid.grid(True, alpha=0.3)
    ax_resid.legend()

    max_diff = float(np.max(np.abs(bt10 - elo)))
    print(f"max |BT(base-10) - Elo| = {max_diff:.2e}")

    fig.tight_layout()
    out_path = "bt_vs_elo.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
