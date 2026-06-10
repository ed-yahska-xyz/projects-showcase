// group-view.js — the group-stage view: each group's projected final standings
// (from the user's fused strengths — top 2 advance, plus the best 8 third-placed
// teams) alongside its official fixtures with dates and venues.

import { computeGroups } from "./tournament.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function standingRow(team, pos, group, qualifyingThirds) {
  let status, cls;
  if (pos <= 2) {
    status = "Advances";
    cls = "adv";
  } else if (pos === 3) {
    const ok = qualifyingThirds.has(group);
    status = ok ? "Best-3rd ✓" : "3rd — out";
    cls = ok ? "adv3" : "out";
  } else {
    status = "Eliminated";
    cls = "out";
  }
  return `<li class="grp-row ${cls}">
    <span class="grp-pos">${pos}</span>
    <img class="grp-flag" src="${team.flagSquare}" alt="" loading="lazy" />
    <span class="grp-name">${team.name}</span>
    <span class="grp-status">${status}</span>
  </li>`;
}

function fixtureRow(m, flagOf) {
  const v = m.venue || {};
  const side = (name) => `<img class="grp-fix-flag" src="${flagOf(name) || ""}" alt="" loading="lazy" />${name}`;
  return `<li class="grp-fix">
    <span class="grp-fix-date">${fmtDate(m.date)}</span>
    <span class="grp-fix-teams">${side(m.home)} <span class="grp-v">v</span> ${side(m.away)}</span>
    <span class="grp-fix-venue" title="${[v.stadium, v.city].filter(Boolean).join(" · ")}">${v.city || ""}</span>
  </li>`;
}

export function renderGroups(container, { teams, strengthOf, groupFixtures }) {
  const { tables, bestThirds } = computeGroups(teams, strengthOf);
  const qualifyingThirds = new Set(bestThirds.map((b) => b.group));
  const groups = Object.keys(tables).sort();

  // Fixtures reference team names; map name -> square flag for inline flags.
  const flagByName = new Map(teams.map((t) => [t.name, t.flagSquare]));
  const flagOf = (name) => flagByName.get(name);

  const cards = groups
    .map((g) => {
      const standings = tables[g].map((t, i) => standingRow(t, i + 1, g, qualifyingThirds)).join("");
      const fixtures = (groupFixtures[g] || []).map((m) => fixtureRow(m, flagOf)).join("");
      return `<section class="grp-card">
        <h3 class="grp-title">Group ${g}</h3>
        <ol class="grp-standings">${standings}</ol>
        <details class="grp-fixtures">
          <summary>${(groupFixtures[g] || []).length} fixtures</summary>
          <ul>${fixtures}</ul>
        </details>
      </section>`;
    })
    .join("");

  container.innerHTML = `
    <header class="finish-head">
      <h2>Group stage</h2>
      <p class="finish-sub">Projected standings from your ranking — top 2 advance, plus the 8 best
        third-placed teams. Tap a group for its fixtures.</p>
    </header>
    <div class="grp-grid">${cards}</div>`;
}
