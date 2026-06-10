"""Plot the Elo expected-score equation centered around a 1500 rating.

The Elo expected score for player A against player B is:

    E_A = 1 / (1 + 10 ** ((R_B - R_A) / 400))

This script fixes player A at 1500 and sweeps player B's rating across a
window around 1500, showing how A's expected score (win probability) changes
with the rating difference.
"""

import numpy as np
import matplotlib.pyplot as plt


CENTER = 1500          # player A's fixed rating
SPREAD = 1200          # how far around the center to sweep player B
SCALE = 400            # Elo logistic scale factor


def expected_score(rating_a, rating_b, scale=SCALE):
    """Expected score of A against B (between 0 and 1)."""
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / scale))


def main():
    opponent = np.linspace(CENTER - SPREAD, CENTER + SPREAD, 400)
    e_a = expected_score(CENTER, opponent)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(opponent, e_a, color="#ed254e", linewidth=2,
            label=f"Player rated {CENTER}")

    # Reference lines at the 50% point (equal ratings).
    ax.axhline(0.5, color="#888", linestyle="--", linewidth=1)
    ax.axvline(CENTER, color="#888", linestyle="--", linewidth=1)

    ax.set_title(f"Elo Expected Score around {CENTER}")
    ax.set_xlabel("Opponent rating")
    ax.set_ylabel("Expected score (win probability)")
    ax.set_ylim(0, 1)
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()

    out_path = "elo_curve.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
