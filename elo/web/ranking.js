// ranking.js — the binary "this or that" pick loop. Pure UI + orchestration:
// it talks only to the engine interface (never to WASM directly), so swapping
// `engine-mock.js` for the real `engine.js` is a one-line import change here.
//
//   nextPair() -> render two team cards -> on pick: addPick + persist -> repeat
//
// A Fisher-information progress meter drives early-stop: usable past the floor,
// nudges toward the target, hard-stops at the cap.

import { createEngine } from "./engine.js";
import { loadData } from "./data.js";
import { loadPicks, appendPick, popPick, clearPicks, clearOverrides } from "./storage.js";
import { showFinish } from "./finish.js";

// Pick budget (PLAN.md: ~25 floor / ~40 target / ~55 cap). Not a hard count —
// the meter is driven by information; these gate the finish affordances.
const FLOOR = 25;
const TARGET = 40;
const CAP = 55;

const el = (id) => document.getElementById(id);

const ui = {
  meterFill: el("meter-fill"),
  meterLabel: el("meter-label"),
  pickCount: el("pick-count"),
  stage: el("stage"),
  cardA: el("card-a"),
  cardB: el("card-b"),
  undo: el("undo"),
  finishBtn: el("finish-btn"),
  finishPanel: el("finish-panel"),
  app: el("app"),
};

let engine;
let teams;
let current = [0, 1]; // current [i, j] pair on screen
let picks = [];
let finished = false;

function teamCardHTML(team) {
  const barPct = Math.round((team.strengthPct ?? 0.5) * 100);
  return `
    <img class="card-flag" src="${team.flag}" alt="" loading="lazy" />
    <span class="card-name card-name-hero">${team.name}</span>
    <span class="card-stat">
      <span class="stat-rating">${team.rating}</span>
    </span>
    <span class="card-bar" aria-hidden="true">
      <span class="card-bar-fill" style="width:${barPct}%"></span>
    </span>
    <span class="card-hint">tap to advance</span>`;
}

function renderPair() {
  const [i, j] = current;
  ui.cardA.innerHTML = teamCardHTML(teams[i]);
  ui.cardB.innerHTML = teamCardHTML(teams[j]);
  ui.cardA.dataset.teamId = teams[i].id;
  ui.cardB.dataset.teamId = teams[j].id;
}

function updateMeter() {
  const p = engine.progress(); // 0..1 information captured
  const n = picks.length;
  ui.meterFill.style.width = `${Math.round(p * 100)}%`;
  ui.pickCount.textContent = `${n} pick${n === 1 ? "" : "s"}`;

  const lockedIn = p >= 0.92 || n >= TARGET;
  const canFinish = n >= FLOOR;
  ui.finishBtn.disabled = !canFinish;
  ui.undo.disabled = n === 0;

  if (n >= CAP) {
    ui.meterLabel.textContent = "That's plenty — see your bracket";
    finish();
  } else if (lockedIn) {
    ui.meterLabel.textContent = "You're locked in";
    ui.finishBtn.classList.add("pulse");
  } else if (canFinish) {
    ui.meterLabel.textContent = "Looking good — a few more sharpen it";
    ui.finishBtn.classList.remove("pulse");
  } else {
    ui.meterLabel.textContent = `Warming up — ${FLOOR - n} to unlock`;
    ui.finishBtn.classList.remove("pulse");
  }
}

function pick(winnerId, loserId) {
  if (finished) return;
  engine.addPick(winnerId, loserId);
  picks = appendPick({ w: winnerId, l: loserId });
  current = engine.nextPair();
  renderPair();
  updateMeter();
}

function onCardActivate(card) {
  const winnerId = Number(card.dataset.teamId);
  const [i, j] = current;
  const loserId = winnerId === teams[i].id ? teams[j].id : teams[i].id;
  // brief press feedback
  card.classList.add("picked");
  setTimeout(() => card.classList.remove("picked"), 140);
  pick(winnerId, loserId);
}

function undo() {
  if (picks.length === 0) return;
  picks = popPick();
  // Rebuild engine state from the trimmed list (cheap; picks are few).
  rebuildEngine();
  current = engine.nextPair();
  renderPair();
  updateMeter();
}

function rebuildEngine() {
  engine = createEngine(teams.length, engineConfig);
  engine.replayPicks(picks);
}

function finish() {
  if (finished) return;
  finished = true;
  ui.app.classList.add("finished");
  showFinish(ui.finishPanel, engine, teams, { onKeepRanking: keepRanking, onRestart: restart });
}

function keepRanking() {
  finished = false;
  ui.app.classList.remove("finished");
  current = engine.nextPair();
  renderPair();
  updateMeter();
}

function restart() {
  picks = clearPicks();
  clearOverrides(); // a fresh ranking invalidates the old bracket edits
  finished = false;
  ui.app.classList.remove("finished");
  rebuildEngine();
  current = engine.nextPair();
  renderPair();
  updateMeter();
}

// Keyboard: ←/1 picks the left card, →/2 picks the right; U undoes.
function onKey(e) {
  if (finished) return;
  if (e.key === "ArrowLeft" || e.key === "1") onCardActivate(ui.cardA);
  else if (e.key === "ArrowRight" || e.key === "2") onCardActivate(ui.cardB);
  else if (e.key.toLowerCase() === "u") undo();
}

let engineConfig;

async function main() {
  const data = await loadData();
  teams = data.teams;
  engineConfig = {
    priorTheta: data.priorTheta,
    priorTau: data.priorTau,
    groups: data.groups,
    hosts: data.hosts,
    link: data.link,
  };

  engine = createEngine(teams.length, engineConfig);
  picks = loadPicks();
  engine.replayPicks(picks);

  current = engine.nextPair();
  renderPair();
  updateMeter();

  ui.cardA.addEventListener("click", () => onCardActivate(ui.cardA));
  ui.cardB.addEventListener("click", () => onCardActivate(ui.cardB));
  ui.undo.addEventListener("click", undo);
  ui.finishBtn.addEventListener("click", finish);
  window.addEventListener("keydown", onKey);

  // Returning user with a stored Elo: jump straight to their bracket. They can
  // "Keep ranking" to resume or "Start over" to re-rank from scratch.
  if (picks.length > 0) finish();
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:2rem;font-family:system-ui">
    Failed to start: ${err.message}.<br/>Serve over http (ES modules need it):
    <code>python3 -m http.server</code> from the project root.</p>`;
});
