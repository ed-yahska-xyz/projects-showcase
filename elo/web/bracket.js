// bracket.js — the results view (Phase 5). Runs the real simulator twice (once
// on the data prior, once on the fused strengths) and renders the your-vs-data
// contrast: a "where your picks moved the needle" callout, championship-odds
// bars, and a tap-to-expand round-by-round path for each team.
//
// simulate() returns per-team per-round reach probabilities, row-major
// team*6 + round (rounds: R32, R16, QF, SF, Final, Champion).

import { ROUNDS } from "./data.js";

const NR = ROUNDS.length; // 6
const CHAMP = NR - 1; // champion is the last round

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

// Pure: turn the two per-round arrays into sorted comparison rows + the biggest
// movers. Exported so it can be unit-tested without the DOM.
export function buildComparison(teams, dataRounds, userRounds) {
  const rows = teams.map((t) => {
    const base = t.id * NR;
    const data = Array.from({ length: NR }, (_, r) => dataRounds[base + r]);
    const user = Array.from({ length: NR }, (_, r) => userRounds[base + r]);
    return { team: t, data, user, champData: data[CHAMP], champUser: user[CHAMP], delta: user[CHAMP] - data[CHAMP] };
  });
  rows.sort((a, b) => b.champUser - a.champUser);
  const byMove = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const up = byMove.filter((r) => r.delta > 0.003).slice(0, 3);
  const down = byMove.filter((r) => r.delta < -0.003).slice(0, 3);
  return { rows, up, down };
}

function roundDetailHTML(row) {
  const maxv = Math.max(...row.data, ...row.user, 0.01);
  return ROUNDS.map(
    (name, r) => `
      <div class="rd-row">
        <span class="rd-name">${name}</span>
        <span class="rd-bars">
          <span class="rd-bar data" style="width:${(row.data[r] / maxv) * 100}%"></span>
          <span class="rd-bar user" style="width:${(row.user[r] / maxv) * 100}%"></span>
        </span>
        <span class="rd-vals">${pct(row.data[r])} → ${pct(row.user[r])}</span>
      </div>`,
  ).join("");
}

function moverHTML(row, dir) {
  const sign = dir === "up" ? "▲" : "▼";
  return `<li class="mover ${dir}">
    <img class="mv-flag" src="${row.team.flagSquare}" alt="" loading="lazy" />
    <span class="mv-name">${row.team.name}</span>
    <span class="mv-odds">${pct(row.champData)} → ${pct(row.champUser)}</span>
    <span class="mv-delta">${sign} ${Math.abs(row.delta * 100).toFixed(1)} pts</span>
  </li>`;
}

export function renderBracket(container, engine, teams, { topN = 16 } = {}) {
  engine.fitAndFuse();
  const dataRounds = engine.simulate(0, false); // baseline (data prior)
  const userRounds = engine.simulate(0, true); // your ranking (fused)
  const { rows, up, down } = buildComparison(teams, dataRounds, userRounds);
  const maxOdds = Math.max(...rows.map((r) => Math.max(r.champData, r.champUser)), 0.01);

  const movers =
    up.length || down.length
      ? `<section class="movers">
           <h3>Where your picks moved the needle</h3>
           <ul class="mover-list">
             ${up.map((r) => moverHTML(r, "up")).join("")}
             ${down.map((r) => moverHTML(r, "down")).join("")}
           </ul>
         </section>`
      : "";

  const list = rows
    .slice(0, topN)
    .map((r) => {
      const moved = r.delta > 0.005 ? "up" : r.delta < -0.005 ? "down" : "flat";
      const sign = r.delta >= 0 ? "+" : "−";
      const deltaLabel = moved !== "flat" ? `<span class="delta ${moved}">${sign}${Math.abs(r.delta * 100).toFixed(1)}</span>` : "";
      return `
        <li class="cmp-row" data-team="${r.team.id}">
          <div class="cmp-team">
            <img class="cmp-flag" src="${r.team.flagSquare}" alt="" loading="lazy" />
            <span class="cmp-name">${r.team.name}</span>
            ${deltaLabel}
            <span class="cmp-expand" aria-hidden="true">▸</span>
          </div>
          <div class="cmp-bars">
            <div class="cmp-bar-track" title="data baseline ${pct(r.champData)}">
              <div class="cmp-bar data" style="width:${(r.champData / maxOdds) * 100}%"></div>
              <span class="cmp-val">${pct(r.champData)}</span>
            </div>
            <div class="cmp-bar-track" title="your ranking ${pct(r.champUser)}">
              <div class="cmp-bar user ${moved}" style="width:${(r.champUser / maxOdds) * 100}%"></div>
              <span class="cmp-val">${pct(r.champUser)}</span>
            </div>
          </div>
          <div class="round-detail">${roundDetailHTML(r)}</div>
        </li>`;
    })
    .join("");

  container.innerHTML = `
    <header class="finish-head">
      <h2>Championship odds</h2>
      <p class="finish-sub"><span class="swatch data"></span> data baseline
        vs <span class="swatch user"></span> your ranking. Tap a team for its round-by-round path.</p>
    </header>
    ${movers}
    <ol class="cmp-list">${list}</ol>`;

  // Tap a row to expand its round-by-round path.
  container.querySelectorAll(".cmp-row").forEach((row) => {
    row.addEventListener("click", () => row.classList.toggle("open"));
  });
}
