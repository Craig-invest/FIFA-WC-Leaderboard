/* Adapter: TheSportsDB events  ->  API-Football-shaped fixtures.
 *
 * Reuses our tested transform.mjs by converting TheSportsDB's event objects into
 * the same shape API-Football uses. Source (free key "123"):
 *   https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=4429&s=2025-2026
 *   (league 4429 = FIFA World Cup; season is labelled "2025-2026")
 *
 * TheSportsDB event fields we rely on:
 *   strHomeTeam, strAwayTeam        - full country names
 *   intHomeScore, intAwayScore      - final score (string/number, or null/"" if unplayed)
 *   strStatus                       - "Match Finished" / "FT" / "NS" / "1H" / "2H" / "HT" / "Live" ...
 *   strHomeTeamPenalty/AwayPenalty  - shoot-out scores in knockouts (when present)
 *   intRound                        - round number; for WC: group rounds are low numbers,
 *                                     knockouts use high "magic" numbers (125/150/200/...).
 *                                     We prefer the textual round if present.
 *   strRound / strStage             - sometimes carries "Group Stage"/"Round of 16" etc.
 */

// TheSportsDB statuses that mean the match is over.
const FINISHED_STATUS = new Set(["match finished", "ft", "aet", "pen", "finished", "fulltime", "full time"]);
// In-play statuses (some are only on the premium livescore feed, but harmless to support).
const LIVE_STATUS = new Set(["1h", "2h", "ht", "et", "live", "in play", "playing", "1st half", "2nd half", "half time"]);

function norm(s) { return String(s || "").trim().toLowerCase(); }
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// TheSportsDB's numeric round -> our round label. The WC feed uses high numbers
// for knockouts; map the common ones, otherwise treat as a group match.
const ROUND_NUM_TO_LABEL = {
  "125": "Round of 32",
  "150": "Round of 16",
  "200": "Quarter-finals",
  "250": "Semi-finals",
  "300": "Final",        // some seasons use 300 for final
  "350": "Final",
};

// Decide our round label for a TheSportsDB event, preferring textual hints.
export function tsdbRoundLabel(ev) {
  const text = norm(ev.strStage || ev.strRound);
  if (text) {
    if (text.includes("group")) return "Group Stage";
    if (text.includes("32")) return "Round of 32";
    if (text.includes("16")) return "Round of 16";
    if (text.includes("quarter")) return "Quarter-finals";
    if (text.includes("semi")) return "Semi-finals";
    if (text.includes("3rd") || text.includes("third")) return "3rd Place";
    if (text.includes("final")) return "Final";
  }
  const byNum = ROUND_NUM_TO_LABEL[String(ev.intRound)];
  if (byNum) return byNum;
  // Low round numbers (1,2,3...) on the WC feed are the three group matchdays.
  return "Group Stage";
}

export function tsdbStatusShort(ev) {
  const s = norm(ev.strStatus);
  if (FINISHED_STATUS.has(s)) return "FT";
  if (LIVE_STATUS.has(s)) return "2H"; // any live -> a live status transform understands
  // Fallback: if both scores are present and it's not explicitly live, treat as finished.
  if (numOrNull(ev.intHomeScore) !== null && numOrNull(ev.intAwayScore) !== null && s !== "ns" && s !== "not started") {
    return "FT";
  }
  return "NS";
}

export function tsdbEventToFixture(ev) {
  const short = tsdbStatusShort(ev);
  const hs = numOrNull(ev.intHomeScore);
  const as = numOrNull(ev.intAwayScore);
  const decided = short === "FT" && hs !== null && as !== null;

  let homeWinner = null, awayWinner = null;
  if (decided) {
    if (hs > as) { homeWinner = true; awayWinner = false; }
    else if (as > hs) { homeWinner = false; awayWinner = true; }
    else {
      const hp = numOrNull(ev.strHomeTeamPenalty ?? ev.intHomeTeamPenalty);
      const ap = numOrNull(ev.strAwayTeamPenalty ?? ev.intAwayTeamPenalty);
      if (hp !== null && ap !== null) { homeWinner = hp > ap; awayWinner = ap > hp; }
    }
  }

  return {
    fixture: { status: { short } },
    league: { round: tsdbRoundLabel(ev) },
    teams: {
      home: { name: ev.strHomeTeam, winner: homeWinner },
      away: { name: ev.strAwayTeam, winner: awayWinner },
    },
    goals: { home: short === "NS" ? null : hs, away: short === "NS" ? null : as },
  };
}

// Convert a TheSportsDB events payload ({ events: [...] }) into fixtures.
// Skips events without two real team names.
export function tsdbToFixtures(doc) {
  const events = (doc && doc.events) || [];
  return events
    .filter((e) => e.strHomeTeam && e.strAwayTeam
              && !/^(tbd|to be decided)$/i.test(e.strHomeTeam.trim())
              && !/^(tbd|to be decided)$/i.test(e.strAwayTeam.trim()))
    .map(tsdbEventToFixture);
}
