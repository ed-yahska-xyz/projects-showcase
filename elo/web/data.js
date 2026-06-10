// data.js — load the 48-team field (teams.json) and the precomputed
// Bradley-Terry data prior (theta_data.json), join them by name, and build
// theta[]/tau[] in teams.json index order (the engine works in indices).
//
// The two files share the dataset's source names, so the join is EXACT — no
// aliasing. If any tournament team has no fitted strength we THROW: a silent
// fallback would ship a real team at average strength, the most likely silent
// break in production (see source-data/world-elo/data-setup-prompt.md). test/data-join
// is the CI check that fails on any unmatched team.
//
// theta_data.json is the source of truth for strengths — we never re-derive
// them in JS. Regenerate it offline via source-data/world-elo/fit_bt.py with a later
// ref_date as group results land (the Phase 6 live-update hook).

const ELO_SCALE = 400;
export const ROUNDS = ["R32", "R16", "QF", "SF", "Final", "Champion"];
// 2026 host nations get the home-advantage term in the goals model.
const HOSTS = new Set(["United States", "Mexico", "Canada"]);

// Familiar Elo-style number, for display only. theta is the real currency;
// this is just a friendlier label on the card (theta = rating*ln10/400).
function thetaToDisplayRating(theta) {
  return Math.round(1500 + (theta * ELO_SCALE) / Math.LN10);
}

export async function loadData(base = "../assets") {
  const [teamsDoc, fit, flagDoc] = await Promise.all([
    fetch(`${base}/teams.json`).then((r) => {
      if (!r.ok) throw new Error(`teams.json ${r.status}`);
      return r.json();
    }),
    fetch(`${base}/theta_data.json`).then((r) => {
      if (!r.ok) throw new Error(`theta_data.json ${r.status}`);
      return r.json();
    }),
    fetch(`${base}/flags/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`flags/manifest.json ${r.status}`);
      return r.json();
    }),
  ]);

  const teams = teamsDoc.teams.slice().sort((a, b) => a.id - b.id);
  const byName = new Map(fit.teams.map((t) => [t.name, t]));
  const flagByName = new Map(flagDoc.flags.map((f) => [f.name, f]));

  const priorTheta = new Float64Array(teams.length);
  const priorTau = new Float64Array(teams.length);
  const missing = [];
  const missingFlags = [];
  teams.forEach((team, i) => {
    const hit = byName.get(team.name);
    if (!hit) {
      missing.push(team.name);
    } else {
      priorTheta[i] = hit.theta;
      priorTau[i] = hit.tau;
    }
    const fl = flagByName.get(team.name);
    if (!fl) {
      missingFlags.push(team.name);
    } else {
      team.code = fl.code;
      team.flag = `${base}/flags/${fl.flag_4x3}`; // rectangular
      team.flagSquare = `${base}/flags/${fl.flag_1x1}`; // square (compact rows)
    }
  });
  if (missing.length) {
    throw new Error(
      `No fitted strength for ${missing.length} team(s): ${missing.join(", ")}. ` +
        `teams.json and theta_data.json must share source names (exact join).`,
    );
  }
  if (missingFlags.length) {
    throw new Error(`No flag for ${missingFlags.length} team(s): ${missingFlags.join(", ")}. Check flags/manifest.json.`);
  }

  // Display-only decoration derived from the prior: a familiar rating, a world
  // rank within the field, and a 0..1 strength fraction for the card bar.
  const thetas = Array.from(priorTheta);
  const min = Math.min(...thetas);
  const max = Math.max(...thetas);
  const rankById = new Map(
    teams
      .slice()
      .sort((a, b) => priorTheta[b.id] - priorTheta[a.id])
      .map((t, i) => [t.id, i + 1]),
  );
  for (const t of teams) {
    t.theta = priorTheta[t.id];
    t.tau = priorTau[t.id];
    t.rating = thetaToDisplayRating(t.theta);
    t.rank = rankById.get(t.id);
    t.strengthPct = max > min ? (t.theta - min) / (max - min) : 0.5;
  }

  // Engine inputs in team-index order: group index (0..11) and host flag.
  const groups = Uint8Array.from(teams.map((t) => t.group.charCodeAt(0) - 65));
  const hosts = Uint8Array.from(teams.map((t) => (HOSTS.has(t.name) ? 1 : 0)));

  return {
    teams, // [{ id, name, group, theta, tau, rating, rank, strengthPct }]
    priorTheta,
    priorTau,
    groups,
    hosts,
    link: fit.link, // { mu, home_adv, scale } — for the Poisson goals model
    rounds: ROUNDS,
  };
}
