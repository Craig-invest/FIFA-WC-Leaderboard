/* picks.mjs — the "brain" of the prediction helper.
 *
 * Pure functions only (no network, no files), so they're easy to unit-test.
 * Turns raw bookmaker odds into:
 *   1) margin-adjusted (de-vigged) Home/Draw/Away probabilities,
 *   2) a suggested OUTCOME (with a confidence label), and
 *   3) a suggested SCORELINE (most-likely exact score consistent with the pick).
 *
 * The scoreline model is a deliberately simple, transparent heuristic:
 *   - estimate total goals from the over/under (totals) market,
 *   - split those goals into each team's expected goals so an independent
 *     Poisson model reproduces the de-vigged 1X2 probabilities,
 *   - then read off the most likely exact score for the favoured outcome.
 * It's a sensible nudge, not a crystal ball — tweak the constants if you like.
 */

// ---- basic odds maths -------------------------------------------------------

// Decimal odds (e.g. 2.50) → implied probability (includes bookmaker margin).
export function impliedProb(decimalOdds) {
  return decimalOdds > 0 ? 1 / decimalOdds : 0;
}

// Strip the bookmaker margin ("vig") from a set of 1X2 decimal odds so the
// three probabilities sum to exactly 1. Returns null if the odds are unusable.
export function devig1x2({ home, draw, away }) {
  const raw = {
    HOME: impliedProb(home),
    DRAW: impliedProb(draw),
    AWAY: impliedProb(away),
  };
  const sum = raw.HOME + raw.DRAW + raw.AWAY;
  if (!(sum > 0)) return null;
  return {
    HOME: raw.HOME / sum,
    DRAW: raw.DRAW / sum,
    AWAY: raw.AWAY / sum,
    overround: sum, // >1; how much margin the book baked in
  };
}

// A friendly confidence word for the favourite's probability.
export function confidenceLabel(p) {
  if (p >= 0.55) return "Strong";
  if (p >= 0.4) return "Lean";
  return "Toss-up";
}

// Pick the most likely of HOME / DRAW / AWAY.
export function suggestOutcome(probs) {
  const ranked = [
    ["HOME", probs.HOME],
    ["DRAW", probs.DRAW],
    ["AWAY", probs.AWAY],
  ].sort((a, b) => b[1] - a[1]);
  const [pick, prob] = ranked[0];
  return { pick, prob, confidence: confidenceLabel(prob) };
}

// ---- scoreline model (independent Poisson) ----------------------------------

// Poisson probability mass: P(X = k) for mean lambda. Uses logs for stability.
function pois(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logp = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logp -= Math.log(i);
  return Math.exp(logp);
}

// 1X2 probabilities implied by two independent Poisson means.
function outcomeProbsFromLambdas(lh, la, maxGoals = 10) {
  let H = 0, D = 0, A = 0;
  for (let i = 0; i <= maxGoals; i++) {
    const ph = pois(i, lh);
    for (let j = 0; j <= maxGoals; j++) {
      const p = ph * pois(j, la);
      if (i > j) H += p;
      else if (i === j) D += p;
      else A += p;
    }
  }
  return { HOME: H, DRAW: D, AWAY: A };
}

// Estimate expected TOTAL goals in the match.
//   - If we have a totals market (line + over/under odds), start from the line
//     and nudge by how much the book leans over/under.
//   - Otherwise fall back to a typical World Cup average.
export function estimateTotalGoals(totals) {
  if (!totals || !(totals.line > 0) || !(totals.over > 0) || !(totals.under > 0)) {
    return 2.6; // sensible default when no totals market is offered yet
  }
  const pOver = impliedProb(totals.over);
  const pUnder = impliedProb(totals.under);
  const norm = pOver + pUnder;
  const leanOver = norm > 0 ? pOver / norm - 0.5 : 0; // -0.5..+0.5
  // Each 0.1 of lean ≈ 0.2 goals shift around the line. Clamp to sane range.
  const mu = totals.line + leanOver * 4 * 0.1 * 5; // = line + leanOver*2 goals
  return Math.min(5.5, Math.max(1.2, mu));
}

// Find the split of total goals (share to home) whose Poisson model best
// reproduces the de-vigged HOME/AWAY probabilities.
export function fitLambdas(probs, muTotal) {
  let best = null;
  for (let s = 0.05; s <= 0.95 + 1e-9; s += 0.01) {
    const lh = muTotal * s;
    const la = muTotal * (1 - s);
    const m = outcomeProbsFromLambdas(lh, la);
    const err = Math.abs(m.HOME - probs.HOME) + Math.abs(m.AWAY - probs.AWAY);
    if (!best || err < best.err) best = { share: s, lh, la, err, modelProbs: m };
  }
  return best;
}

// Most-likely exact score that agrees with the chosen outcome (HOME/DRAW/AWAY).
export function suggestScore(lh, la, outcomePick, maxGoals = 8) {
  let best = null;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const res = i > j ? "HOME" : i === j ? "DRAW" : "AWAY";
      if (res !== outcomePick) continue;
      const p = pois(i, lh) * pois(j, la);
      if (!best || p > best.p) best = { home: i, away: j, p };
    }
  }
  return best || { home: outcomePick === "AWAY" ? 0 : 1, away: outcomePick === "HOME" ? 0 : 1, p: 0 };
}

// ---- deterministic pick layer (outcome + fixed-anchor scoreline) ------------

// All tunable thresholds in one place — tweak these after backtesting.
export const PICK_CONFIG = {
  draw_tight: 0.40,   // pick DRAW when neither side's no-vig win prob reaches this
  walkover: 0.70,     // a WIN with favourite ≥ this is "almost a walkover" → 2-0
  draw_boost: 1.125,  // round-3 multiplier on p_draw when a draw qualifies BOTH teams
};

// Apply the situational draw boost (only round-3 group games where a draw sends
// both teams through). Returns possibly-adjusted probs that still sum to 1.
function applyDrawBoost(probs, groupRound, drawAdvancesBoth) {
  if (!(groupRound === 3 && drawAdvancesBoth)) return { probs, boosted: false };
  const d = Math.min(0.95, probs.DRAW * PICK_CONFIG.draw_boost);
  const rest = probs.HOME + probs.AWAY;
  const scale = rest > 0 ? (1 - d) / rest : 0;
  return { probs: { HOME: probs.HOME * scale, DRAW: d, AWAY: probs.AWAY * scale }, boosted: true };
}

/**
 * Turn no-vig probabilities into an outcome pick + fixed scoreline.
 * Anchors: incredibly tight → 1-1 · walkover → 2-0 · close win round 1 → 2-1 ·
 * close win anywhere else (group round 2/3 or knockout) → 1-0.
 * @param {{HOME:number,DRAW:number,AWAY:number}} baseProbs
 * @param {{groupRound?:number|"KO", drawAdvancesBoth?:boolean}} context
 */
export function decidePick(baseProbs, context = {}) {
  const { groupRound = null, drawAdvancesBoth = false } = context;
  const { probs, boosted } = applyDrawBoost(baseProbs, groupRound, drawAdvancesBoth);

  const favSide = probs.HOME >= probs.AWAY ? "HOME" : "AWAY";
  const favProb = Math.max(probs.HOME, probs.AWAY);
  const orient = (favScore, dogScore) =>
    favSide === "HOME" ? { home: favScore, away: dogScore } : { home: dogScore, away: favScore };

  let pick, score, reason;
  if (favProb < PICK_CONFIG.draw_tight) {
    pick = "DRAW";
    score = { home: 1, away: 1 };
    reason = `incredibly tight (favourite ${Math.round(favProb * 100)}%) → draw 1-1`;
    if (boosted) reason += " [draw boosted: R3 advances both]";
  } else if (favProb >= PICK_CONFIG.walkover) {
    pick = favSide;
    score = orient(2, 0);
    reason = `almost a walkover (favourite ${Math.round(favProb * 100)}%) → 2-0`;
  } else if (groupRound === 1) {
    pick = favSide;
    score = orient(2, 1);
    reason = "close win, group round 1 → 2-1";
  } else {
    pick = favSide;
    score = orient(1, 0);
    reason = "close win → 1-0";
  }

  return { pick, score, reason, probs, boosted, favSide, favProb };
}

// ---- top-level: odds in, full suggestion out --------------------------------

/**
 * @param {{home:number,draw:number,away:number}} h2h  consensus 1X2 decimal odds
 * @param {{line:number,over:number,under:number}=} totals  consensus totals market
 * @param {{groupRound?:number|"KO", drawAdvancesBoth?:boolean}=} context  round + qualification info
 * @returns suggestion object, or null if 1X2 odds are unusable
 */
export function computePicks(h2h, totals, context = {}) {
  if (!h2h) return null;
  const probs = devig1x2(h2h);
  if (!probs) return null;

  const d = decidePick({ HOME: probs.HOME, DRAW: probs.DRAW, AWAY: probs.AWAY }, context);
  const pickProb = d.pick === "DRAW" ? d.probs.DRAW : d.favProb;

  return {
    // Display the raw (market) probabilities; the optional draw boost is an
    // internal decision nudge, noted in `reason`, not shown on the bars.
    probs: { HOME: probs.HOME, DRAW: probs.DRAW, AWAY: probs.AWAY },
    overround: probs.overround,
    outcome: { pick: d.pick, prob: pickProb, confidence: confidenceLabel(pickProb) },
    score: d.score,
    reason: d.reason,
    drawBoosted: d.boosted,
    groupRound: context.groupRound ?? null,
    expectedGoals: estimateTotalGoals(totals),
  };
}

