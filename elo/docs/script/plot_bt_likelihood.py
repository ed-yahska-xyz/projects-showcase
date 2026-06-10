"""Visualize the Bradley-Terry log-likelihood and where the MLE lives.

Key idea: the strengths theta = (b_1, ..., b_n) are what we SOLVE FOR.
The log-likelihood l(theta) is a single number scoring how well a given set
of strengths explains the batch of results. It is a *landscape* over all
possible strength assignments, and that landscape is concave (one hill).
The MLE, theta_hat = argmax l(theta), is the LOCATION of the summit -- those
are the fitted strengths after the batch.

Left panel  : 2 players -> l depends only on the rating gap, a 1-D concave curve.
Right panel : 3 players -> l is a concave surface over the other two strengths
              (one player pinned at 0 as the anchor); contours + the summit.
"""

import numpy as np
import matplotlib.pyplot as plt


def log_sigmoid(x):
    """Numerically stable log(sigmoid(x))."""
    return -np.logaddexp(0.0, -x)


# --------------------------------------------------------------------------
# Left: two players. A beat B in `wins` of `games`. l is a function of the
# single rating gap delta = b_A - b_B, and the summit sits at logit(wins/games).
# --------------------------------------------------------------------------
def plot_two_players(ax):
    wins, games = 7, 10  # A beat B 7 of 10

    delta = np.linspace(-3, 3, 500)
    ll = wins * log_sigmoid(delta) + (games - wins) * log_sigmoid(-delta)

    mle = np.log(wins / (games - wins))  # = logit(wins/games)
    ll_at_mle = wins * np.log(wins / games) + (games - wins) * np.log(
        (games - wins) / games
    )

    ax.plot(delta, ll, color="#ed254e", linewidth=2, label="l(delta)")
    ax.axvline(mle, color="#2a9d8f", linestyle="--", linewidth=1.5,
               label=f"MLE delta_hat = ln(7/3) = {mle:.2f}")
    ax.plot([mle], [ll_at_mle], "o", color="#264653", markersize=8)
    ax.annotate("summit = MLE\n(fitted strength gap)",
                xy=(mle, ll_at_mle), xytext=(mle + 0.4, ll_at_mle - 2.0),
                arrowprops=dict(arrowstyle="->", color="#264653"))

    ax.set_title("2 players: l is a 1-D concave curve\n(A beat B 7 of 10)")
    ax.set_xlabel("rating gap  delta = b_A - b_B")
    ax.set_ylabel("log-likelihood  l(delta)")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="lower center")


# --------------------------------------------------------------------------
# Right: three players. Pin b_1 = 0 (anchor). l is a concave surface over
# (b_2, b_3). We evaluate it on a grid and mark the summit = MLE.
# --------------------------------------------------------------------------
def plot_three_players(ax):
    # Pairwise results: (i, j, wins_of_i, games).  Players indexed 1,2,3.
    results = [
        (1, 2, 6, 10),  # 1 beat 2,  6 of 10
        (1, 3, 8, 10),  # 1 beat 3,  8 of 10
        (2, 3, 7, 10),  # 2 beat 3,  7 of 10
    ]

    b2 = np.linspace(-2.5, 1.5, 300)
    b3 = np.linspace(-4.0, 0.5, 300)
    B2, B3 = np.meshgrid(b2, b3)
    beta = {1: 0.0, 2: B2, 3: B3}  # player 1 pinned at 0

    ll = np.zeros_like(B2)
    for i, j, wins, games in results:
        d = beta[i] - beta[j]
        ll += wins * log_sigmoid(d) + (games - wins) * log_sigmoid(-d)

    # Summit of the grid = MLE estimate.
    k = np.unravel_index(np.argmax(ll), ll.shape)
    b2_hat, b3_hat = B2[k], B3[k]

    cf = ax.contourf(B2, B3, ll, levels=30, cmap="viridis")
    ax.contour(B2, B3, ll, levels=12, colors="white", linewidths=0.4, alpha=0.5)
    ax.plot([b2_hat], [b3_hat], "*", color="#ed254e", markersize=18,
            markeredgecolor="white",
            label=f"MLE: b2={b2_hat:.2f}, b3={b3_hat:.2f}")
    ax.plot([0], [0], "o", color="white", markersize=7,
            label="anchor: b1 = 0")

    ax.set_title("3 players: l is a concave surface\n(summit = MLE strengths)")
    ax.set_xlabel("b_2")
    ax.set_ylabel("b_3")
    ax.legend(loc="lower left")
    plt.colorbar(cf, ax=ax, label="log-likelihood  l")

    print(f"3-player MLE (anchor b1=0):  b2={b2_hat:.3f},  b3={b3_hat:.3f}")
    print(f"  implied ranking: 1 > 2 > 3  (b1=0 > b2 > b3)")


def main():
    fig, (ax_left, ax_right) = plt.subplots(1, 2, figsize=(13, 5.5))
    plot_two_players(ax_left)
    plot_three_players(ax_right)
    fig.suptitle("Bradley-Terry: the concave log-likelihood and its MLE",
                 fontsize=13)
    fig.tight_layout()

    out_path = "bt_likelihood.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
