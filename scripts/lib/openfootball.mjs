/* Adapter: openfootball/worldcup.json  ->  API-Football-shaped fixtures.
 *
 * We already have a fully-tested transform (transform.mjs) that turns
 * API-Football fixture objects into our results.json. Rather than duplicate all
 * that logic, this adapter converts openfootball's match objects into the SAME
 * shape, so the existing transform/buildResults can consume them unchanged.
 *
 * openfootball match shape (https://github.com/openfootball/worldcup.json):
 *   { round, date, time, team1, team2, group: "Group A",
 *     score: { ft: [t1, t2], ht: [...] }, ground }
 *   - A PLAYED match has `score.ft`; an unplayed one has no `score`.
 *   - Knockout rounds use round names like "Round of 16", "Quarter-finals",
 *     "Semi-finals", "Final"; group games use "Matchday N" + a `group` field.
 *   - This source has no live/in-progress concept: it's daily snapshots, so
 *     every converted match is either FINISHED or NOT-STARTED (never live).
 */

// Decide our round string from an openfootball match.
// Group games carry a `group` field and a "Matchday N" round; knockout games
// carry a descriptive round name we can map straight through.
function roundLabel(m) {
  if (m.group) return "Group Stage"; // transform.roundToStage -> "group"
  return m.round || ""; // "Round of 32" / "Round of 16" / "Quarter-finals" / "Semi-finals" / "Final"
}

// Convert one openfootball match into an API-Football-shaped fixture.
export function ofMatchToFixture(m) {
  const ft = m.score && Array.isArray(m.score.ft) ? m.score.ft : null;
  const played = ft != null && typeof ft[0] === "number" && typeof ft[1] === "number";

  let homeWinner = null, awayWinner = null;
  if (played) {
    if (ft[0] > ft[1]) { homeWinner = true; awayWinner = false; }
    else if (ft[1] > ft[0]) { homeWinner = false; awayWinner = true; }
    else {
      // Draw at full time. In knockouts openfootball records the shoot-out via a
      // 'pen'/'p' array; respect it so the right team advances.
      const pen = m.score && (m.score.pen || m.score.p);
      if (Array.isArray(pen)) {
        homeWinner = pen[0] > pen[1];
        awayWinner = pen[1] > pen[0];
      }
    }
  }

  return {
    fixture: { status: { short: played ? "FT" : "NS" } },
    league: { round: roundLabel(m) },
    teams: {
      home: { name: m.team1, winner: homeWinner },
      away: { name: m.team2, winner: awayWinner },
    },
    goals: { home: played ? ft[0] : null, away: played ? ft[1] : null },
  };
}

// Convert a whole openfootball document ({ name, matches: [...] }) into a
// fixture array our transform understands. Skips matches whose teams are still
// placeholders (e.g. "1A", "W73") — they have no real country names yet.
export function openfootballToFixtures(doc) {
  const matches = (doc && doc.matches) || [];
  return matches
    .filter((m) => m.team1 && m.team2 && !/^[0-9]/.test(m.team1) && !/^[WL]\d/.test(m.team1)
                                       && !/^[0-9]/.test(m.team2) && !/^[WL]\d/.test(m.team2))
    .map(ofMatchToFixture);
}
