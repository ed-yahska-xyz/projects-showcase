// finish.js — the results screen. Two tabs: the editable knockout Bracket
// (default) and the your-vs-data championship Odds. Owns the bracket overrides
// (persisted) and re-renders the bracket on every edit so downstream matches
// re-flow. Bracket and odds both read the engine's current fused strengths.

import { renderBracket as renderOdds } from "./bracket.js";
import { buildTournament } from "./tournament.js";
import { renderTournament } from "./bracket-view.js";
import { renderGroups } from "./group-view.js";
import { loadOverrides, saveOverrides, clearOverrides } from "./storage.js";

let scheduleCache = null;
async function getSchedule() {
  if (!scheduleCache) {
    const res = await fetch("../assets/schedule.json");
    if (!res.ok) throw new Error(`schedule.json ${res.status}`);
    scheduleCache = await res.json();
  }
  return scheduleCache;
}

export async function showFinish(container, engine, teams, { onKeepRanking, onRestart }) {
  const sched = await getSchedule();
  const slotDefs = sched.meta.r32_slot_definitions;
  const feeds = sched.meta.knockout_bracket_feeds;

  // Per-match date + venue for the knockout rounds, keyed by match number;
  // and the group fixtures bucketed by group letter.
  const matchInfo = {};
  const groupFixtures = {};
  for (const m of sched.matches) {
    if (m.stage === "Group") {
      (groupFixtures[m.group] ||= []).push(m);
    } else {
      // home/away are the official source slots (W_E, RU_A, 3rd:…, W74, L101…).
      matchInfo[m.match] = { date: m.date, venue: m.venue, stage: m.stage, home: m.home, away: m.away };
    }
  }

  engine.fitAndFuse();
  const strength = engine.fusedStrengths();
  const strengthOf = (id) => strength[id];

  let overrides = loadOverrides();
  let tab = "bracket";

  function render() {
    container.innerHTML = `
      <div class="finish-tabs">
        <div class="tab-group">
          <button class="tab ${tab === "bracket" ? "active" : ""}" data-tab="bracket">Bracket</button>
          <button class="tab ${tab === "groups" ? "active" : ""}" data-tab="groups">Groups</button>
          <button class="tab ${tab === "odds" ? "active" : ""}" data-tab="odds">Odds</button>
        </div>
        <div class="finish-controls">
          <button id="keep-ranking" class="btn ghost sm">Keep ranking</button>
          <button id="restart" class="btn danger sm">Start over</button>
        </div>
      </div>
      <div id="finish-body"></div>`;

    const body = container.querySelector("#finish-body");
    if (tab === "bracket") {
      const tourney = buildTournament(teams, strengthOf, slotDefs, feeds, overrides);
      renderTournament(body, tourney, {
        overrides,
        matchInfo,
        onPick: (matchId, teamId) => {
          overrides = { ...overrides, [matchId]: teamId };
          saveOverrides(overrides);
          render();
        },
        onResetBracket: () => {
          overrides = clearOverrides();
          render();
        },
      });
    } else if (tab === "groups") {
      renderGroups(body, { teams, strengthOf, groupFixtures });
    } else {
      renderOdds(body, engine, teams);
    }

    container.querySelectorAll("[data-tab]").forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab;
        render();
      };
    });
    container.querySelector("#keep-ranking").onclick = onKeepRanking;
    container.querySelector("#restart").onclick = onRestart;
  }

  render();
}
