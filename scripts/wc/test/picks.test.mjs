/* Unit tests for the pick logic. Run with:  node scripts/wc/test/picks.test.mjs
 * No network, no files — pure maths, so it's safe to run in CI on every push.
 */
import {
  impliedProb, devig1x2, suggestOutcome, confidenceLabel,
  estimateTotalGoals, fitLambdas, suggestScore, computePicks,
} from "../lib/picks.mjs";

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ " + msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// --- implied probability ---
ok(approx(impliedProb(2.0), 0.5), "impliedProb(2.0) === 0.5");
ok(impliedProb(0) === 0, "impliedProb(0) === 0 (guards bad input)");

// --- de-vig sums to 1 and keeps ordering ---
{
  const p = devig1x2({ home: 1.5, draw: 4.0, away: 7.0 });
  ok(approx(p.HOME + p.DRAW + p.AWAY, 1), "devig probabilities sum to 1");
  ok(p.HOME > p.DRAW && p.DRAW > p.AWAY, "devig preserves favourite ordering");
  ok(p.overround > 1, "overround (margin) is > 1");
}

// --- confidence labels ---
ok(confidenceLabel(0.7) === "Strong", "0.70 → Strong");
ok(confidenceLabel(0.45) === "Lean", "0.45 → Lean");
ok(confidenceLabel(0.33) === "Toss-up", "0.33 → Toss-up");

// --- suggested outcome picks the favourite ---
{
  const probs = devig1x2({ home: 1.3, draw: 5.5, away: 9.0 });
  const o = suggestOutcome(probs);
  ok(o.pick === "HOME", "strong home favourite → pick HOME");
  ok(o.confidence === "Strong", "strong home favourite → Strong confidence");
}
{
  const probs = devig1x2({ home: 9.0, draw: 5.5, away: 1.3 });
  ok(suggestOutcome(probs).pick === "AWAY", "strong away favourite → pick AWAY");
}

// --- totals estimate responds to the market ---
{
  const balanced = estimateTotalGoals({ line: 2.5, over: 1.9, under: 1.9 });
  ok(approx(balanced, 2.5, 0.05), "balanced over/under → ~line");
  const overHeavy = estimateTotalGoals({ line: 2.5, over: 1.5, under: 2.6 });
  ok(overHeavy > 2.5, "over-leaning market → more goals than the line");
  ok(estimateTotalGoals(null) === 2.6, "no totals market → default 2.6");
}

// --- lambda fit roughly reproduces target probabilities ---
{
  const probs = devig1x2({ home: 1.8, draw: 3.6, away: 4.5 });
  const fit = fitLambdas(probs, 2.7);
  ok(fit.lh > fit.la, "favourite gets the larger expected-goals share");
  ok(fit.err < 0.06, "fitted model is close to target 1X2 probabilities");
}

// --- suggested score agrees with the chosen outcome ---
{
  const s = suggestScore(1.8, 0.9, "HOME");
  ok(s.home > s.away, "HOME pick → home score greater");
  const d = suggestScore(1.2, 1.2, "DRAW");
  ok(d.home === d.away, "DRAW pick → equal score");
}

// --- end-to-end ---
{
  const full = computePicks(
    { home: 1.4, draw: 4.8, away: 8.0 },
    { line: 2.5, over: 1.95, under: 1.85 },
  );
  ok(full.outcome.pick === "HOME", "e2e: favourite picked");
  ok(full.score.home > full.score.away, "e2e: scoreline matches the pick");
  ok(approx(full.probs.HOME + full.probs.DRAW + full.probs.AWAY, 1), "e2e: probs sum to 1");
  ok(computePicks(null) === null, "e2e: null odds → null result");
}

console.log(`\n[picks.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
