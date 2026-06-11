/* Tests for the deterministic pick layer (outcome + fixed-anchor scoreline +
 * situational draw boost). Run: node scripts/wc/test/decide.test.mjs
 */
import { decidePick, computePicks, PICK_CONFIG } from "../lib/picks.mjs";

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error("  ✗ " + m));
const approx = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// --- anchors -----------------------------------------------------------------
{
  const d = decidePick({ HOME: 0.75, DRAW: 0.15, AWAY: 0.10 }, { expectedGoals: 2.4 });
  ok(d.pick === "HOME" && d.score.home === 2 && d.score.away === 0, "walkover (≥70%) → 2-0");
  ok(d.rule === "walkover", "walkover rule key");
}
// Tight win is gated on EXPECTED GOALS, not round.
{
  const d = decidePick({ HOME: 0.50, DRAW: 0.28, AWAY: 0.22 }, { expectedGoals: 2.2 });
  ok(d.pick === "HOME" && d.score.home === 1 && d.score.away === 0 && d.rule === "tight_low",
     "tight win, low goals → 1-0");
}
{
  const d = decidePick({ HOME: 0.50, DRAW: 0.28, AWAY: 0.22 }, { expectedGoals: 2.9 });
  ok(d.pick === "HOME" && d.score.home === 2 && d.score.away === 1 && d.rule === "tight_high",
     "tight win, more goals → 2-1");
}
{
  // Round no longer affects the tight-win scoreline — only goals do.
  const r1 = decidePick({ HOME: 0.50, DRAW: 0.28, AWAY: 0.22 }, { groupRound: 1, expectedGoals: 2.2 });
  ok(r1.rule === "tight_low", "round is ignored for the tight-win scoreline (goals decide)");
}

// --- orientation when the away team is the favourite -------------------------
{
  const d = decidePick({ HOME: 0.15, DRAW: 0.20, AWAY: 0.65 }, { expectedGoals: 2.2 });
  ok(d.pick === "AWAY" && d.score.home === 0 && d.score.away === 1, "away tight win, low goals → 0-1");
}
{
  const d = decidePick({ HOME: 0.10, DRAW: 0.12, AWAY: 0.78 }, { expectedGoals: 2.4 });
  ok(d.pick === "AWAY" && d.score.home === 0 && d.score.away === 2, "away walkover → 0-2");
}

// --- draw when incredibly tight ---------------------------------------------
{
  const d = decidePick({ HOME: 0.37, DRAW: 0.33, AWAY: 0.30 }, { expectedGoals: 2.2 });
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

// --- computePicks integration: raw probs shown, goals gate the scoreline -----
{
  const low = computePicks({ home: 1.55, draw: 3.9, away: 6.5 }, { line: 2.5, over: 1.95, under: 1.85 });
  ok(low.outcome.pick === "HOME", "e2e: favourite picked");
  ok(low.score.home === 1 && low.score.away === 0, "e2e: low-goals tight win → 1-0");
  ok(approx(low.probs.HOME + low.probs.DRAW + low.probs.AWAY, 1, 1e-9), "e2e: displayed probs are raw and sum to 1");
  ok(typeof low.reason === "string" && low.reason.length > 0, "e2e: reason string present");

  const high = computePicks({ home: 1.55, draw: 3.9, away: 6.5 }, { line: 3.5, over: 1.8, under: 2.0 });
  ok(high.score.home === 2 && high.score.away === 1, "e2e: high-goals tight win → 2-1");

  ok(computePicks(null) === null, "e2e: null odds → null");
}

// --- config is exposed for tuning -------------------------------------------
ok(PICK_CONFIG.draw_tight === 0.40 && PICK_CONFIG.walkover === 0.70 && PICK_CONFIG.tight_goals_split === 2.6,
   "config thresholds exposed (incl. tight_goals_split)");

console.log(`\n[decide.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
