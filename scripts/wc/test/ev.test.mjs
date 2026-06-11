/* EV checker for the tight-win scoreline split (Change 2).
 *
 * Encodes the CROSSOVER, not a fixed winner: under Superbru scoring (3 exact /
 * 1.5 close / 1 right-outcome / 0 wrong), 1-0 wins when few goals are expected
 * (the distribution spikes on 1-0 → bank the exact 3.0), and 2-1 wins when more
 * goals are expected (flatter cluster → harvest closeness). The tool's own
 * Poisson model supplies the score-probability distribution, so this test uses
 * the same maths the picker relies on.
 *
 * Run: node scripts/wc/test/ev.test.mjs
 */
import { PICK_CONFIG } from "../lib/picks.mjs";

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error("  ✗ " + m));

// Poisson pmf + Superbru points for a predicted score vs an actual score.
const pois = (k, l) => { let lp = -l + k * Math.log(l); for (let i = 2; i <= k; i++) lp -= Math.log(i); return Math.exp(lp); };
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

function superbruPoints(ph, pa, ha, aa) {
  if (ph === ha && pa === aa) return 3;                 // exact
  if (sign(ph - pa) !== sign(ha - aa)) return 0;        // wrong outcome
  const ci = Math.abs(Math.abs(ph - pa) - Math.abs(ha - aa)) + Math.abs((ph + pa) - (ha + aa)) / 2;
  return ci > 0 && ci <= 1.5 ? 1.5 : 1;                 // close vs right-outcome-only
}

// Expected Superbru points for predicting (ph,pa) given Poisson means lh, la.
function evScore(ph, pa, lh, la, max = 9) {
  let e = 0;
  for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) {
    const p = pois(i, lh) * pois(j, la);
    if (p < 1e-9) continue;
    e += p * superbruPoints(ph, pa, i, j);
  }
  return e;
}

// A representative tight-win goal split (favourite takes ~60% of the goals).
const split = (total, favShare = 0.60) => ({ lh: total * favShare, la: total * (1 - favShare) });

// --- the crossover: 1-0 wins low, 2-1 wins high ------------------------------
{
  const lo = split(2.2);
  ok(evScore(1, 0, lo.lh, lo.la) >= evScore(2, 1, lo.lh, lo.la), "low goals (2.2): 1-0 EV ≥ 2-1 EV");

  const hi = split(2.9);
  ok(evScore(2, 1, hi.lh, hi.la) >= evScore(1, 0, hi.lh, hi.la), "high goals (2.9): 2-1 EV ≥ 1-0 EV");
}

// --- the configured split should sit near the model's actual crossover -------
{
  let crossover = null;
  for (let T = 2.0; T <= 3.001; T += 0.01) {
    const { lh, la } = split(T);
    if (crossover === null && evScore(2, 1, lh, la) >= evScore(1, 0, lh, la)) crossover = T;
  }
  ok(crossover !== null, "a crossover exists between 2.0 and 3.0");
  ok(Math.abs(crossover - PICK_CONFIG.tight_goals_split) <= 0.2,
     `tight_goals_split (${PICK_CONFIG.tight_goals_split}) is within 0.2 of the model crossover (${crossover.toFixed(2)})`);
}

console.log(`\n[ev.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
