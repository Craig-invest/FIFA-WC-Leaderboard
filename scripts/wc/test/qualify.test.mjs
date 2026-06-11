/* Tests for group standings + the round-3 "draw advances both" check.
 * Run: node scripts/wc/test/qualify.test.mjs
 */
import { buildStandings, drawAdvancesBoth } from "../lib/qualify.mjs";

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error("  ✗ " + m));

const teamsMeta = {
  AAA: { name: "Alpha", group: "A" },
  BBB: { name: "Bravo", group: "A" },
  CCC: { name: "Charlie", group: "A" },
  DDD: { name: "Delta", group: "A" },
};
const fx = (round, home, away, hg, ag) => ({
  fixture: { status: { short: "FT" } },
  league: { round: `Group Stage - ${round}` },
  teams: { home: { name: home }, away: { name: away } },
  goals: { home: hg, away: ag },
});

// --- buildStandings derives points/GD and groups the teams -------------------
{
  const fixtures = [fx(1, "Alpha", "Charlie", 2, 0), fx(1, "Bravo", "Delta", 1, 1)];
  const s = buildStandings(fixtures, teamsMeta);
  ok(s.byCode.AAA.pts === 3 && s.byCode.AAA.gd === 2 && s.byCode.AAA.p === 1, "winner gets 3 pts + GD");
  ok(s.byCode.CCC.pts === 0 && s.byCode.CCC.gd === -2, "loser 0 pts, negative GD");
  ok(s.byCode.BBB.pts === 1 && s.byCode.DDD.pts === 1, "draw gives both 1 pt");
  ok(s.groups.A.length === 4, "group A has 4 teams");
}

// --- drawAdvancesBoth -------------------------------------------------------
// After two rounds: Alpha & Bravo well clear; Charlie/Delta can't catch them.
const clear = {
  byCode: {
    AAA: { pts: 4, gd: 3, gf: 5, p: 2, group: "A" },
    BBB: { pts: 4, gd: 2, gf: 4, p: 2, group: "A" },
    CCC: { pts: 1, gd: -2, gf: 1, p: 2, group: "A" },
    DDD: { pts: 0, gd: -3, gf: 0, p: 2, group: "A" },
  },
  groups: { A: ["AAA", "BBB", "CCC", "DDD"] },
};
ok(drawAdvancesBoth("AAA", "BBB", clear) === true, "leaders: a draw guarantees both top-2 → true");
ok(drawAdvancesBoth("CCC", "DDD", clear) === false, "tail pair: a draw can't send both through → false");

// Tighter table: a draw does NOT guarantee both (a chasing team can overtake).
const tight = {
  byCode: {
    AAA: { pts: 4, gd: 1, gf: 3, p: 2, group: "A" },
    BBB: { pts: 3, gd: 0, gf: 2, p: 2, group: "A" },
    CCC: { pts: 3, gd: 0, gf: 2, p: 2, group: "A" },
    DDD: { pts: 1, gd: -1, gf: 1, p: 2, group: "A" },
  },
  groups: { A: ["AAA", "BBB", "CCC", "DDD"] },
};
// Alpha+Bravo draw → both 5/4 pts; the other game is Charlie(3) v Delta(1):
// if Charlie wins he reaches 6 > Bravo's 4, so Bravo isn't guaranteed → false.
ok(drawAdvancesBoth("AAA", "BBB", tight) === false, "tight table: not guaranteed → false");

// Guard: only assessed once both teams have played two games.
const early = {
  byCode: {
    AAA: { pts: 3, gd: 2, gf: 2, p: 1, group: "A" },
    BBB: { pts: 3, gd: 2, gf: 2, p: 1, group: "A" },
    CCC: { pts: 0, gd: -2, gf: 0, p: 1, group: "A" },
    DDD: { pts: 0, gd: -2, gf: 0, p: 1, group: "A" },
  },
  groups: { A: ["AAA", "BBB", "CCC", "DDD"] },
};
ok(drawAdvancesBoth("AAA", "BBB", early) === false, "before round 3 (p<2) → false");

console.log(`\n[qualify.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
