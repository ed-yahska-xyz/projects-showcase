// Bracket logic proof. Run: `bun test/bracket-tournament.test.js`
// Builds the concrete WC2026 bracket from the data strengths + official schedule
// and checks structure, the third-place->slot matching, and override cascades.
import { buildTournament, computeGroups, resolveR32, playBracket } from "../web/tournament.js";

const dir = new URL("../assets/", import.meta.url).pathname;
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
}

const teams = (await Bun.file(dir + "teams.json").json()).teams.slice().sort((a, b) => a.id - b.id);
const fit = await Bun.file(dir + "theta_data.json").json();
const sched = await Bun.file(dir + "schedule.json").json();
const byName = new Map(fit.teams.map((t) => [t.name, t]));
const theta = teams.map((t) => byName.get(t.name).theta);
const strengthOf = (id) => theta[id];
const slotDefs = sched.meta.r32_slot_definitions;
const feeds = sched.meta.knockout_bracket_feeds;

// --- groups ---
const { tables, bestThirds } = computeGroups(teams, strengthOf);
check("12 groups, 4 teams each", Object.keys(tables).length === 12 && Object.values(tables).every((t) => t.length === 4));
check("8 best thirds selected", bestThirds.length === 8);
check("group winners are the strongest in their group", Object.values(tables).every((t) => strengthOf(t[0].id) >= strengthOf(t[1].id)));

// --- R32 resolution: 32 distinct teams, third slots honor their allowed sets ---
const r32 = resolveR32(slotDefs, tables, bestThirds);
check("16 R32 matches", r32.length === 16);
const r32Teams = new Set(r32.flatMap((m) => [m.home.id, m.away.id]));
check("R32 has 32 distinct teams", r32Teams.size === 32);
// every qualified third lands in a slot whose allowed set contains its group
const thirdGroups = new Set(bestThirds.map((b) => b.group));
let thirdSlotOk = true;
for (const [m, d] of Object.entries(slotDefs)) {
  if (!d.away.startsWith("3rd")) continue;
  const allowed = d.away.split(":")[1].split("/");
  const awayTeam = r32.find((x) => x.match === Number(m)).away;
  const g = teams.find((t) => t.id === awayTeam.id).group;
  if (!allowed.includes(g) || !thirdGroups.has(g)) thirdSlotOk = false;
}
check("each 3rd-place slot filled from its allowed groups", thirdSlotOk);
// winners/runners-up sit in the right slots
check("W_A slot is group A winner", r32.find((m) => m.match === 79).home.id === tables["A"][0].id);
check("RU_C slot is group C runner-up", r32.find((m) => m.match === 75).away.id === tables["C"][1].id);

// --- full bracket (chalk) ---
const t = buildTournament(teams, strengthOf, slotDefs, feeds);
check("all knockout matches resolved (73..104)", [...range(73, 104)].every((m) => t.results[m]));
check("champion is the overall strongest (chalk) = Spain", t.champion.name === "Spain", t.champion.name);
check("champion != runner-up != third", new Set([t.champion.id, t.runnerUp.id, t.third.id]).size === 3);
console.log(`    chalk: ${t.champion.name} beat ${t.runnerUp.name} in the final; 3rd ${t.third.name}`);

// --- editing: override the final, champion changes ---
const ov1 = { 104: t.runnerUp.id };
const t2 = buildTournament(teams, strengthOf, slotDefs, feeds, ov1);
check("override final -> champion becomes the runner-up", t2.champion.id === t.runnerUp.id, t2.champion.name);

// --- editing cascade: knock the chalk champion out in the R32, it can't win ---
const champR32 = Object.values(t.results).find((r) => r.home.id === t.champion.id || r.away.id === t.champion.id);
// find the R32 match (73..88) containing the champion
let champEntryMatch = null;
for (const m of range(73, 88)) {
  const r = t.results[m];
  if (r.home.id === t.champion.id || r.away.id === t.champion.id) champEntryMatch = m;
}
const opponent = t.results[champEntryMatch].home.id === t.champion.id ? t.results[champEntryMatch].away.id : t.results[champEntryMatch].home.id;
const t3 = buildTournament(teams, strengthOf, slotDefs, feeds, { [champEntryMatch]: opponent });
const champStillChampion = t3.champion.id === t.champion.id;
check("knocking the favourite out in R32 removes them from the final", !champStillChampion, `${t3.champion.name} now champion`);

// --- stale override (team no longer a participant) is ignored gracefully ---
const t4 = buildTournament(teams, strengthOf, slotDefs, feeds, { 104: 99999 });
check("invalid override falls back to chalk", t4.champion.name === "Spain");

// --- schedule integrity: every knockout match has a venue/date, and its
// home/away matches the official slot definitions / feed graph ---
const ko = sched.matches.filter((m) => m.stage !== "Group");
check("32 knockout matches (73..104)", ko.length === 32 && ko.every((m) => m.match >= 73 && m.match <= 104));
check("every knockout match has a date + venue", ko.every((m) => m.date && m.venue && m.venue.stadium && m.venue.city));
let haOk = true;
for (const m of ko) {
  let eh, ea;
  if (slotDefs[m.match]) [eh, ea] = [slotDefs[m.match].home, slotDefs[m.match].away];
  else if (feeds[m.match]) [eh, ea] = feeds[m.match];
  if (m.home !== eh || m.away !== ea) haOk = false;
}
check("schedule home/away matches the slot defs + feed graph", haOk);

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

console.log(failures === 0 ? "\nBRACKET PASS — official structure, third-place matching, and edit cascades" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
