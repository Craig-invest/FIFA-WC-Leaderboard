/* Tests for the deterministic pick layer (outcome + fixed-anchor scoreline +
 * situational draw boost). Run: node scripts/wc/test/decide.test.mjs
 */
import { decidePick, computePicks, PICK_CONFIG } from "../lib/picks.mjs";

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error("  ✗ " + m));
const approx = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// --- anchors -----------------------------------------------------------------
{
  const d = decidePick({ HOME: 0.75, DRAW: 0.15, AWAY: 0.10 }, { groupRound: 2 });
  ok(d.pick === "HOME" && d.score.home === 2 && d.score.away === 0, "walkover (≥70%) → 2-0");
  ok(d.rule === "walkover", "walkover rule key");
}
// Tight win uses the stage's historic modal score: 2-1 in round 1, 1-0 onward.
{
  const d = decidePick({ HOME: 0.50, DRAW: 0.28, AWAY: 0.22 }, { groupRound: 1 });
  ok(d.pick === "HOME" && d.score.home === 2 && d.score.away === 1 && d.rule === "tight_r1",
     "tight win, round 1 → 2-1");
}
{
  const d = decidePick({ HOME: 0.50, DRAW: 0.28, AWAY: 0.22 }, { groupRound: 2 });
  ok(d.pick === "HOME" && d.score.home === 1 && d.score.away === 0 && d.rule === "tight_other",
     "tight win, round 2 → 1-0");
}
{
  const d = decidePick({ HOME: 0.50, DRAW: 0.28, AWAY: 0.22 }, { groupRound: "KO" });
  ok(d.score.home === 1 && d.score.away === 0 && d.rule === "tight_other", "tight win, knockout → 1-0");
}

// --- orientation when the away team is the favourite -------------------------
{
  const d = decidePick({ HOME: 0.15, DRAW: 0.20, AWAY: 0.65 }, { groupRound: 2 });
  ok(d.pick === "AWAY" && d.score.home === 0 && d.score.away === 1, "away tight win (round 2+) → 0-1");
}
{
  const d = decidePick({ HOME: 0.10, DRAW: 0.12, AWAY: 0.78 }, { groupRound: 1 });
  ok(d.pick === "AWAY" && d.score.home === 0 && d.score.away === 2, "away walkover → 0-2");
}

// --- draw when incredibly tight ---------------------------------------------
{
  const d = decidePick({ HOME: 0.37, DRAW: 0.33, AWAY: 0.30 }, { groupRound: 2 });
  ok(d.pick === "DRAW" && d.score.home === 1 && d.score.away === 1 && d.rule === "draw", "favourite < 40% → draw 1-1");
}

// --- situational draw boost (round 3, draw advances both) --------------------
{
  const base = { HOME: 0.42, DRAW: 0.33, AWAY: 0.25 };
  const noBoost = decidePick(base, { groupRound: 3, drawAdvancesBoth: false });
  ok(noBoost.pick === "HOME", "without boost a 42% favourite is still a win");
  const boosted = decidePick(base, { groupRound: 3, drawAdvancesBoth: true });
  ok(boosted.boosted === true, "boost flag set");
  ok(boosted.pick === "DRAW", "boost tips a borderline game to a draw");
  ok(approx(boosted.probs.HOME + boosted.probs.DRAW + boosted.probs.AWAY, 1), "boosted probs still sum to 1");
  ok(boosted.rule === "draw_boost", "boost noted via rule key");
}
{
  // Boost only applies in round 3.
  const d = decidePick({ HOME: 0.42, DRAW: 0.33, AWAY: 0.25 }, { groupRound: 2, drawAdvancesBoth: true });
  ok(d.boosted === false && d.pick === "HOME", "boost ignored outside round 3");
}

// --- computePicks integration: raw probs shown, round gates the scoreline ----
{
  const r1 = computePicks({ home: 1.55, draw: 3.9, away: 6.5 }, { line: 2.5, over: 1.95, under: 1.85 }, { groupRound: 1 });
  ok(r1.outcome.pick === "HOME", "e2e: favourite picked");
  ok(r1.score.home === 2 && r1.score.away === 1, "e2e: round-1 tight win → 2-1");
  ok(approx(r1.probs.HOME + r1.probs.DRAW + r1.probs.AWAY, 1, 1e-9), "e2e: displayed probs are raw and sum to 1");
  ok(typeof r1.reason === "string" && r1.reason.length > 0, "e2e: reason string present");

  const ko = computePicks({ home: 1.55, draw: 3.9, away: 6.5 }, { line: 2.5, over: 1.95, under: 1.85 }, { groupRound: "KO" });
  ok(ko.score.home === 1 && ko.score.away === 0, "e2e: knockout tight win → 1-0");

  ok(computePicks(null) === null, "e2e: null odds → null");
}

// --- config is exposed for tuning -------------------------------------------
ok(PICK_CONFIG.draw_tight === 0.40 && PICK_CONFIG.walkover === 0.70, "config thresholds exposed");

console.log(`\n[decide.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
