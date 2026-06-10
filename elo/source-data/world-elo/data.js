// data.js — load static assets and align the data-driven strengths to the
// engine's team indices.
//
// The fit (theta_data.json) is keyed by the results dataset's team names; the
// app's teams.json defines the 48 tournament teams and their index order. The
// engine works in indices, so we join name -> index here, normalizing the
// handful of names that differ between the dataset and FIFA's official list.

// Dataset name (left) -> teams.json name (right). Extend as needed.
const NAME_ALIASES = {
  'Turkey': 'Türkiye',
  'South Korea': 'Korea Republic',
  'IR Iran': 'Iran',
  'United States': 'USA',
  'Cape Verde': 'Cabo Verde',
  'Ivory Coast': "Côte d'Ivoire",
};

const canon = (name) => NAME_ALIASES[name] || name;

// Fallback prior for any tournament team missing from the fit: average strength,
// very low precision, so the user's picks dominate there (correct — we have no data).
const FALLBACK = { theta: 0.0, tau: 0.2 };

export async function loadData() {
  const [teams, fit] = await Promise.all([
    fetch('./assets/teams.json').then((r) => r.json()),       // [{ id, name, group }]
    fetch('./assets/theta_data.json').then((r) => r.json()),  // { link, teams:[{name,theta,tau}] }
  ]);

  // index strengths by canonical name
  const byName = new Map();
  for (const t of fit.teams) byName.set(canon(t.name), t);

  // build arrays in teams.json index order
  const theta = new Float64Array(teams.length);
  const tau = new Float64Array(teams.length);
  const missing = [];
  teams.forEach((team, i) => {
    const hit = byName.get(team.name);
    if (hit) {
      theta[i] = hit.theta;
      tau[i] = hit.tau;
    } else {
      theta[i] = FALLBACK.theta;
      tau[i] = FALLBACK.tau;
      missing.push(team.name);
    }
  });

  if (missing.length) {
    console.warn('No fitted strength for:', missing, '— using fallback prior. Add aliases to NAME_ALIASES.');
  }

  return { teams, theta, tau, link: fit.link };
}

// Push the prior into the real WASM engine (Phase 2+). Interleaves theta/tau as
// the load_data_strengths ABI expects: [theta0, tau0, theta1, tau1, ...].
export function loadPriorIntoEngine(engine, theta, tau) {
  const n = theta.length;
  const interleaved = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    interleaved[2 * i] = theta[i];
    interleaved[2 * i + 1] = tau[i];
  }
  engine.loadDataStrengths(interleaved); // wrapper over WASM load_data_strengths
}
