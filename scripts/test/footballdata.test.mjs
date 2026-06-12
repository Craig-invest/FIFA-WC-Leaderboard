/* Tests for the football-data.org adapter: mock matches -> fixtures ->
 * buildResults. Verifies status/stage mapping, winner + penalty parsing,
 * placeholder skipping, and end-to-end standings. Run: node this-file.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { fdMatchToFixture, footballdataToFixtures, fdRoundLabel, fdStatusShort } from "../lib/footballdata.mjs";
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

// --- status + stage mapping ---
eq(fdStatusShort({ status: "FINISHED" }), "FT", "FINISHED -> FT");
eq(fdStatusShort({ status: "IN_PLAY" }), "2H", "IN_PLAY -> live");
eq(fdStatusShort({ status: "TIMED" }), "NS", "TIMED -> NS");
eq(fdRoundLabel({ stage: "GROUP_STAGE", group: "GROUP_A" }), "Group Stage", "group stage");
eq(fdRoundLabel({ stage: "LAST_16" }), "Round of 16", "last 16");
eq(fdRoundLabel({ stage: "QUARTER_FINALS" }), "Quarter-finals", "QF");
eq(fdRoundLabel({ stage: "FINAL" }), "Final", "final");

// --- single match conversion ---
const f = fdMatchToFixture({
  status: "FINISHED", stage: "GROUP_STAGE", group: "GROUP_A",
  homeTeam: { name: "Mexico" }, awayTeam: { name: "South Africa" },
  score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } },
});
eq(f.fixture.status.short, "FT", "finished match");
eq(f.goals, { home: 2, away: 0 }, "goals parsed");
ok(f.teams.home.winner === true && f.teams.away.winner === false, "winner from score.winner");

// --- unplayed match ---
const ns = fdMatchToFixture({ status: "TIMED", stage: "GROUP_STAGE",
  homeTeam: { name: "Brazil" }, awayTeam: { name: "Haiti" }, score: { fullTime: { home: null, away: null } } });
eq(ns.goals, { home: null, away: null }, "unplayed -> null goals");

// --- knockout decided on penalties ---
const ko = fdMatchToFixture({
  status: "FINISHED", stage: "LAST_16",
  homeTeam: { name: "Spain" }, awayTeam: { name: "Uruguay" },
  score: { winner: "DRAW", fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 2 } },
});
ok(ko.teams.home.winner === true && ko.teams.away.winner === false, "penalty winner respected");

// --- skip matches without resolved teams ---
eq(footballdataToFixtures({ matches: [
  { status: "TIMED", stage: "LAST_16", homeTeam: { name: null }, awayTeam: { name: null } },
  f && { status: "FINISHED", stage: "GROUP_STAGE", homeTeam: { name: "Mexico" }, awayTeam: { name: "South Africa" }, score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } } },
]}).length, 1, "unresolved-team match skipped");

// --- end-to-end day-1 standings ---
const doc = { matches: [
  { status: "FINISHED", stage: "GROUP_STAGE", group: "GROUP_A", homeTeam: { name: "Mexico" }, awayTeam: { name: "South Africa" }, score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } } },
  { status: "FINISHED", stage: "GROUP_STAGE", group: "GROUP_A", homeTeam: { name: "South Korea" }, awayTeam: { name: "Czech Republic" }, score: { winner: "DRAW", fullTime: { home: 1, away: 1 } } },
]};
const results = buildResults(footballdataToFixtures(doc), teamsMeta, "2026-06-11T23:00:00Z");
eq(results.teams.MEX.pts, 3, "Mexico 3 pts");
eq(results.teams.RSA.pts, 0, "South Africa 0 pts");
eq(results.teams.KOR.pts, 1, "Korea 1 pt");
eq(results.teams.CZE.pts, 1, "Czechia 1 pt");
ok(results.teams.MEX.live === false, "finished match not live");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
