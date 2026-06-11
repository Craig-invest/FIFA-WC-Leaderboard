/* Ties the tight-win scoreline rule to the historic WC data.
 *
 * Modal scorelines by stage (counts out of 48 sampled games, from WC history):
 *   Round 1 : 2-1 (9) · 1-1 (7, a draw) · 1-0 (6)
 *   Round 2 : 1-0 (12) · 2-1 (8) · 2-0 (7)
 *   Round 3 : 1-0 (11) · 2-1 (10) · 3-0 (6)
 *   Knockout: 1-0 (~17) · 2-1 (~8) · 0-0 (~7, a draw)
 *
 * For a normal/tight WIN, the EV-maximising scoreline is the stage's most common
 * *win* score (the 3-pt exact bucket dominates). This test asserts decidePick's
 * tight-win anchor equals that empirical modal win score for each stage.
 * Run: node scripts/wc/test/modal.test.mjs
 */
import { decidePick } from "../lib/picks.mjs";

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error("  ✗ " + m));

// Win-only scoreline frequencies per stage (draws excluded — they're a separate pick).
const STAGE_WIN_FREQ = {
  1:    { "2-1": 9, "1-0": 6, "2-0": 4, "3-0": 3 },
  2:    { "1-0": 12, "2-1": 8, "2-0": 7, "3-0": 3 },
  3:    { "1-0": 11, "2-1": 10, "3-0": 6, "2-0": 5 },
  KO:   { "1-0": 17, "2-1": 8, "2-0": 6, "3-0": 4 },
};
const modalWin = (freq) => Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];

// A representative tight win (favourite ~50%, below the 0.70 walkover line).
const tight = { HOME: 0.50, DRAW: 0.28, AWAY: 0.22 };
const scoreStr = (d) => `${d.score.home}-${d.score.away}`;

for (const stage of [1, 2, 3, "KO"]) {
  const d = decidePick(tight, { groupRound: stage });
  const expected = modalWin(STAGE_WIN_FREQ[stage]);
  ok(scoreStr(d) === expected,
     `stage ${stage}: anchor ${scoreStr(d)} matches historic modal win score ${expected}`);
}

// Sanity: round 1's modal win score really is 2-1, and rounds 2/3/KO are 1-0.
ok(modalWin(STAGE_WIN_FREQ[1]) === "2-1", "round 1 modal win score is 2-1");
ok(modalWin(STAGE_WIN_FREQ[2]) === "1-0" && modalWin(STAGE_WIN_FREQ[3]) === "1-0" && modalWin(STAGE_WIN_FREQ.KO) === "1-0",
   "rounds 2/3/knockout modal win score is 1-0");

console.log(`\n[modal.test] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
