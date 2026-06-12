/* Auto-update robot.
 *
 * Fetches all 2026 World Cup results from the free, open, no-key dataset
 * openfootball/worldcup.json, converts them to our internal shape, and writes
 * data/results.json. Designed to run unattended in a GitHub Action (see
 * .github/workflows/update-results.yml), but you can also run it locally:
 *   node scripts/update-results.mjs
 *
 * NOTE ON FRESHNESS: openfootball is a free community dataset updated roughly
 * once a day (not live during matches). So results refresh daily, not minute-by-
 * minute. (API-Football would be live, but its free plan blocks the 2026 season.)
 *
 * Safety features:
 *   - If the fetch fails, it exits non-zero WITHOUT touching results.json,
 *     so the last good data stays on the site.
 *   - It refuses to overwrite real data with an empty/garbage response.
 *   - It won't clobber a manual override (results.json with "manual": true).
 *   - It stays asleep until the tournament's first whistle.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildResults } from "./lib/transform.mjs";
import { openfootballToFixtures } from "./lib/openfootball.mjs";
import { tsdbToFixtures } from "./lib/thesportsdb.mjs";
import { footballdataToFixtures } from "./lib/footballdata.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const TEAMS_PATH = join(root, "data/teams.json");
const RESULTS_PATH = join(root, "data/results.json");

// --- Config: free sources, tried in order, first one with real results wins ---
// 1) football-data.org (free token) — proper provider, prompt finished results.
// 2) TheSportsDB (free key "123") — backup.
// 3) openfootball JSON (no key) — last-resort backup.
const FOOTBALLDATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const FOOTBALLDATA_URL = process.env.WC_FD_URL
  || "https://api.football-data.org/v4/competitions/WC/matches";
const TSDB_URL = process.env.WC_TSDB_URL
  || "https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=4429&s=2025-2026";
const OPENFOOTBALL_URL = process.env.WC_DATA_URL
  || "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// The robot stays asleep until the tournament's first whistle: Mexico v South
// Africa, 11 June 2026, 19:00 UTC. Before then it does nothing (so the clean
// pre-tournament board + countdown stays in place), even though it's scheduled.
const KICKOFF = new Date(process.env.WC_KICKOFF || "2026-06-11T19:00:00Z");

function log(...a) { console.log(`[update]`, ...a); }
function die(msg) { console.error(`[update] ERROR: ${msg}`); process.exit(1); }

async function getJSON(url) {
  const res = await fetch(url, { headers: { "user-agent": "wc-leaderboard" } });
  if (!res.ok) throw new Error(`${url} responded ${res.status} ${res.statusText}`);
  return res.json();
}

function countPlayed(fixtures) {
  return fixtures.filter((f) => f?.fixture?.status?.short && f.fixture.status.short !== "NS").length;
}

// Try sources in priority order; return the first that actually has played
// matches (so a reachable-but-empty source can't blank out a populated one).
async function fetchFixtures() {
  let firstNonEmpty = null;

  // 1) football-data.org (needs free token)
  if (FOOTBALLDATA_TOKEN) {
    try {
      const res = await fetch(FOOTBALLDATA_URL, { headers: { "X-Auth-Token": FOOTBALLDATA_TOKEN } });
      if (!res.ok) throw new Error(`responded ${res.status} ${res.statusText}`);
      const fx = footballdataToFixtures(await res.json());
      log(`football-data.org: ${fx.length} fixtures, ${countPlayed(fx)} played`);
      if (countPlayed(fx) > 0) return fx;
      if (fx.length && !firstNonEmpty) firstNonEmpty = fx;
    } catch (e) { log(`football-data.org unavailable: ${e.message}`); }
  } else {
    log("football-data.org: no FOOTBALL_DATA_TOKEN set, skipping");
  }

  // 2) TheSportsDB (free key)
  try {
    const fx = tsdbToFixtures(await getJSON(TSDB_URL));
    log(`TheSportsDB: ${fx.length} fixtures, ${countPlayed(fx)} played`);
    if (countPlayed(fx) > 0) return fx;
    if (fx.length && !firstNonEmpty) firstNonEmpty = fx;
  } catch (e) { log(`TheSportsDB unavailable: ${e.message}`); }

  // 3) openfootball (no key)
  try {
    const doc = await getJSON(OPENFOOTBALL_URL);
    const fx = doc && Array.isArray(doc.matches) ? openfootballToFixtures(doc) : [];
    log(`openfootball: ${fx.length} fixtures, ${countPlayed(fx)} played`);
    if (countPlayed(fx) > 0) return fx;
    if (fx.length && !firstNonEmpty) firstNonEmpty = fx;
  } catch (e) { log(`openfootball unavailable: ${e.message}`); }

  // Nothing has played matches yet — return any non-empty fixture list we got.
  return firstNonEmpty || [];
}

async function main() {
  if (new Date() < KICKOFF) {
    log(`Tournament hasn't kicked off yet (starts ${KICKOFF.toISOString()}). Sleeping — no update.`);
    return;
  }

  // Respect a manual override: if someone set "manual": true, don't auto-overwrite.
  try {
    const existing = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
    if (existing.manual === true) {
      log("results.json is in manual-override mode (\"manual\": true) — leaving it untouched.");
      return;
    }
  } catch { /* no existing file yet — fine */ }

  const teamsMeta = JSON.parse(readFileSync(TEAMS_PATH, "utf8")).teams;
  const fixtures = await fetchFixtures();
  log(`fetched ${fixtures.length} fixtures`);

  const results = buildResults(fixtures, teamsMeta);
  const anyPlayed = Object.values(results.teams).some((t) => t.p > 0 || t.stage !== "group" || t.eliminated);

  // Don't wipe the pre-tournament board with an all-zero snapshot if no match has
  // actually been played yet (e.g. the source hasn't posted day-1 scores).
  if (!anyPlayed) {
    log("No played matches in the data yet. Leaving existing data untouched.");
    return;
  }

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n");
  log(`wrote ${RESULTS_PATH} (lastUpdated ${results.lastUpdated})`);
}

main().catch((e) => die(e.stack || e.message));
