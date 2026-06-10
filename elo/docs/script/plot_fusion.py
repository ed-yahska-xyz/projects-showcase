"""Decision 1 -- Fusion: blending subjective and objective strengths.

Pragmatic view (left): a linear blend in log-strength space,
    theta_final = (1 - w) * theta_data + w * theta_user,
with w a "trust the data <-> trust your gut" slider. As w slides from 0 to 1
the team ratings move from the data's opinion to the user's, and the ranking
can reorder.

Bayesian view (right): w is not hand-set but EARNED. Treat the data ratings as
a Gaussian prior and each user pick as evidence. The MAP estimate is a
precision-weighted blend, so the user's weight grows with the number of picks:
    w(n) = n * i_pick / (n * i_pick + P_data).
Few picks -> the data prior dominates (good cold-start); many picks -> the
user earns real influence. This is the K-decay / Glicko idea relabeled.
"""

import numpy as np
import matplotlib.pyplot as plt


# A handful of teams, ratings in log-strength units (arbitrary scale).
TEAMS = ["Brazil", "France", "Germany", "Argentina", "Spain", "England"]
THETA_DATA = np.array([1.00, 1.20, 0.90, 0.95, 0.60, 0.70])
# This user is a Brazil superfan and underrates Germany.
THETA_USER = np.array([1.70, 0.95, 0.40, 1.05, 0.75, 0.65])
COLORS = ["#ed254e", "#2a9d8f", "#264653", "#f4a261", "#e9c46a", "#4361ee"]


def plot_linear_blend(ax):
    w = np.linspace(0, 1, 200)
    for i, team in enumerate(TEAMS):
        theta = (1 - w) * THETA_DATA[i] + w * THETA_USER[i]
        ax.plot(w, theta, color=COLORS[i], linewidth=2, label=team)

    ax.axvline(0.0, color="#888", linestyle=":", linewidth=1)
    ax.axvline(1.0, color="#888", linestyle=":", linewidth=1)
    ax.set_title("Linear blend (the slider)\n"
                 "theta_final = (1-w)*theta_data + w*theta_user")
    ax.set_xlabel("w   (0 = trust data,  1 = trust gut)")
    ax.set_ylabel("blended log-strength")
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=8, ncol=2, loc="upper left")


def plot_bayesian_weight(ax):
    # Each near-even pick carries Fisher info ~0.25; pick P_data so w=0.5 at
    # ~40 picks (matches the "40 well-chosen picks" intuition): w = n/(n+40).
    n = np.linspace(0, 150, 300)
    w = n / (n + 40.0)
    ax.plot(n, w, color="#ed254e", linewidth=2)

    for picks, label in [(5, "cold start\n~5 picks"), (40, "earns half\n40 picks")]:
        wv = picks / (picks + 40.0)
        ax.plot([picks], [wv], "o", color="#264653", markersize=8, zorder=3)
        ax.annotate(f"{label}\nw={wv:.2f}", xy=(picks, wv),
                    xytext=(picks + 10, wv - 0.18),
                    arrowprops=dict(arrowstyle="->", color="#264653"),
                    fontsize=9)

    ax.axhline(0.5, color="#888", linestyle="--", linewidth=1)
    ax.set_title("Bayesian weight is earned, not set\n"
                 "w(n) = n / (n + 40)  (precision-weighted)")
    ax.set_xlabel("number of user picks  n")
    ax.set_ylabel("weight on the user  w")
    ax.set_ylim(0, 1)
    ax.grid(True, alpha=0.3)


def main():
    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 5.5))
    plot_linear_blend(axL)
    plot_bayesian_weight(axR)
    fig.suptitle("Fusion: how subjective picks and objective data combine",
                 fontsize=13)
    fig.tight_layout()

    out_path = "fusion.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
