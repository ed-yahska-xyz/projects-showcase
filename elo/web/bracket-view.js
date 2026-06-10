// bracket-view.js — render the concrete knockout bracket as editable round
// columns. Each match shows its two teams plus its official date + venue; the
// projected/forced winner is highlighted. Tapping the other team forces that
// result via onPick, and the caller re-renders so downstream matches re-flow.

import { ROUNDS } from "./tournament.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// Friendly label for an official source slot (where this team came from).
//  W_E -> "Win E", RU_A -> "RU A", 3rd:... -> "3rd", W74 -> "W74", L101 -> "L101"
function srcLabel(tok) {
  if (!tok) return "";
  if (tok.startsWith("W_")) return "Win " + tok.slice(2);
  if (tok.startsWith("RU_")) return "RU " + tok.slice(3);
  if (tok.startsWith("3rd")) return "3rd";
  return tok; // W74 / L101 (winner/loser of that match number)
}

function teamBtn(matchId, team, winner, forced, src) {
  const isWin = team.id === winner.id;
  const cls = `bk-team${isWin ? " win" : ""}${isWin && forced ? " forced" : ""}`;
  const srcTag = src ? `<span class="bk-src" title="from ${src}">${srcLabel(src)}</span>` : "";
  return `<button class="${cls}" data-match="${matchId}" data-team="${team.id}" title="${team.name} (seed #${team.rank} of 48)">
    <img class="bk-flag" src="${team.flagSquare}" alt="" loading="lazy" />
    <span class="bk-name">${team.name}</span>
    ${srcTag}
    <span class="bk-seed">#${team.rank}</span>
  </button>`;
}

function metaLine(info) {
  if (!info) return "";
  const v = info.venue || {};
  const where = [v.city, v.country].filter(Boolean).join(", ");
  return `<div class="bk-meta" title="${[v.stadium, where].filter(Boolean).join(" · ")}">
    <span class="bk-date">${fmtDate(info.date)}</span>
    <span class="bk-venue">${v.city || ""}</span>
  </div>`;
}

function matchCard(matchId, res, forcedSet, matchInfo) {
  const forced = forcedSet.has(matchId);
  const info = matchInfo[matchId] || {};
  return `<div class="bk-match${forced ? " edited" : ""}" data-match="${matchId}">
    <div class="bk-mno">Match ${matchId}</div>
    ${teamBtn(matchId, res.home, res.winner, forced, info.home)}
    ${teamBtn(matchId, res.away, res.winner, forced, info.away)}
    ${metaLine(info)}
  </div>`;
}

// Which round columns are collapsed — module-level so it survives re-renders
// (the bracket re-renders on every edit).
const collapsedRounds = new Set();

export function renderTournament(container, tourney, { onPick, onResetBracket, overrides = {}, matchInfo = {} }) {
  const { results, champion, runnerUp, third } = tourney;
  const forcedSet = new Set(Object.keys(overrides).map(Number));
  const mainRounds = ROUNDS.filter((r) => r.name !== "Third place");

  const cols = mainRounds
    .map(
      (r) => `<div class="bk-col${collapsedRounds.has(r.name) ? " collapsed" : ""}">
        <button class="bk-round" data-round="${r.name}" aria-expanded="${!collapsedRounds.has(r.name)}">
          <span class="bk-round-name">${r.name}</span>
          <span class="bk-round-n">${r.matches.length}</span>
        </button>
        <div class="bk-col-body">
          ${r.matches.map((m) => matchCard(m, results[m], forcedSet, matchInfo)).join("")}
        </div>
      </div>`,
    )
    .join("");
  const allCollapsed = mainRounds.every((r) => collapsedRounds.has(r.name));

  const edited = forcedSet.size;
  const finalInfo = matchInfo[104];
  const finalLine = finalInfo
    ? `<span class="bk-final-meta">Final · ${fmtDate(finalInfo.date)} · ${finalInfo.venue.stadium}, ${finalInfo.venue.city}</span>`
    : "";

  container.innerHTML = `
    <div class="bk-champ">
      <span class="bk-trophy">🏆</span>
      <img class="bk-champ-flag" src="${champion.flag}" alt="" />
      <span class="bk-champ-name">${champion.name}</span>
      <span class="bk-champ-sub">${edited ? "your bracket" : "projected"} champion · runner-up
        <img class="bk-inline-flag" src="${runnerUp.flagSquare}" alt="" loading="lazy" />${runnerUp.name} · 3rd
        <img class="bk-inline-flag" src="${third.flagSquare}" alt="" loading="lazy" />${third.name}</span>
      ${finalLine}
    </div>
    <p class="bk-hint">Tap any team to send them through — the rest of the bracket updates.${edited ? ` <strong>${edited} edit${edited === 1 ? "" : "s"}</strong>.` : ""}</p>
    <div class="bk-scroll">${cols}</div>
    <div class="bk-third">
      <span class="bk-third-label">Third-place playoff</span>
      ${matchCard(103, results[103], forcedSet, matchInfo)}
    </div>
    <div class="bk-bar">
      <button id="toggle-all" class="btn ghost sm">${allCollapsed ? "Expand all" : "Collapse all"}</button>
      <button id="reset-bracket" class="btn ghost"${edited ? "" : " disabled"}>Reset to projection</button>
    </div>`;

  container.querySelectorAll(".bk-team").forEach((b) =>
    b.addEventListener("click", () => onPick(Number(b.dataset.match), Number(b.dataset.team))),
  );

  // Collapse/expand a round column (toggle the set + the DOM, no full re-render).
  container.querySelectorAll(".bk-round").forEach((h) =>
    h.addEventListener("click", () => {
      const name = h.dataset.round;
      const col = h.closest(".bk-col");
      const nowCollapsed = !collapsedRounds.has(name);
      collapsedRounds[nowCollapsed ? "add" : "delete"](name);
      col.classList.toggle("collapsed", nowCollapsed);
      h.setAttribute("aria-expanded", String(!nowCollapsed));
    }),
  );

  container.querySelector("#toggle-all")?.addEventListener("click", () => {
    if (mainRounds.every((r) => collapsedRounds.has(r.name))) collapsedRounds.clear();
    else mainRounds.forEach((r) => collapsedRounds.add(r.name));
    renderTournament(container, tourney, { onPick, onResetBracket, overrides, matchInfo });
  });
  container.querySelector("#reset-bracket")?.addEventListener("click", onResetBracket);
}
