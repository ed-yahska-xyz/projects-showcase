"""Decision 2 -- Outcome model: why the format forces a Poisson goals model.

Group ties break on goal difference, then goals scored. A pure win-probability
model can't produce those. A Poisson goals model can: map the strength gap to
each side's expected goals (lambda), draw each score from a Poisson, and read
off the FULL scoreline distribution -- W/D/L *and* goal difference *and* goals
scored, every tiebreaker the 2026 format needs.

Link used here (illustrative):
    lambda_A = mu * exp(+c * gap + h)      # h = home advantage
    lambda_B = mu * exp(-c * gap)
where gap = theta_A - theta_B is the shared Bradley-Terry strength difference.

Left  : the joint scoreline matrix P(a, b) for one fixture, with W/D/L regions.
Right : how W / D / L probabilities shift as the strength gap changes.
"""

import numpy as np
import matplotlib.pyplot as plt
from math import factorial


MU = 1.30      # baseline expected goals per side
C = 0.55       # how strongly the strength gap maps to goals
H = 0.25       # home-advantage bump (additive in log-rate)
MAX_GOALS = 7


def poisson_pmf(k, lam):
    return np.exp(-lam) * lam ** k / factorial(k)


def lambdas(gap, home=True):
    h = H if home else 0.0
    lam_a = MU * np.exp(C * gap + h)
    lam_b = MU * np.exp(-C * gap)
    return lam_a, lam_b


def scoreline_matrix(lam_a, lam_b):
    ks = np.arange(MAX_GOALS + 1)
    pa = np.array([poisson_pmf(k, lam_a) for k in ks])
    pb = np.array([poisson_pmf(k, lam_b) for k in ks])
    return np.outer(pa, pb)  # M[a, b] = P(A scores a, B scores b)


def outcome_probs(M):
    a = np.arange(M.shape[0])[:, None]
    b = np.arange(M.shape[1])[None, :]
    win = M[a > b].sum()
    draw = M[a == b].sum()
    loss = M[a < b].sum()
    return win, draw, loss


def plot_matrix(ax, fig):
    gap = 0.6  # A is the stronger side
    lam_a, lam_b = lambdas(gap, home=True)
    M = scoreline_matrix(lam_a, lam_b)
    win, draw, loss = outcome_probs(M)
    exp_gd = lam_a - lam_b

    im = ax.imshow(M.T, origin="lower", cmap="viridis", aspect="equal")
    # Diagonal = draws.
    ax.plot([-0.5, MAX_GOALS + 0.5], [-0.5, MAX_GOALS + 0.5],
            color="white", linewidth=1.2, linestyle="--", alpha=0.8)
    ax.set_title(
        f"Scoreline distribution for one fixture\n"
        f"lambda_A={lam_a:.2f}, lambda_B={lam_b:.2f}  ->  "
        f"W {win:.0%} / D {draw:.0%} / L {loss:.0%},  E[GD]={exp_gd:+.2f}"
    )
    ax.set_xlabel("goals by A (stronger, home)")
    ax.set_ylabel("goals by B")
    ax.set_xticks(range(MAX_GOALS + 1))
    ax.set_yticks(range(MAX_GOALS + 1))
    fig.colorbar(im, ax=ax, label="P(scoreline)", fraction=0.046, pad=0.04)
    print(f"matrix fixture: W={win:.3f} D={draw:.3f} L={loss:.3f} "
          f"E[GD]={exp_gd:+.3f} (mass={M.sum():.4f})")


def plot_wdl_vs_gap(ax):
    gaps = np.linspace(-2.0, 2.0, 200)
    wins, draws, losses = [], [], []
    for g in gaps:
        la, lb = lambdas(g, home=False)  # neutral venue for symmetry
        M = scoreline_matrix(la, lb)
        w, d, l = outcome_probs(M)
        wins.append(w); draws.append(d); losses.append(l)

    ax.plot(gaps, wins, color="#2a9d8f", linewidth=2, label="P(A wins)")
    ax.plot(gaps, draws, color="#f4a261", linewidth=2, label="P(draw)")
    ax.plot(gaps, losses, color="#ed254e", linewidth=2, label="P(B wins)")
    ax.axvline(0.0, color="#888", linestyle=":", linewidth=1)
    ax.set_title("W / D / L from the same goals model\n(neutral venue)")
    ax.set_xlabel("strength gap  theta_A - theta_B")
    ax.set_ylabel("probability")
    ax.set_ylim(0, 1)
    ax.grid(True, alpha=0.3)
    ax.legend()


def main():
    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 5.5))
    plot_matrix(axL, fig)
    plot_wdl_vs_gap(axR)
    fig.suptitle("Poisson goals model: scorelines give you the tiebreakers",
                 fontsize=13)
    fig.tight_layout()

    out_path = "poisson_scorelines.png"
    fig.savefig(out_path, dpi=150)
    print(f"Saved plot to {out_path}")
    plt.show()


if __name__ == "__main__":
    main()
