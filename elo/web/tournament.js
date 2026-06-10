// tournament.js — build a concrete World Cup 2026 bracket from team strengths
// and the official schedule (R32 slot definitions + knockout feed graph). Pure
// and deterministic: by default the stronger team advances each match; callers
// pass `overrides` (matchId -> winner team id) to force a result, and every
// downstream match re-flows. No DOM, no engine — unit-testable.

// Round structure (match-number ranges are fixed by the 2026 format).
export const ROUNDS = [
  { name: "Round of 32", matches: range(73, 88) },
  { name: "Round of 16", matches: range(89, 96) },
  { name: "Quarterfinal", matches: range(97, 100) },
  { name: "Semifinal", matches: [101, 102] },
  { name: "Final", matches: [104] },
  { name: "Third place", matches: [103] },
];
function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

// Group standings: strongest team finishes top. Returns the sorted 4-team table
// per group and the 8 best third-placed teams (the ones that qualify).
export function computeGroups(teams, strengthOf) {
  const byGroup = {};
  for (const t of teams) (byGroup[t.group] ||= []).push(t);
  const tables = {};
  const thirds = [];
  for (const g of Object.keys(byGroup).sort()) {
    const sorted = byGroup[g].slice().sort((a, b) => strengthOf(b.id) - strengthOf(a.id));
    tables[g] = sorted;
    thirds.push({ group: g, team: sorted[2] });
  }
  const bestThirds = thirds.slice().sort((a, b) => strengthOf(b.team.id) - strengthOf(a.team.id)).slice(0, 8);
  return { tables, bestThirds };
}

// Bipartite match the 8 qualified third-place groups onto the 8 "3rd:set" R32
// slots, honoring each slot's allowed group set (Kuhn's augmenting-path algo).
// Returns { slotMatchId: groupLetter }.
function assignThirds(thirdSlots, qualifiedGroups) {
  const matchSlot = {}; // slot match id -> group
  function aug(group, visited) {
    for (const slot of thirdSlots) {
      if (!slot.allowed.includes(group) || visited.has(slot.match)) continue;
      visited.add(slot.match);
      if (matchSlot[slot.match] === undefined || aug(matchSlot[slot.match], visited)) {
        matchSlot[slot.match] = group;
        return true;
      }
    }
    return false;
  }
  for (const g of [...qualifiedGroups].sort()) aug(g, new Set());
  return matchSlot; // slot -> group
}

// Resolve the 16 R32 slot definitions into concrete { match, home, away } teams.
export function resolveR32(slotDefs, tables, bestThirds) {
  const thirdTeamByGroup = {};
  for (const { group, team } of bestThirds) thirdTeamByGroup[group] = team;

  const thirdSlots = Object.entries(slotDefs)
    .filter(([, d]) => d.away.startsWith("3rd"))
    .map(([m, d]) => ({ match: Number(m), allowed: d.away.split(":")[1].split("/") }));
  const groupOfSlot = assignThirds(thirdSlots, bestThirds.map((x) => x.group));

  const tok = (t, mid) => {
    if (t.startsWith("W_")) return tables[t.slice(2)][0];
    if (t.startsWith("RU_")) return tables[t.slice(3)][1];
    if (t.startsWith("3rd")) return thirdTeamByGroup[groupOfSlot[mid]];
    throw new Error("bad slot token: " + t);
  };

  return Object.entries(slotDefs)
    .map(([m, d]) => ({ match: Number(m), home: tok(d.home, Number(m)), away: tok(d.away, Number(m)) }))
    .sort((a, b) => a.match - b.match);
}

// Play the whole knockout: R32 participants from resolveR32, later rounds from
// the feed graph (W74 = winner of match 74, L101 = loser of match 101).
// Returns { matchId: { home, away, winner, loser } } for matches 73..104.
export function playBracket(r32, feeds, strengthOf, overrides = {}) {
  const participants = {};
  for (const m of r32) participants[m.match] = { home: m.home, away: m.away };
  for (const [mid, [h, a]] of Object.entries(feeds)) participants[Number(mid)] = { home: h, away: a };

  const results = {};
  const resolve = (x) => {
    if (typeof x !== "string") return x; // already a team object
    const num = Number(x.slice(1));
    return x[0] === "W" ? results[num].winner : results[num].loser;
  };

  for (const mid of Object.keys(participants).map(Number).sort((a, b) => a - b)) {
    const home = resolve(participants[mid].home);
    const away = resolve(participants[mid].away);
    const ov = overrides[mid];
    const winner = ov === home.id ? home : ov === away.id ? away : strengthOf(home.id) >= strengthOf(away.id) ? home : away;
    results[mid] = { home, away, winner, loser: winner === home ? away : home };
  }
  return results;
}

// Tie it all together.
export function buildTournament(teams, strengthOf, slotDefs, feeds, overrides = {}) {
  const { tables, bestThirds } = computeGroups(teams, strengthOf);
  const r32 = resolveR32(slotDefs, tables, bestThirds);
  const results = playBracket(r32, feeds, strengthOf, overrides);
  return {
    tables,
    bestThirds,
    results,
    champion: results[104].winner,
    runnerUp: results[104].loser,
    third: results[103].winner,
  };
}
