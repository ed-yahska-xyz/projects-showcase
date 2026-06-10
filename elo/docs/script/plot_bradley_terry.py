"""Visualize the Bradley-Terry model in two parameterizations.

The Bradley-Terry model gives the probability that item i beats item j as a
function of positive "strength" parameters p_i, p_j:

    P(i beats j) = p_i / (p_i + p_j)

If the strengths are written as exponentials of a real-valued parameter,
p = exp(beta), the same model becomes a logistic function of the difference
of the *log strengths* (beta):

    P(i beats j) = exp(b_i) / (exp(b_i) + exp(b_j))
                 = 1 / (1 + exp(-(b_i - b_j)))
                 = sigmoid(b_i - b_j)

Left panel:  original model on the raw strength axis (a few reference players).
Right panel: the log-strength form, a single symmetric sigmoid of the gap.
This log form is exactly the shape behind Elo expected scores.
"""

import numpy as np
import matplotlib.pyplot as plt


def bt_prob(p_i, p_j):
    """Original Bradley-Terry win probability of i over j."""
    return p_i / (p_i + p_j)


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def plot_original(ax):
    """P(i beats j) vs opponent strength, for a few reference strengths."""
    opponent = np.linspace(0.01, 5.0, 400)
    for p_i, color in [(0.5, "#2a9d8f"), (1.0, "#ed254e"), (2.0, "#264653")]:
        ax.plot(opponent, bt_prob(p_i, opponent), color=color, linewidth=2,
                label=f"player strength = {p_i}")

    ax.axhline(0.5, color="#888", linestyle="--", linewidth=1)
    ax.set_title("Original Bradley-Terry\nP(win) = p_i / (p_i + p_j)")
    ax.set_xlabel("Opponent strength  p_j")
    ax.set_ylabel("P(player beats opponent)")
    ax.set_ylim(0, 1)
    ax.grid(True, alpha=0.3)
    ax.legend()


def plot_log_strength(ax):
    """P(i beats j) vs the difference of log strengths (a symmetric sigmoid)."""
    delta = np.linspace(-6, 6, 400)  # b_i - b_j
    ax.plot(delta, sigmoid(delta), color="#ed254e", linewidth=2)

    ax.axhline(0.5, color="#888", linestyle="--", linewidth=1)
    ax.axvline(0.0, color="#888", linestyle="--", linewidth=1)
    ax.set_title("Log-strength form\nP(win) = sigmoid(b_i - b_j)")
    ax.set_xlabel("Log-strength difference  b_i - b_j  =  ln(p_i / p_j)")
    ax.set_ylabel("P(player beats opponent)")
    ax.set_ylim(0, 1)
    ax.grid(True, alpha=0.3)


def main():
    fig, (ax_left, ax_right) = plt.subplots(1, 2, figsize=(13, 5))
    plot_original(ax_left)
    plot_log_strength(ax_right)
    fig.suptitle("Bradley-Terry Model: raw strength vs. log strength",
                 fontsize=13)
    fig.tight_layout()

    out_path = "bradley_terry.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
