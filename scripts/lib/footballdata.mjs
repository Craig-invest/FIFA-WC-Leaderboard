/* Adapter: football-data.org v4  ->  API-Football-shaped fixtures.
 *
 * Reuses our tested transform.mjs by converting football-data.org match objects
 * into the same shape API-Football uses. Source (free tier, token required):
 *   GET https://api.football-data.org/v4/competitions/WC/matches
 *   header: X-Auth-Token: <your free token>
 *   (competition code "WC" = FIFA World Cup; free tier covers it, ~prompt
 *    finished-result updates, no live in-play scores.)
 *
 * football-data.org match fields we rely on:
 *   status   - SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | SUSPENDED |
 *              POSTPONED | CANCELLED | AWARDED
 *   stage    - GROUP_STAGE | LAST_32 | LAST_16 | QUARTER_FINALS | SEMI_FINALS |
 *              THIRD_PLACE | FINAL
 *   group    - e.g. "GROUP_A" (group games only)
 *   homeTeam.name / awayTeam.name   - full country names
 *   score.winner                    - HOME_TEAM | AWAY_TEAM | DRAW | null
 *   score.fullTime.{home,away}      - integers or null
 *   score.penalties.{home,away}     - shoot-out (knockouts), when present
 */

const FINISHED_STATUS = new Set(["FINISHED", "AWARDED"]);
const LIVE_STATUS = new Set(["IN_PLAY", "PAUSED"]);

// football-data stage -> our round label (transform.roundToStage understands these).
const STAGE_TO_ROUND = {
  GROUP_STAGE: "Group Stage",
  LAST_32: "Round of 32",
  LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals",
  THIRD_PLACE: "3rd Place",
  FINAL: "Final",
};

export function fdRoundLabel(m) {
  return STAGE_TO_ROUND[m.stage] || (m.group ? "Group Stage" : "");
}

export function fdStatusShort(m) {
  if (FINISHED_STATUS.has(m.status)) return "FT";
  if (LIVE_STATUS.has(m.status)) return "2H"; // a live status our transform understands
  return "NS";
}

function num(v) { return typeof v === "number" ? v : null; }

export function fdMatchToFixture(m) {
  const short = fdStatusShort(m);
  const ft = m.score && m.score.fullTime ? m.score.fullTime : {};
  const hs = num(ft.home);
  const as = num(ft.away);
  const decided = short === "FT" && hs !== null && as !== null;

  let homeWinner = null, awayWinner = null;
  if (decided) {
    const w = m.score && m.score.winner;
    if (w === "HOME_TEAM") { homeWinner = true; awayWinner = false; }
    else if (w === "AWAY_TEAM") { homeWinner = false; awayWinner = true; }
    else if (hs > as) { homeWinner = true; awayWinner = false; }
    else if (as > hs) { homeWinner = false; awayWinner = true; }
    else {
      // Draw at full time: decide on penalties if present (knockout ties).
      const pen = m.score && m.score.penalties;
      if (pen && typeof pen.home === "number" && typeof pen.away === "number") {
        homeWinner = pen.home > pen.away;
        awayWinner = pen.away > pen.home;
      }
    }
  }

  return {
    fixture: { status: { short } },
    league: { round: fdRoundLabel(m) },
    teams: {
      home: { name: m.homeTeam && m.homeTeam.name, winner: homeWinner },
      away: { name: m.awayTeam && m.awayTeam.name, winner: awayWinner },
    },
    goals: { home: short === "NS" ? null : hs, away: short === "NS" ? null : as },
  };
}

// Convert a football-data.org payload ({ matches: [...] }) into fixtures.
// Skips matches without two real named teams (e.g. unresolved knockout slots).
export function footballdataToFixtures(doc) {
  const matches = (doc && doc.matches) || [];
  return matches
    .filter((m) => m.homeTeam && m.awayTeam && m.homeTeam.name && m.awayTeam.name)
    .map(fdMatchToFixture);
}
