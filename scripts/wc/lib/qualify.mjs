/* qualify.mjs — group standings + the round-3 "a draw sends both teams through"
 * check that gates the situational draw boost.
 *
 * Pure functions (no network/fs). Reuses the leaderboard's tested, pure helpers
 * (computeGroupStats, makeResolver) so the two tools share one source of truth
 * for standings maths — backend reuse only, no user-facing link between pages.
 *
 * Deliberate simplification (agreed): "advances both" means both teams are
 * GUARANTEED a top-2 finish after a hypothetical draw, across every result of
 * the group's other round-3 game. We ignore the 2026 "best third-placed" rule
 * (it depends on other groups and isn't knowable at kickoff), so the check is
 * conservative — it only fires when a draw clearly sends both through.
 */
import { computeGroupStats, makeResolver } from "../../lib/transform.mjs";

// Build per-team group standings from FINISHED group fixtures.
// teamsMeta: { CODE: { name, flag, group } } (the leaderboard's data/teams.json).
export function buildStandings(fixtures, teamsMeta) {
  const resolve = makeResolver(teamsMeta);
  const stats = computeGroupStats(fixtures, resolve, false); // finished only — no live
  const byCode = {};
  const groups = {};
  for (const [code, meta] of Object.entries(teamsMeta)) {
    const s = stats[code] || { p: 0, gf: 0, ga: 0, pts: 0 };
    byCode[code] = { pts: s.pts || 0, gd: (s.gf || 0) - (s.ga || 0), gf: s.gf || 0, p: s.p || 0, group: meta.group };
    (groups[meta.group] ||= []).push(code);
  }
  return { byCode, groups };
}

// Compare two standing keys: >0 if a ranks above b (pts, then GD, then GF).
const cmpKey = (a, b) => (a.pts - b.pts) || (a.gd - b.gd) || (a.gf - b.gf);

// Conservatively guaranteed top-2: at most ONE other team is as-good-or-better.
// (Ties count against the target, so a boundary tie ⇒ not guaranteed.)
function guaranteedTop2(targetCode, table) {
  const t = table.find((x) => x.code === targetCode);
  const atLeastAsGood = table.filter((x) => x.code !== targetCode && cmpKey(x, t) >= 0).length;
  return atLeastAsGood <= 1;
}

/**
 * Would a draw in this round-3 group game send BOTH teams through (top-2),
 * whatever the group's other game does?
 * @param {string} homeCode @param {string} awayCode  3-letter codes
 * @param {{byCode:object, groups:object}} standings  from buildStandings
 */
export function drawAdvancesBoth(homeCode, awayCode, standings) {
  const { byCode, groups } = standings;
  const h = byCode[homeCode], a = byCode[awayCode];
  if (!h || !a || h.group !== a.group) return false;
  const members = groups[h.group] || [];
  if (members.length !== 4) return false;
  if (h.p < 2 || a.p < 2) return false; // only meaningful once both have played 2

  const others = members.filter((c) => c !== homeCode && c !== awayCode);
  if (others.length !== 2) return false;
  const [o1, o2] = others;

  // Keys after a hypothetical draw (+1 each); GD/GF held flat (a 1-1 leaves GD
  // unchanged, and GF ties only ever count against us — conservative).
  const key = (code, addPts) => ({ code, pts: byCode[code].pts + addPts, gd: byCode[code].gd, gf: byCode[code].gf });
  const hKey = key(homeCode, 1), aKey = key(awayCode, 1);

  // The other game's three possible outcomes.
  const scenarios = [
    [key(o1, 3), key(o2, 0)],
    [key(o1, 1), key(o2, 1)],
    [key(o1, 0), key(o2, 3)],
  ];

  for (const [k1, k2] of scenarios) {
    const table = [hKey, aKey, k1, k2];
    if (!guaranteedTop2(homeCode, table) || !guaranteedTop2(awayCode, table)) return false;
  }
  return true;
}
