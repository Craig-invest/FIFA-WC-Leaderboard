/* Pure transform logic: turn a list of fixtures into our results.json shape.
 *
 * Everything the leaderboard needs is derivable from the full fixture list:
 *   - group-stage stats (p/w/d/l/gf/ga/pts) from finished group matches
 *   - furthest stage reached, per team, from which knockout rounds a team appears in
 *   - eliminated? -> lost its match in a knockout round, or finished the group
 *     stage without advancing to any knockout match
 *   - champion -> winner of the Final
 *
 * These functions are deliberately pure (no network, no fs) so they can be
 * unit-tested against a mock payload — see scripts/test/transform.test.mjs.
 *
 * Input shape: API-Football v3 /fixtures response objects, i.e. each item has
 *   fixture.status.short, league.round, teams.home/away {name, winner}, goals.home/away
 */

// Our internal stage codes, weakest -> strongest.
export const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "bronze", "final", "champion"];

// Strip accents / punctuation / case so "Côte d'Ivoire" matches "Ivory Coast" via aliases.
export function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Common ways data providers name the 2026 teams -> our 3-letter codes.
// Extend this if a provider uses a name we don't catch automatically.
export const ALIASES = {
  unitedstates: "USA", usa: "USA", usmnt: "USA",
  korearepublic: "KOR", southkorea: "KOR", koreasouth: "KOR",
  iriran: "IRN", iran: "IRN",
  cotedivoire: "CIV", ivorycoast: "CIV",
  czechia: "CZE", czechrepublic: "CZE",
  turkiye: "TUR", turkey: "TUR",
  drcongo: "COD", congodr: "COD", democraticrepublicofthecongo: "COD",
  capeverde: "CPV", capeverdeislands: "CPV",
  bosniaherzegovina: "BIH", bosniaandherzegovina: "BIH",
  newzealand: "NZL",
  saudiarabia: "KSA",
  southafrica: "RSA",
};

// Build a resolver: provider team name -> our code (or null if unknown).
export function makeResolver(teamsMeta) {
  const byName = {};
  for (const [code, meta] of Object.entries(teamsMeta)) {
    byName[normalize(meta.name)] = code;
    byName[normalize(code)] = code;
  }
  return (name) => {
    const n = normalize(name);
    return byName[n] || ALIASES[n] || null;
  };
}

const FINISHED = new Set(["FT", "AET", "PEN"]);
export const isFinished = (fx) => FINISHED.has(fx?.fixture?.status?.short);

// In-play statuses per API-Football: 1st/2nd half, half-time, extra time,
// break time, penalties in progress, suspended/interrupted but live.
const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"]);
export const isLive = (fx) => LIVE.has(fx?.fixture?.status?.short);

// Which of our team codes are currently playing (for the live row highlight).
export function liveTeamSet(fixtures, resolve) {
  const set = new Set();
  for (const fx of fixtures) {
    if (!isLive(fx)) continue;
    const h = resolve(fx.teams?.home?.name);
    const a = resolve(fx.teams?.away?.name);
    if (h) set.add(h);
    if (a) set.add(a);
  }
  return set;
}

// Map a provider "round" string to our stage code (null = not a stage we rank on).
export function roundToStage(round) {
  const r = normalize(round);
  if (r.includes("group")) return "group";
  if (r.includes("roundof32")) return "r32";
  if (r.includes("roundof16")) return "r16";
  if (r.includes("quarter")) return "qf";
  if (r.includes("semi")) return "sf";
  if (r.includes("3rdplace") || r.includes("thirdplace")) return "bronze";
  if (r.includes("final")) return "final";
  return null;
}

function blankStat() {
  return { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, stage: "group", eliminated: false };
}

// --- Group-stage table from finished (and optionally live) group matches ---
// When includeLive is true, an in-progress match counts provisionally using its
// current score — this is what powers the "as it stands" view.
export function computeGroupStats(fixtures, resolve, includeLive = true) {
  const stats = {};
  const ensure = (code) => (stats[code] ||= blankStat());

  for (const fx of fixtures) {
    if (roundToStage(fx.league?.round) !== "group") continue;
    if (!isFinished(fx) && !(includeLive && isLive(fx))) continue;
    const h = resolve(fx.teams?.home?.name);
    const a = resolve(fx.teams?.away?.name);
    if (!h || !a) continue;
    const hg = fx.goals?.home ?? 0;
    const ag = fx.goals?.away ?? 0;
    const H = ensure(h), A = ensure(a);
    H.p++; A.p++;
    H.gf += hg; H.ga += ag;
    A.gf += ag; A.ga += hg;
    if (hg > ag) { H.w++; A.l++; H.pts += 3; }
    else if (ag > hg) { A.w++; H.l++; A.pts += 3; }
    else { H.d++; A.d++; H.pts++; A.pts++; }
  }
  return stats;
}

function winnerOf(fx, resolve) {
  const home = fx.teams?.home, away = fx.teams?.away;
  if (home?.winner === true) return resolve(home.name);
  if (away?.winner === true) return resolve(away.name);
  const hg = fx.goals?.home, ag = fx.goals?.away;
  if (typeof hg === "number" && typeof ag === "number" && hg !== ag) {
    return resolve(hg > ag ? home.name : away.name);
  }
  return null; // draw with no winner flag (shouldn't happen in a decided knockout)
}

// --- Stage reached + elimination, derived from the whole fixture list ---
export function computeStages(fixtures, resolve) {
  const out = {}; // code -> { stage, eliminated }
  const ensure = (code) => (out[code] ||= { stage: "group", eliminated: false });
  const rank = (s) => STAGE_ORDER.indexOf(s);

  let groupFixtures = 0, finishedGroupFixtures = 0;
  const appearsInKnockout = new Set();

  for (const fx of fixtures) {
    const stage = roundToStage(fx.league?.round);
    if (stage === null) continue;
    const h = resolve(fx.teams?.home?.name);
    const a = resolve(fx.teams?.away?.name);

    if (stage === "group") {
      groupFixtures++;
      if (isFinished(fx)) finishedGroupFixtures++;
      continue;
    }

    // 3rd-place match: winner earns bronze medal (not eliminated); loser is 4th.
    // Don't set both teams to "bronze" via the appearance loop — only the winner
    // deserves the badge.
    if (stage === "bronze") {
      for (const code of [h, a]) if (code) appearsInKnockout.add(code);
      if (isFinished(fx) && h && a) {
        const win = winnerOf(fx, resolve);
        const lose = win === h ? a : win === a ? h : null;
        if (lose) ensure(lose).eliminated = true;
        if (win) { ensure(win).stage = "bronze"; ensure(win).eliminated = false; }
      }
      continue;
    }

    // Knockout fixture: appearing in it means each team REACHED that round.
    for (const code of [h, a]) {
      if (!code) continue;
      appearsInKnockout.add(code);
      const cur = ensure(code);
      if (rank(stage) > rank(cur.stage)) cur.stage = stage;
    }

    if (isFinished(fx) && h && a) {
      const win = winnerOf(fx, resolve);
      const lose = win === h ? a : win === a ? h : null;
      if (lose) ensure(lose).eliminated = true; // lost a knockout tie
      if (stage === "final" && win) {
        const champ = ensure(win);
        champ.stage = "champion";
        champ.eliminated = false;
      } else if (win) {
        // Advance the winner to the next round immediately — the data source
        // may not publish the next fixture until it is played, so without this
        // a team that won (e.g.) R32 would stay shown as "Round of 32" rather
        // than "Round of 16" until the R16 fixture data arrives.
        const NEXT = { r32: "r16", r16: "qf", qf: "sf", sf: "final" };
        const next = NEXT[stage];
        if (next) {
          const winner = ensure(win);
          if (rank(next) > rank(winner.stage)) winner.stage = next;
        }
      }
    }
  }

  // Teams that finished the group stage but never appear in a knockout fixture
  // are eliminated at the group stage (only decide this once all groups are done).
  const groupsComplete = groupFixtures > 0 && finishedGroupFixtures === groupFixtures;
  return { stages: out, groupsComplete, appearsInKnockout };
}

// --- Merge into the full results.json object ---
export function buildResults(fixtures, teamsMeta, nowISO = new Date().toISOString()) {
  const resolve = makeResolver(teamsMeta);
  // Group points include live, provisional scores ("as it stands").
  const groupStats = computeGroupStats(fixtures, resolve, true);
  // Stage / elimination only ever come from FINISHED matches — you can't be
  // knocked out mid-game, and a champion is only crowned at full-time.
  const { stages, groupsComplete, appearsInKnockout } = computeStages(fixtures, resolve);
  const liveTeams = liveTeamSet(fixtures, resolve);

  const teams = {};
  for (const code of Object.keys(teamsMeta)) {
    const base = groupStats[code] || blankStat();
    const st = stages[code];
    if (st) {
      base.stage = st.stage;
      base.eliminated = st.eliminated;
    } else if (groupsComplete && !appearsInKnockout.has(code)) {
      base.stage = "group";
      base.eliminated = true; // didn't make the knockouts
    }
    base.live = liveTeams.has(code); // currently playing -> provisional + highlight
    teams[code] = base;
  }

  return {
    lastUpdated: nowISO,
    demo: false,
    source: "api",
    anyLive: liveTeams.size > 0,
    teams,
  };
}
