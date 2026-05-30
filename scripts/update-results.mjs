/* Auto-update robot.
 *
 * Fetches all 2026 World Cup fixtures from API-Football, transforms them into our
 * results.json shape, and writes data/results.json. Designed to run unattended in
 * a GitHub Action (see .github/workflows/update-results.yml), but you can also run
 * it locally:  API_FOOTBALL_KEY=xxxx node scripts/update-results.mjs
 *
 * Safety features:
 *   - If the API call fails, it exits non-zero WITHOUT touching results.json,
 *     so the last good data stays on the site.
 *   - It refuses to overwrite real data with an empty/garbage response.
 *   - It won't clobber a manual override (results.json with "manual": true).
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildResults } from "./lib/transform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const TEAMS_PATH = join(root, "data/teams.json");
const RESULTS_PATH = join(root, "data/results.json");

// --- Config (override via env if FIFA ever changes the league/season id) ---
const API_KEY = process.env.API_FOOTBALL_KEY;
const LEAGUE_ID = process.env.WC_LEAGUE_ID || "1";   // API-Football: World Cup = league 1
const SEASON = process.env.WC_SEASON || "2026";
const API_BASE = "https://v3.football.api-sports.io";

function log(...a) { console.log(`[update]`, ...a); }
function die(msg) { console.error(`[update] ERROR: ${msg}`); process.exit(1); }

async function fetchFixtures() {
  const url = `${API_BASE}/fixtures?league=${LEAGUE_ID}&season=${SEASON}`;
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) die(`API responded ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    die(`API returned errors: ${JSON.stringify(json.errors)}`);
  }
  if (!Array.isArray(json.response)) die("API response missing 'response' array");
  return json.response;
}

async function main() {
  if (!API_KEY) die("API_FOOTBALL_KEY is not set. Add it as a GitHub Actions secret (see README Phase 2).");

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

  // Sanity: before the tournament the API may return 0 fixtures. Don't wipe demo
  // data with nothing — only write once there's at least something to show, OR if
  // the current file is already demo data (then it's safe to switch to live zeros).
  const results = buildResults(fixtures, teamsMeta);
  const anyPlayed = Object.values(results.teams).some((t) => t.p > 0 || t.stage !== "group" || t.eliminated);
  if (fixtures.length === 0 && !anyPlayed) {
    log("API returned no fixtures yet (tournament hasn't started). Not overwriting existing data.");
    return;
  }

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n");
  log(`wrote ${RESULTS_PATH} (lastUpdated ${results.lastUpdated})`);
}

main().catch((e) => die(e.stack || e.message));
