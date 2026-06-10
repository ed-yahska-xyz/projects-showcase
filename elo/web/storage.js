// storage.js — localStorage persistence of the RAW pick list (not derived
// strengths), so a model change or refreshed data prior never strands a saved
// session. Versioned key, incremental save after every pick, in-memory fallback
// if localStorage is unavailable (private mode, quota, etc.).

const KEY = "wcpredictor:v1:picks:2026";
const BRACKET_KEY = "wcpredictor:v1:bracket:2026";

let memory = null; // in-memory fallback when localStorage throws

function canUseLocalStorage() {
  try {
    const probe = "__wc_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const useLS = canUseLocalStorage();
if (!useLS) memory = [];

function read() {
  if (!useLS) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(list) {
  if (!useLS) {
    memory = list;
    return;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota or serialization failure — degrade to memory for this session.
    memory = list;
  }
}

// Load the persisted pick list: [{ w, l, t }, ...]
export function loadPicks() {
  return read();
}

// Append one pick and persist immediately. t = timestamp for later recency use.
export function appendPick({ w, l, t = Date.now() }) {
  const list = read();
  list.push({ w, l, t });
  write(list);
  return list;
}

// Remove the most recent pick (for an undo affordance).
export function popPick() {
  const list = read();
  list.pop();
  write(list);
  return list;
}

// Clear the saved session (start over).
export function clearPicks() {
  if (useLS) {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  memory = useLS ? null : [];
  return [];
}

// --- bracket overrides: { matchId: winnerTeamId } the user forced ---
let bracketMemory = useLS ? null : {};

export function loadOverrides() {
  if (!useLS) return bracketMemory || {};
  try {
    const raw = window.localStorage.getItem(BRACKET_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides) {
  if (!useLS) {
    bracketMemory = overrides;
    return;
  }
  try {
    window.localStorage.setItem(BRACKET_KEY, JSON.stringify(overrides));
  } catch {
    bracketMemory = overrides;
  }
}

export function clearOverrides() {
  if (useLS) {
    try {
      window.localStorage.removeItem(BRACKET_KEY);
    } catch {
      /* ignore */
    }
  }
  bracketMemory = useLS ? null : {};
  return {};
}
