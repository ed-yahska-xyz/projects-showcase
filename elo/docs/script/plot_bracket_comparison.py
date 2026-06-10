"""Decision 4 -- The payoff: your bracket vs. the data's bracket.

Once every fixture has win probabilities (from the shared strengths), a knockout
bracket's outcome distribution is computable exactly. Here we run the SAME 16-team
single-elimination bracket twice:
  - with the data-driven strengths  (theta_data)
  - with the user-tilted strengths  (theta_final after fusion)
and compare each team's championship odds. The differentiated feature -- "the
model gives France 14%, your ranking pushes them to 22%" -- falls straight out.

Win probability of i over j is the Bradley-Terry sigmoid of the strength gap.
Championship odds are computed exactly by a round-by-round bracket DP (no
Monte Carlo needed for a fixed seeding).
"""

import numpy as np
import matplotlib.pyplot as plt


# 16 teams seeded into bracket order (1 plays 16-equivalent neighbor, etc.).
TEAMS = ["Brazil", "France", "Argentina", "England", "Spain", "Germany",
         "Portugal", "Netherlands", "Belgium", "Croatia", "Uruguay", "Morocco",
         "USA", "Mexico", "Japan", "Senegal"]

# Data-driven log-strengths (descending-ish, arbitrary scale).
THETA_DATA = np.array([1.30, 1.25, 1.15, 1.05, 1.02, 1.10, 0.95, 0.92,
                       0.88, 0.80, 0.78, 0.70, 0.85, 0.65, 0.60, 0.58])

# User tilt: Brazil superfan, also bullish on USA, sours on Germany/France.
TILT = np.array([0.55, -0.25, 0.05, 0.0, 0.0, -0.40, 0.0, 0.0,
                 0.0, 0.0, 0.0, 0.10, 0.45, 0.0, 0.0, 0.0])
W_FUSION = 0.5  # slider position
THETA_USER_RAW = THETA_DATA + TILT
THETA_FINAL = (1 - W_FUSION) * THETA_DATA + W_FUSION * THETA_USER_RAW

ROUND_NAMES = ["R16", "QF", "SF", "Final", "Champion"]


def p_beat(theta, i, j):
    return 1.0 / (1.0 + np.exp(-(theta[i] - theta[j])))


def reach_probabilities(theta):
    """Exact per-round reach probabilities for a fixed seeded bracket.

    Returns array reach[team, round] where round 0 = reached R16 (=1.0),
    and the last column = champion probability.
    """
    n = len(theta)
    n_rounds = int(np.log2(n))
    reach = np.ones(n)
    snapshots = [reach.copy()]  # reached R16

    for k in range(n_rounds):
        half = 1 << k
        block = 1 << (k + 1)
        new = np.zeros(n)
        for i in range(n):
            start = (i // block) * block
            if (i - start) < half:
                opps = range(start + half, start + block)
            else:
                opps = range(start, start + half)
            s = sum(reach[j] * p_beat(theta, i, j) for j in opps)
            new[i] = reach[i] * s
        reach = new
        snapshots.append(reach.copy())  # reached next round (won this one)

    return np.array(snapshots).T  # [team, round]


def plot_champion_bars(ax, champ_data, champ_user):
    order = np.argsort(champ_data)[::-1]
    y = np.arange(len(TEAMS))
    names = [TEAMS[i] for i in order]
    cd = champ_data[order]
    cu = champ_user[order]

    h = 0.4
    ax.barh(y + h / 2, cd, height=h, color="#264653", label="data's bracket")
    ax.barh(y - h / 2, cu, height=h, color="#ed254e", label="your bracket")
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("championship probability")
    ax.set_title("Your bracket vs. the data's bracket")
    ax.grid(True, axis="x", alpha=0.3)
    ax.legend()
    for yi, (a, b) in enumerate(zip(cd, cu)):
        if abs(b - a) > 0.02:
            ax.annotate(f"{a:.0%}->{b:.0%}", xy=(max(a, b), yi),
                        xytext=(max(a, b) + 0.01, yi), va="center", fontsize=8,
                        color="#ed254e")


def plot_team_path(ax, reach_data, reach_user, team):
    idx = TEAMS.index(team)
    x = np.arange(len(ROUND_NAMES))
    ax.plot(x, reach_data[idx], "o-", color="#264653", linewidth=2,
            label="data's bracket")
    ax.plot(x, reach_user[idx], "o-", color="#ed254e", linewidth=2,
            label="your bracket")
    ax.set_xticks(x)
    ax.set_xticklabels(ROUND_NAMES)
    ax.set_ylim(0, 1)
    ax.set_ylabel("probability of reaching round")
    ax.set_title(f"{team}: how your picks move each round")
    ax.grid(True, alpha=0.3)
    ax.legend()


def main():
    reach_data = reach_probabilities(THETA_DATA)
    reach_user = reach_probabilities(THETA_FINAL)
    champ_data = reach_data[:, -1]
    champ_user = reach_user[:, -1]

    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 6))
    plot_champion_bars(axL, champ_data, champ_user)
    plot_team_path(axR, reach_data, reach_user, "Brazil")
    fig.suptitle("Monte-Carlo payoff: contrast the user's bracket with the data's",
                 fontsize=13)
    fig.tight_layout()

    print("championship odds (data -> your bracket):")
    for i in np.argsort(champ_data)[::-1]:
        print(f"  {TEAMS[i]:<12} {champ_data[i]:5.1%} -> {champ_user[i]:5.1%}")
    print(f"data champ mass={champ_data.sum():.4f}, "
          f"user champ mass={champ_user.sum():.4f}")

    out_path = "bracket_comparison.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
