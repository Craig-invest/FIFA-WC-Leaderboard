/* Tests for the openfootball adapter: a mock openfootball doc -> fixtures ->
 * buildResults, checking group maths, stage progression, elimination, champion,
 * placeholder skipping, and the not-live guarantee. Run: node this-file.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { openfootballToFixtures, ofMatchToFixture } from "../lib/openfootball.mjs";
import { buildResults } from "../lib/transform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const teamsMeta = JSON.parse(readFileSync(join(root, "data/teams.json"))).teams;

let pass = 0, fail = 0;
function eq(a, e, msg) {
  if (JSON.stringify(a) === JSON.stringify(e)) pass++;
  else { fail++; console.error(`FAIL: ${msg}\n  expected ${JSON.stringify(e)}\n  got      ${JSON.stringify(a)}`); }
}
function ok(c, msg) { c ? pass++ : (fail++, console.error(`FAIL: ${msg}`)); }

// --- single match conversion ---
const f = ofMatchToFixture({
  round: "Matchday 1", group: "Group C", team1: "Brazil", team2: "Scotland",
  score: { ft: [3, 0], ht: [1, 0] },
});
eq(f.fixture.status.short, "FT", "played match -> FT");
eq(f.goals, { home: 3, away: 0 }, "goals mapped");
ok(f.teams.home.winner === true && f.teams.away.winner === false, "winner flags set");

const unplayed = ofMatchToFixture({ round: "Matchday 3", group: "Group C", team1: "Brazil", team2: "Haiti" });
eq(unplayed.fixture.status.short, "NS", "no score -> NS");
ok(unplayed.goals.home === null, "unplayed has null goals");

// --- knockout shoot-out: draw decided on penalties ---
const ko = ofMatchToFixture({
  round: "Round of 16", team1: "Spain", team2: "Uruguay",
  score: { ft: [1, 1], pen: [4, 2] },
});
ok(ko.teams.home.winner === true && ko.teams.away.winner === false, "penalty winner respected");

// --- placeholder teams skipped ---
const fixturesSkip = openfootballToFixtures({ matches: [
  { round: "Round of 16", team1: "1A", team2: "2B" },           // placeholders -> skip
  { round: "Matchday 1", group: "Group C", team1: "Brazil", team2: "Scotland", score: { ft: [3, 0] } },
]});
eq(fixturesSkip.length, 1, "placeholder match skipped, real one kept");

// --- full mini-tournament -> buildResults ---
const doc = { name: "WC 2026", matches: [
  // Group C complete
  { round: "Matchday 1", group: "Group C", team1: "Brazil", team2: "Scotland", score: { ft: [3, 0] } },
  { round: "Matchday 1", group: "Group C", team1: "Morocco", team2: "Haiti", score: { ft: [1, 0] } },
  { round: "Matchday 2", group: "Group C", team1: "Brazil", team2: "Morocco", score: { ft: [1, 1] } },
  { round: "Matchday 2", group: "Group C", team1: "Scotland", team2: "Haiti", score: { ft: [2, 1] } },
  { round: "Matchday 3", group: "Group C", team1: "Brazil", team2: "Haiti", score: { ft: [2, 0] } },
  { round: "Matchday 3", group: "Group C", team1: "Morocco", team2: "Scotland", score: { ft: [0, 0] } },
  // a knockout bracket
  { round: "Semi-finals", team1: "Argentina", team2: "Spain", score: { ft: [2, 0] } },
  { round: "Semi-finals", team1: "France", team2: "Brazil", score: { ft: [1, 0] } },
  { round: "Final", team1: "Argentina", team2: "France", score: { ft: [3, 1] } },
]};
const results = buildResults(openfootballToFixtures(doc), teamsMeta, "2026-07-19T22:00:00Z");

eq(Object.keys(results.teams).length, 48, "all 48 teams present");
ok(results.anyLive === false, "openfootball never produces live matches");
// Brazil: W(3-0) D(1-1) W(2-0) = 7 pts, reached SF then lost -> eliminated at sf
eq(results.teams.BRA.pts, 7, "Brazil 7 group pts");
eq(results.teams.BRA.stage, "sf", "Brazil reached semis");
ok(results.teams.BRA.eliminated === true, "Brazil knocked out in semi");
eq(results.teams.ARG.stage, "champion", "Argentina champions");
ok(results.teams.ARG.eliminated === false, "champion not eliminated");
eq(results.teams.FRA.stage, "final", "France runners-up");
ok(results.teams.FRA.eliminated === true, "France lost final");
ok(results.teams.BRA.live === false, "no live flag from openfootball");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
