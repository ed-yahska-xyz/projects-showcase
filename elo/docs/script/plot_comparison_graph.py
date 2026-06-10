"""The unifying insight: user picks and real matches are edges in ONE graph.

A user's pick ("Brazil beats Germany") and a real result ("Germany beat
Brazil 2-1") are the same kind of observation -- a directed pairwise
comparison. So they live in a single comparison graph over the same teams,
just with two kinds of edges. The Bradley-Terry strength model is fit on the
whole graph; a weight controls how much each edge type counts.
"""

import numpy as np
import matplotlib.pyplot as plt


TEAMS = ["Brazil", "France", "Germany", "Argentina", "Spain", "England"]

# Directed edges: (winner, loser). Real results observed by the backend.
REAL_MATCHES = [
    ("Germany", "Brazil"),
    ("France", "England"),
    ("Argentina", "Spain"),
    ("Brazil", "Argentina"),
    ("Spain", "England"),
    ("France", "Germany"),
]

# Directed edges: (winner, loser). This user's subjective picks.
USER_PICKS = [
    ("Brazil", "Germany"),   # disagrees with the real result!
    ("Brazil", "France"),
    ("Argentina", "Spain"),
    ("England", "Germany"),
]


def node_positions():
    """Lay the teams out on a circle."""
    n = len(TEAMS)
    angles = np.linspace(np.pi / 2, np.pi / 2 + 2 * np.pi, n, endpoint=False)
    return {t: (np.cos(a), np.sin(a)) for t, a in zip(TEAMS, angles)}


def draw_edge(ax, pos, src, dst, color, style, rad):
    """Draw a curved arrow from src node toward dst node."""
    x0, y0 = pos[src]
    x1, y1 = pos[dst]
    ax.annotate(
        "",
        xy=(x1 * 0.82, y1 * 0.82),
        xytext=(x0 * 0.82, y0 * 0.82),
        arrowprops=dict(arrowstyle="-|>", color=color, linestyle=style,
                        linewidth=2, alpha=0.8,
                        connectionstyle=f"arc3,rad={rad}"),
    )


def main():
    pos = node_positions()
    fig, ax = plt.subplots(figsize=(8, 8))

    for src, dst in REAL_MATCHES:
        draw_edge(ax, pos, src, dst, "#264653", "solid", 0.18)
    for src, dst in USER_PICKS:
        draw_edge(ax, pos, src, dst, "#ed254e", "dashed", -0.30)

    for team, (x, y) in pos.items():
        ax.scatter([x], [y], s=2600, color="#2a9d8f", zorder=3,
                   edgecolors="white", linewidths=2)
        ax.text(x, y, team, ha="center", va="center", color="white",
                fontsize=10, fontweight="bold", zorder=4)

    # Legend via proxy handles.
    real_proxy = plt.Line2D([], [], color="#264653", linewidth=2,
                            label="real match  (winner -> loser)")
    user_proxy = plt.Line2D([], [], color="#ed254e", linewidth=2,
                            linestyle="--", label="user pick  (winner -> loser)")
    ax.legend(handles=[real_proxy, user_proxy], loc="upper center",
              bbox_to_anchor=(0.5, 0.04), ncol=2, frameon=False)

    ax.set_title("One comparison graph, two streams of edges\n"
                 "(both feed the same Bradley-Terry strengths)", fontsize=13)
    ax.set_xlim(-1.4, 1.4)
    ax.set_ylim(-1.4, 1.4)
    ax.set_aspect("equal")
    ax.axis("off")

    out_path = "comparison_graph.png"
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
