"""Plot how a 1500-rated player's Elo changes after a win or a loss.

The Elo update rule is:

    R' = R + K * (S - E)

where S is the actual result (1 for a win, 0 for a loss) and E is the
expected score against the opponent:

    E = 1 / (1 + 10 ** ((R_opponent - R) / 400))

This script fixes the player at 1500 and sweeps the opponent's rating,
plotting the player's new rating after a win and after a loss. The gap
between the two curves is the K-factor (the maximum possible swing).
"""

import numpy as np
import matplotlib.pyplot as plt


CENTER = 1500          # player's fixed starting rating
SPREAD = 1200          # how far around the center to sweep the opponent
SCALE = 400            # Elo logistic scale factor
K = 32                 # K-factor (max rating change per game)


def expected_score(rating, opponent, scale=SCALE):
    """Expected score of the player against the opponent (between 0 and 1)."""
    return 1.0 / (1.0 + 10.0 ** ((opponent - rating) / scale))


def main():
    opponent = np.linspace(CENTER - SPREAD, CENTER + SPREAD, 400)
    e = expected_score(CENTER, opponent)

    rating_win = CENTER + K * (1.0 - e)
    rating_loss = CENTER + K * (0.0 - e)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(opponent, rating_win, color="#2a9d8f", linewidth=2,
            label="After a win")
    ax.plot(opponent, rating_loss, color="#ed254e", linewidth=2,
            label="After a loss")

    # Reference line at the starting rating.
    ax.axhline(CENTER, color="#888", linestyle="--", linewidth=1,
               label=f"Starting rating ({CENTER})")
    ax.axvline(CENTER, color="#888", linestyle=":", linewidth=1)

    ax.set_title(f"Elo Rating Update for a {CENTER} Player (K={K})")
    ax.set_xlabel("Opponent rating")
    ax.set_ylabel("New rating")
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()

    out_path = "elo_update.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
