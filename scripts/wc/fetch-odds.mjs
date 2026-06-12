/* fetch-odds.mjs — the prediction helper's robot.
 *
 * 1) Pulls upcoming World Cup matches + live odds from The Odds API.
 * 2) Computes a suggested outcome + scoreline for each (see lib/picks.mjs).
 * 3) Merges them into data/wc-matches.json (the page reads this).
 * 4) Finds matches kicking off inside the "predict-by" window that haven't been
 *    emailed yet, and writes an email body for the workflow to send.
 *
 * Run locally:  ODDS_API_KEY=xxxx node scripts/wc/fetch-odds.mjs
 *
 * Safety: if the API errors, it exits non-zero WITHOUT touching wc-matches.json,
 * so the last good odds stay on the page.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { computePicks, friendlyReason } from "./lib/picks.mjs";
import { buildStandings, drawAdvancesBoth } from "./lib/qualify.mjs";
import { makeResolver } from "../lib/transform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const TEAMS_PATH     = join(root, "data/wc-teams.json");
const LB_TEAMS_PATH  = join(root, "data/teams.json");  // leaderboard's code→{name,group} (for standings)
const KNOCKOUTS_PATH = join(root, "data/wc-knockouts.json");
const MATCHES_PATH  = join(root, "data/wc-matches.json");
const NOTIFIED_PATH = join(root, "data/wc-notified.json");
const EMAIL_HTML    = join(root, "data/.email-body.html");
const EMAIL_META    = join(root, "data/.pending-email.json");

// --- config (overridable via env) ---
const API_KEY    = process.env.ODDS_API_KEY;
const SPORT_KEY  = process.env.ODDS_SPORT_KEY || "soccer_fifa_world_cup";
const REGIONS    = process.env.ODDS_REGIONS   || "uk";          // uk = good WC coverage, 1 credit
const MARKETS    = "h2h,totals";
const LEAD_HOURS = Number(process.env.EMAIL_LEAD_HOURS || 60);   // ~2.5 days → covers the 2-day mark
const PREDICT_BY_HOURS = 48;                                     // you aim to predict 2 days out
const CONCLUDED_AFTER_HOURS = Number(process.env.CONCLUDED_AFTER_HOURS || 3); // drop games this long after kickoff

// API-Football (reused from the leaderboard) supplies results for group standings,
// which feed the round-3 "draw advances both" boost. Optional: if the key is
// missing or the call fails, the boost simply stays dormant.
const FOOTBALL_KEY    = process.env.API_FOOTBALL_KEY;
const FOOTBALL_LEAGUE = process.env.WC_LEAGUE_ID || "1";
const FOOTBALL_SEASON = process.env.WC_SEASON || "2026";

function log(...a) { console.log("[wc-odds]", ...a); }
function die(msg) { console.error("[wc-odds] ERROR:", msg); process.exit(1); }

// Build a name → {canonical, flag, group} lookup that tolerates alternate spellings.
export function buildTeamLookup(metaInput) {
  const meta = metaInput || JSON.parse(readFileSync(TEAMS_PATH, "utf8")).teams;
  const lut = new Map();
  for (const [name, info] of Object.entries(meta)) {
    const entry = { canonical: name, flag: info.flag, group: info.group };
    lut.set(name.toLowerCase(), entry);
    for (const alias of info.aliases || []) lut.set(alias.toLowerCase(), entry);
  }
  return lut;
}
export function resolveTeam(lut, raw) {
  return lut.get(String(raw).toLowerCase()) || { canonical: raw, flag: "🏳️", group: "?" };
}

async function fetchOdds() {
  const url = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds`
    + `?apiKey=${API_KEY}&regions=${REGIONS}&markets=${MARKETS}`
    + `&oddsFormat=decimal&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    die(`Odds API responded ${res.status} ${res.statusText}. ${body.slice(0, 300)}`);
  }
  log(`credits used: ${res.headers.get("x-requests-used")} / remaining: ${res.headers.get("x-requests-remaining")}`);
  const json = await res.json();
  if (!Array.isArray(json)) die("Odds API response was not an array");
  return json;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const mode = (xs) => {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

// Reduce one event's many bookmakers into a single consensus set of odds.
export function consensusOdds(event) {
  const home = [], draw = [], away = [];
  const totalsByLine = new Map(); // point → { over:[], under:[] }

  for (const bk of event.bookmakers || []) {
    for (const mk of bk.markets || []) {
      if (mk.key === "h2h") {
        for (const o of mk.outcomes || []) {
          if (o.name === event.home_team) home.push(o.price);
          else if (o.name === event.away_team) away.push(o.price);
          else if (o.name === "Draw") draw.push(o.price);
        }
      } else if (mk.key === "totals") {
        for (const o of mk.outcomes || []) {
          const line = o.point;
          if (line == null) continue;
          if (!totalsByLine.has(line)) totalsByLine.set(line, { over: [], under: [] });
          if (o.name === "Over") totalsByLine.get(line).over.push(o.price);
          else if (o.name === "Under") totalsByLine.get(line).under.push(o.price);
        }
      }
    }
  }
  if (!home.length || !away.length || !draw.length) return null;

  // Use the most commonly-offered totals line as the "main" line.
  const lines = [];
  for (const [line, v] of totalsByLine) for (let k = 0; k < v.over.length; k++) lines.push(line);
  const mainLine = mode(lines);
  const t = mainLine != null ? totalsByLine.get(mainLine) : null;

  return {
    home: +avg(home).toFixed(3),
    draw: +avg(draw).toFixed(3),
    away: +avg(away).toFixed(3),
    totalsLine: mainLine ?? null,
    over: t ? +avg(t.over).toFixed(3) : null,
    under: t ? +avg(t.under).toFixed(3) : null,
    books: (event.bookmakers || []).length,
  };
}

function predictByISO(commenceTime) {
  return new Date(new Date(commenceTime).getTime() - PREDICT_BY_HOURS * 3600e3).toISOString();
}

export function buildMatch(event, lut) {
  const odds = consensusOdds(event);
  if (!odds) return null;
  const h = resolveTeam(lut, event.home_team);
  const a = resolveTeam(lut, event.away_team);
  const pick = computePicks(
    { home: odds.home, draw: odds.draw, away: odds.away },
    odds.totalsLine != null ? { line: odds.totalsLine, over: odds.over, under: odds.under } : undefined,
  );
  // Rewrite the reason with the favourite's actual name for the dashboard.
  if (pick) pick.reason = friendlyReason(pick.rule, pick.favSide === "HOME" ? h.canonical : a.canonical);
  // Stage label: same group ⇒ group game, else a knockout tie.
  const group = h.group !== "?" && h.group === a.group ? h.group : null;
  const stage = group ? `Group ${group}` : "Knockout";
  return {
    id: event.id,
    home: h.canonical, homeFlag: h.flag,
    away: a.canonical, awayFlag: a.flag,
    stage, group,
    commenceTime: event.commence_time,
    predictBy: predictByISO(event.commence_time),
    oddsReady: true,
    odds,
    pick,
  };
}

// Turn the static knockout placeholders into match rows (teams + odds TBD).
// A round's placeholders are dropped once that round's real games arrive with odds.
export function knockoutPlaceholders(koFile, existingMatches) {
  const roundsWithOdds = new Set(existingMatches.filter((m) => m.oddsReady).map((m) => m.stage));
  return (koFile.matches || [])
    .filter((k) => !roundsWithOdds.has(k.stageLabel))
    .map((k) => ({
      id: k.id, matchNo: k.matchNo,
      home: "TBD", homeFlag: "🏳️", away: "TBD", awayFlag: "🏳️",
      stage: k.stageLabel, group: null, tbd: true, windowLabel: k.windowLabel,
      commenceTime: k.sortDate, predictBy: null,
      oddsReady: false, odds: null, pick: null,
    }));
}

// Stored consensus odds → arguments for computePicks().
function oddsArgs(odds) {
  return [
    { home: odds.home, draw: odds.draw, away: odds.away },
    odds.totalsLine != null ? { line: odds.totalsLine, over: odds.over, under: odds.under } : undefined,
  ];
}

// Fetch the full fixture list (with results) from API-Football, for standings.
// Returns null (non-fatal) if the key is missing or the call fails.
async function fetchFixtures() {
  if (!FOOTBALL_KEY) return null;
  try {
    const url = `https://v3.football.api-sports.io/fixtures?league=${FOOTBALL_LEAGUE}&season=${FOOTBALL_SEASON}`;
    const res = await fetch(url, { headers: { "x-apisports-key": FOOTBALL_KEY } });
    if (!res.ok) { log(`API-Football responded ${res.status}; standings/qualification skipped`); return null; }
    const json = await res.json();
    if (!Array.isArray(json.response)) { log("API-Football: no fixtures array; standings skipped"); return null; }
    log(`fetched ${json.response.length} fixtures from API-Football (for standings)`);
    return json.response;
  } catch (e) { log("API-Football fetch failed; standings skipped:", e.message); return null; }
}

// Group round (1/2/3) by date-order within each group: the first two kickoffs
// are round 1, next two round 2, last two round 3. Returns a Map id→round.
export function groupRoundsByDate(matches) {
  const byGroup = new Map();
  for (const m of matches) {
    if (!m.oddsReady || !m.group) continue;
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(m);
  }
  const rounds = new Map();
  for (const games of byGroup.values()) {
    games.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
    games.forEach((m, i) => rounds.set(m.id, Math.floor(i / 2) + 1));
  }
  return rounds;
}

// Attach groupRound + drawAdvancesBoth to each real (odds-ready) match and
// recompute its pick with that context. Mutates `matches` in place.
export function attachContextAndRepick(matches, fixtures, lbTeamsMeta) {
  const rounds = groupRoundsByDate(matches);
  const standings = fixtures && lbTeamsMeta ? buildStandings(fixtures, lbTeamsMeta) : null;
  const resolveCode = lbTeamsMeta ? makeResolver(lbTeamsMeta) : null;

  for (const m of matches) {
    if (!m.oddsReady || !m.odds) continue;
    if (m.group) {
      m.groupRound = rounds.get(m.id) ?? null;
      m.drawAdvancesBoth = false;
      if (m.groupRound === 3 && standings && resolveCode) {
        const cH = resolveCode(m.home), cA = resolveCode(m.away);
        if (cH && cA) m.drawAdvancesBoth = drawAdvancesBoth(cH, cA, standings);
      }
    } else {
      m.groupRound = "KO";
      m.drawAdvancesBoth = false;
    }
    const [h2h, totals] = oddsArgs(m.odds);
    m.pick = computePicks(h2h, totals, { groupRound: m.groupRound, drawAdvancesBoth: m.drawAdvancesBoth });
    if (m.pick) m.pick.reason = friendlyReason(m.pick.rule, m.pick.favSide === "HOME" ? m.home : m.away);
  }
  return matches;
}

// --- email body for the games due in the window ---
const OUTCOME_TEXT = (m) =>
  m.pick.outcome.pick === "HOME" ? `${m.home} to win`
  : m.pick.outcome.pick === "AWAY" ? `${m.away} to win`
  : "Draw";

function fmtUTC(iso) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", hour12: false,
  }) + " UTC";
}

export function emailHtml(due) {
  const rows = due.map((m) => {
    const p = m.pick;
    const pct = (x) => `${Math.round(x * 100)}%`;
    return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;">
          <strong>${m.homeFlag} ${m.home} v ${m.away} ${m.awayFlag}</strong><br>
          <span style="color:#666;font-size:13px;">${m.stage} · ${fmtUTC(m.commenceTime)}</span>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:13px;color:#444;">
          ${m.home} ${m.odds.home} · Draw ${m.odds.draw} · ${m.away} ${m.odds.away}<br>
          <span style="color:#888;">${pct(p.probs.HOME)} / ${pct(p.probs.DRAW)} / ${pct(p.probs.AWAY)}</span>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;">
          <strong style="color:#15803d;">${OUTCOME_TEXT(m)}</strong>
          <span style="color:#888;">(${p.outcome.confidence})</span><br>
          <span style="font-size:13px;color:#444;">Suggested score: <strong>${m.home} ${p.score.home}–${p.score.away} ${m.away}</strong></span>
          ${p.reason ? `<br><span style="font-size:11px;color:#aaa;">${p.reason}</span>` : ""}
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:680px;margin:auto;">
    <h2 style="margin-bottom:4px;">⚽ World Cup picks — ${due.length} game${due.length === 1 ? "" : "s"} to predict</h2>
    <p style="color:#666;margin-top:0;">These kick off within the next couple of days. Lodge your predictions before kickoff.</p>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="text-align:left;font-size:12px;color:#888;text-transform:uppercase;">
        <th style="padding:6px 8px;">Match</th><th style="padding:6px 8px;">Odds · implied (H/D/A)</th><th style="padding:6px 8px;">Suggested pick</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#999;font-size:12px;margin-top:18px;">Suggestions come from de-vigged bookmaker odds: the favourite by margin-adjusted probability, with a fixed scoreline anchor (2-0 walkover · 2-1 round-1 close win · 1-0 otherwise · 1-1 when incredibly tight). A nudge, not a guarantee.</p>
  </body></html>`;
}

async function main() {
  if (!API_KEY) die("ODDS_API_KEY is not set. Add it as a GitHub Actions secret (see PREDICTIONS-GUIDE.md).");

  // Clear any stale pending-email artifacts from a previous run.
  for (const f of [EMAIL_HTML, EMAIL_META]) if (existsSync(f)) rmSync(f);

  const lut = buildTeamLookup();
  const events = await fetchOdds();
  log(`fetched ${events.length} events with odds`);

  const fetched = events.map((e) => buildMatch(e, lut)).filter(Boolean);

  // Don't wipe good data with nothing: if the API returned no usable events but
  // we already have real matches stored, keep them and stop here.
  let prior = { matches: [] };
  try { prior = JSON.parse(readFileSync(MATCHES_PATH, "utf8")); } catch { /* none yet */ }
  if (fetched.length === 0) {
    if (!prior.demo && (prior.matches || []).length) {
      log("API returned no usable events; keeping existing matches untouched.");
      return;
    }
    log("API returned no usable events and no prior real data — nothing to write yet.");
    return;
  }

  // Merge: keep prior REAL (odds-ready) games by id, overwritten by fresh ones.
  // Prior knockout placeholders are dropped here and regenerated fresh below.
  const byId = new Map();
  if (!prior.demo) for (const m of prior.matches || []) if (m.oddsReady) byId.set(m.id, m);
  for (const m of fetched) byId.set(m.id, m);
  // Drop concluded games (kicked off more than CONCLUDED_AFTER_HOURS ago) so they
  // don't pile up — The Odds API already stops returning them; this prunes any we
  // were still carrying from a previous run.
  const concludedCutoff = Date.now() - CONCLUDED_AFTER_HOURS * 3600e3;
  const matches = [...byId.values()].filter((m) => new Date(m.commenceTime).getTime() > concludedCutoff);

  // Attach round + qualification context and (re)compute each pick with it.
  // group_round comes from the schedule (date-order); the round-3 draw boost
  // needs standings from API-Football (dormant if that key/data isn't available).
  let lbTeams = null;
  try { lbTeams = JSON.parse(readFileSync(LB_TEAMS_PATH, "utf8")).teams; } catch { /* fine */ }
  const fixtures = await fetchFixtures();
  attachContextAndRepick(matches, fixtures, lbTeams);

  // Append the full knockout bracket as placeholders (teams/odds TBD) so the
  // page shows the complete schedule. A round's placeholders disappear once that
  // round's real games arrive with odds.
  try {
    const koFile = JSON.parse(readFileSync(KNOCKOUTS_PATH, "utf8"));
    matches.push(...knockoutPlaceholders(koFile, matches));
  } catch (e) { log("no knockout placeholders loaded:", e.message); }

  matches.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));

  writeFileSync(MATCHES_PATH, JSON.stringify({
    demo: false, source: "the-odds-api", lastUpdated: new Date().toISOString(), matches,
  }, null, 2) + "\n");
  log(`wrote ${matches.length} matches (incl. knockout placeholders) to wc-matches.json`);

  // Work out which games to email about (in window, not already notified).
  let notified = { notified: [] };
  try { notified = JSON.parse(readFileSync(NOTIFIED_PATH, "utf8")); } catch { /* none yet */ }
  const already = new Set(notified.notified || []);
  const now = Date.now();
  const due = matches.filter((m) => {
    if (!m.oddsReady || !m.pick) return false; // never email TBD/odds-pending games
    const t = new Date(m.commenceTime).getTime();
    return t > now && t <= now + LEAD_HOURS * 3600e3 && !already.has(m.id);
  });

  if (!due.length) { log("no new games in the email window."); return; }

  const subject = `⚽ WC picks: ${due.length} game${due.length === 1 ? "" : "s"} to predict`;
  writeFileSync(EMAIL_HTML, emailHtml(due));
  writeFileSync(EMAIL_META, JSON.stringify({ subject, ids: due.map((m) => m.id), count: due.length }, null, 2) + "\n");
  log(`email queued for ${due.length} game(s): ${due.map((m) => `${m.home} v ${m.away}`).join(", ")}`);
}

// Only run the robot when executed directly (not when imported by tests).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => die(e.stack || e.message));
}
