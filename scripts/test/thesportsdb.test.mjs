/* Tests for the TheSportsDB adapter: mock events -> fixtures -> buildResults.
 * Verifies status mapping, round mapping, score/winner parsing, penalty
 * shoot-outs, placeholder skipping, and end-to-end standings. Run: node this.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tsdbEventToFixture, tsdbToFixtures, tsdbRoundLabel, tsdbStatusShort } from "../lib/thesportsdb.mjs";
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

// --- status mapping ---
eq(tsdbStatusShort({ strStatus: "Match Finished", intHomeScore: "1", intAwayScore: "0" }), "FT", "Match Finished -> FT");
eq(tsdbStatusShort({ strStatus: "NS", intHomeScore: "", intAwayScore: "" }), "NS", "NS -> NS");
eq(tsdbStatusShort({ strStatus: "2H", intHomeScore: "1", intAwayScore: "1" }), "2H", "2H -> live");
eq(tsdbStatusShort({ strStatus: "", intHomeScore: "2", intAwayScore: "1" }), "FT", "scores present, no status -> FT");

// --- round mapping ---
eq(tsdbRoundLabel({ strStage: "Group A" }), "Group Stage", "group stage text");
eq(tsdbRoundLabel({ strStage: "Round of 16" }), "Round of 16", "r16 text");
eq(tsdbRoundLabel({ strRound: "Quarter-Final" }), "Quarter-finals", "qf text");
eq(tsdbRoundLabel({ intRound: "250" }), "Semi-finals", "round num 250 -> sf");
eq(tsdbRoundLabel({ intRound: "1" }), "Group Stage", "low round num -> group");

// --- single event conversion ---
const f = tsdbEventToFixture({
  strHomeTeam: "Mexico", strAwayTeam: "South Africa",
  intHomeScore: "2", intAwayScore: "0", strStatus: "Match Finished", strStage: "Group A",
});
eq(f.fixture.status.short, "FT", "MEX event finished");
eq(f.goals, { home: 2, away: 0 }, "MEX goals parsed");
ok(f.teams.home.winner === true, "MEX winner");

// --- penalty shoot-out in a knockout ---
const ko = tsdbEventToFixture({
  strHomeTeam: "Spain", strAwayTeam: "Uruguay", intHomeScore: "1", intAwayScore: "1",
  strStatus: "Match Finished", strStage: "Round of 16",
  strHomeTeamPenalty: "4", strAwayTeamPenalty: "2",
});
ok(ko.teams.home.winner === true && ko.teams.away.winner === false, "penalty winner respected");

// --- TBD teams skipped ---
eq(tsdbToFixtures({ events: [
  { strHomeTeam: "TBD", strAwayTeam: "TBD" },
  { strHomeTeam: "Mexico", strAwayTeam: "South Africa", intHomeScore: "2", intAwayScore: "0", strStatus: "Match Finished", strStage: "Group A" },
]}).length, 1, "TBD event skipped");

// --- end-to-end: day-1 results produce correct standings ---
const doc = { events: [
  { strHomeTeam: "Mexico", strAwayTeam: "South Africa", intHomeScore: "2", intAwayScore: "0", strStatus: "Match Finished", strStage: "Group A" },
  { strHomeTeam: "South Korea", strAwayTeam: "Czech Republic", intHomeScore: "1", intAwayScore: "1", strStatus: "Match Finished", strStage: "Group A" },
]};
const fixtures = tsdbToFixtures(doc);
eq(countPlayedHelper(fixtures), 2, "two played day-1 matches");
const results = buildResults(fixtures, teamsMeta, "2026-06-11T23:00:00Z");
eq(results.teams.MEX.pts, 3, "Mexico 3 pts (won)");
eq(results.teams.RSA.pts, 0, "South Africa 0 pts (lost)");
eq(results.teams.KOR.pts, 1, "Korea 1 pt (draw)");
eq(results.teams.CZE.pts, 1, "Czechia 1 pt (draw)");
eq(results.teams.MEX.gf, 2, "Mexico scored 2");
ok(results.teams.MEX.live === false, "finished match not live");

function countPlayedHelper(fx) { return fx.filter((f) => f.fixture.status.short !== "NS").length; }

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
