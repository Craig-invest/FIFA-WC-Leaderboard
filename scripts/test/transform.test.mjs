/* Unit tests for the transform logic, run against a hand-built mock fixture
 * payload shaped like API-Football's /fixtures response. No network needed.
 * Run: npm test   (or: node scripts/test/transform.test.mjs)
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  buildResults, computeGroupStats, computeStages, makeResolver, roundToStage,
} from "../lib/transform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const teamsMeta = JSON.parse(readFileSync(join(root, "data/teams.json"))).teams;
const mock = JSON.parse(readFileSync(join(here, "fixtures/apifootball-sample.json")));
const fixtures = mock.response;

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   expected ${e}\n   got      ${a}`); }
}
function ok(cond, msg) { cond ? pass++ : (fail++, console.error(`FAIL: ${msg}`)); }

// --- name resolution ---
const resolve = makeResolver(teamsMeta);
eq(resolve("Korea Republic"), "KOR", "alias: Korea Republic -> KOR");
eq(resolve("Cote d'Ivoire"), "CIV", "alias: Cote d'Ivoire -> CIV");
eq(resolve("Czechia"), "CZE", "alias: Czechia -> CZE");
eq(resolve("Brazil"), "BRA", "exact name -> BRA");
eq(resolve("Atlantis"), null, "unknown -> null");

// --- round mapping ---
eq(roundToStage("Group Stage - 1"), "group", "round: group");
eq(roundToStage("Round of 32"), "r32", "round: r32");
eq(roundToStage("Round of 16"), "r16", "round: r16");
eq(roundToStage("Quarter-finals"), "qf", "round: qf");
eq(roundToStage("Semi-finals"), "sf", "round: sf");
eq(roundToStage("Final"), "final", "round: final");
eq(roundToStage("3rd Place Final"), null, "round: 3rd place ignored");

// --- group stats: Brazil beat SCO 3-0, drew MAR 1-1, beat HAI 2-0 -> 7pts ---
const gs = computeGroupStats(fixtures, resolve);
eq(gs.BRA, { p: 3, w: 2, d: 1, l: 0, gf: 6, ga: 1, pts: 7, stage: "group", eliminated: false }, "BRA group stats");
ok(gs.HAI.pts === 0 && gs.HAI.p === 3, "HAI played 3, 0 pts");

// --- stages & elimination ---
const { stages, groupsComplete } = computeStages(fixtures, resolve);
ok(groupsComplete === true, "groups complete in mock");
eq(stages.ARG?.stage, "champion", "ARG champion");
ok(stages.ARG?.eliminated === false, "champion not eliminated");
eq(stages.FRA?.stage, "final", "FRA reached final");
ok(stages.FRA?.eliminated === true, "FRA lost final -> eliminated");
eq(stages.BRA?.stage, "sf", "BRA reached semis");
ok(stages.BRA?.eliminated === true, "BRA lost semi -> eliminated");
eq(stages.SCO?.stage ?? "group", "group", "SCO never reached knockouts");

// --- full build: every team present, champion ranks correctly ---
const results = buildResults(fixtures, teamsMeta, "2026-07-19T22:00:00Z");
eq(Object.keys(results.teams).length, 48, "all 48 teams in results");
ok(results.demo === false, "live build marks demo=false");
eq(results.teams.ARG.stage, "champion", "built ARG champion");
eq(results.teams.SCO.eliminated, true, "SCO eliminated at group (no knockout appearance)");
ok(typeof results.teams.PAN?.pts === "number", "PAN has numeric stats even with no matches");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
