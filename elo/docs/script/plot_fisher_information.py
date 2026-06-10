"""Decision 3 -- Adaptive pairing: why near-even matchups are the ones to serve.

A single pairwise comparison's Fisher information about the strength gap is
    I = p * (1 - p),   where p = sigma(delta) is the win probability.
This peaks at p = 0.5 (delta = 0) with value 0.25 and vanishes as p -> 0 or 1.

So "Brazil vs minnow" (p ~ 0.99) tells you almost nothing, while a coin-flip
matchup (p ~ 0.5) is maximally informative. Seeding teams at their data ratings
and serving only near-even pairs lets a user's ranking converge in ~25-40
clicks instead of hundreds, because the estimate's variance falls like
1 / (sum of information collected).
"""

import numpy as np
import matplotlib.pyplot as plt


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def plot_info_vs_p(ax):
    p = np.linspace(0.001, 0.999, 400)
    info = p * (1 - p)
    ax.plot(p, info, color="#ed254e", linewidth=2)
    ax.axvline(0.5, color="#2a9d8f", linestyle="--", linewidth=1.5)
    ax.plot([0.5], [0.25], "o", color="#264653", markersize=8)
    ax.annotate("max info at p=0.5\n(coin-flip matchup)",
                xy=(0.5, 0.25), xytext=(0.52, 0.17),
                arrowprops=dict(arrowstyle="->", color="#264653"))
    ax.annotate("p~0.99: ~0 info\n(wasted click)",
                xy=(0.95, 0.0475), xytext=(0.55, 0.05),
                arrowprops=dict(arrowstyle="->", color="#888"))
    ax.set_title("Information per comparison\nI = p (1 - p)")
    ax.set_xlabel("win probability  p  of the matchup shown")
    ax.set_ylabel("Fisher information  I")
    ax.set_ylim(0, 0.28)
    ax.grid(True, alpha=0.3)


def plot_convergence(ax):
    """Estimate-variance vs clicks: near-even picks beat random/lopsided ones."""
    clicks = np.arange(1, 61)
    # Variance ~ 1 / cumulative information. Per-click info:
    info_even = 0.25                       # always serve p~0.5
    info_random = 0.16                     # a random opponent, average info
    info_lopsided = 0.04                   # always show blowouts
    for info, color, label in [
        (info_even, "#ed254e", "adaptive (near-even, I~0.25)"),
        (info_random, "#f4a261", "random opponent (I~0.16)"),
        (info_lopsided, "#888", "lopsided pairs (I~0.04)"),
    ]:
        var = 1.0 / (clicks * info)
        ax.plot(clicks, var, color=color, linewidth=2, label=label)

    ax.axhline(0.05, color="#264653", linestyle=":", linewidth=1,
               label="\"converged\" threshold")
    ax.set_title("Why ~25-40 clicks is enough\n(estimate variance ~ 1 / total info)")
    ax.set_xlabel("number of pairwise picks")
    ax.set_ylabel("variance of the strength estimate")
    ax.set_ylim(0, 1.0)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=8)


def main():
    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 5))
    plot_info_vs_p(axL)
    plot_convergence(axR)
    fig.suptitle("Adaptive pairing: serve the matchups that carry information",
                 fontsize=13)
    fig.tight_layout()

    out_path = "fisher_information.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
