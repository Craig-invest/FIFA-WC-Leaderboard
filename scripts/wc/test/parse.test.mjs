/* Integration test for the odds-parsing layer, using a realistic mock of The
 * Odds API response (so we don't need the network). Run with:
 *   node scripts/wc/test/parse.test.mjs
 * Verifies: consensus across bookmakers, team-name resolution (incl. aliases),
 * stage detection, end-to-end pick attachment, and email-body rendering.
 */
import { buildTeamLookup, consensusOdds, buildMatch, emailHtml, knockoutPlaceholders } from "../fetch-odds.mjs";

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error("  ✗ " + m));
const approx = (a, b, e = 0.02) => Math.abs(a - b) <= e;

// Minimal team metadata incl. an alias ("Korea Republic" → South Korea).
const teamsMeta = {
  "Mexico": { flag: "🇲🇽", group: "A", aliases: [] },
  "South Korea": { flag: "🇰🇷", group: "A", aliases: ["Korea Republic"] },
};
const lut = buildTeamLookup(teamsMeta);

// A World Cup event with two bookmakers (shapes match The Odds API v4).
const event = {
  id: "evt123",
  commence_time: "2026-06-13T19:00:00Z",
  home_team: "Mexico",
  away_team: "Korea Republic",
  bookmakers: [
    {
      key: "bk1",
      markets: [
        { key: "h2h", outcomes: [
          { name: "Mexico", price: 2.0 },
          { name: "Korea Republic", price: 4.0 },
          { name: "Draw", price: 3.4 },
        ]},
        { key: "totals", outcomes: [
          { name: "Over", price: 1.9, point: 2.5 },
          { name: "Under", price: 1.9, point: 2.5 },
        ]},
      ],
    },
    {
      key: "bk2",
      markets: [
        { key: "h2h", outcomes: [
          { name: "Mexico", price: 2.2 },
          { name: "Korea Republic", price: 3.8 },
          { name: "Draw", price: 3.6 },
        ]},
        { key: "totals", outcomes: [
          { name: "Over", price: 2.0, point: 2.5 },
          { name: "Under", price: 1.8, point: 2.5 },
        ]},
      ],
    },
  ],
};

// --- consensus averaging ---
const c = consensusOdds(event);
ok(approx(c.home, 2.1), `consensus home odds ~2.1 (got ${c.home})`);
ok(approx(c.away, 3.9), `consensus away odds ~3.9 (got ${c.away})`);
ok(approx(c.draw, 3.5), `consensus draw odds ~3.5 (got ${c.draw})`);
ok(c.totalsLine === 2.5, "totals main line is 2.5");
ok(c.books === 2, "counts both bookmakers");

// --- consensus returns null if a market is missing ---
ok(consensusOdds({ home_team: "A", away_team: "B", bookmakers: [] }) === null,
   "no bookmakers → null (won't fabricate odds)");

// --- buildMatch: resolution, alias, stage, picks ---
const m = buildMatch(event, lut);
ok(m.home === "Mexico" && m.homeFlag === "🇲🇽", "home resolved with flag");
ok(m.away === "South Korea" && m.awayFlag === "🇰🇷", "away alias 'Korea Republic' → South Korea + flag");
ok(m.stage === "Group A", "same group → 'Group A'");
ok(m.id === "evt123" && m.commenceTime === event.commence_time, "carries id + kickoff");
ok(m.predictBy && new Date(m.commenceTime) - new Date(m.predictBy) === 48 * 3600e3,
   "predictBy is exactly 48h before kickoff");
ok(["HOME", "DRAW", "AWAY"].includes(m.pick.outcome.pick), "a valid outcome is suggested");
ok(approx(m.pick.probs.HOME + m.pick.probs.DRAW + m.pick.probs.AWAY, 1), "attached probs sum to 1");
ok(Number.isInteger(m.pick.score.home) && Number.isInteger(m.pick.score.away), "integer suggested score");
ok(m.oddsReady === true && m.group === "A", "real game is oddsReady with its group");

// --- knockout placeholders ---
const koFile = { matches: [
  { id: "ko-73", matchNo: 73, stageCode: "r32", stageLabel: "Round of 32", windowLabel: "28 Jun – 3 Jul", sortDate: "2026-06-28T12:00:00Z" },
  { id: "ko-104", matchNo: 104, stageCode: "final", stageLabel: "Final", windowLabel: "19 Jul", sortDate: "2026-07-19T12:00:00Z" },
]};
const phNone = knockoutPlaceholders(koFile, [m]); // m is a group game → all KO placeholders kept
ok(phNone.length === 2, "knockout placeholders generated when no KO odds exist");
ok(phNone[0].oddsReady === false && phNone[0].pick === null && phNone[0].tbd === true, "placeholder is TBD, no odds, no pick");
ok(phNone[0].home === "TBD" && phNone[0].windowLabel === "28 Jun – 3 Jul", "placeholder carries TBD teams + window label");

const r32Real = { ...m, stage: "Round of 32", oddsReady: true };
const phDrop = knockoutPlaceholders(koFile, [r32Real]); // a real R32 game exists → drop R32 placeholders
ok(phDrop.length === 1 && phDrop[0].stage === "Final", "a round's placeholders drop once its real games arrive");

// --- email body renders the match ---
const html = emailHtml([m]);
ok(html.includes("Mexico") && html.includes("South Korea"), "email lists both teams");
ok(html.includes("Suggested score"), "email shows a suggested score");
ok(html.includes("1 game to predict"), "email header pluralises correctly (1 game)");

console.log(`\n[parse.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
