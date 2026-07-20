/* World Cup 2026 Pool Leaderboard
 * Loads teams + players + results, computes the ranking, renders the board.
 * The ranking rule: each person is ranked by their single BEST team.
 *   1) furthest stage reached   2) group points   3) goal difference   4) goals for
 * Your other three teams do not affect your position (they're shown for interest).
 */

const STAGE = {
  champion: { order: 6, label: "Champions",      cls: "st-champion" },
  final:    { order: 5, label: "Final",          cls: "st-final" },
  bronze:   { order: 4.5, label: "Bronze medal", cls: "st-bronze" },
  sf:       { order: 4, label: "Semi-final",     cls: "st-sf" },
  qf:       { order: 3, label: "Quarter-final",  cls: "st-qf" },
  r16:      { order: 2, label: "Round of 16",    cls: "st-r16" },
  r32:      { order: 1, label: "Round of 32",    cls: "st-r32" },
  group:    { order: 0, label: "Group stage",    cls: "st-group" },
};

const REFRESH_MS = 60 * 1000;

function gd(t) { return (t.gf || 0) - (t.ga || 0); }
function stageOrder(t) { return (STAGE[t.stage] || STAGE.group).order; }

// Compare two team result objects: returns >0 if a is stronger than b.
function compareTeams(a, b) {
  return (stageOrder(a) - stageOrder(b))
      || ((a.pts || 0) - (b.pts || 0))
      || (gd(a) - gd(b))
      || ((a.gf || 0) - (b.gf || 0));
}

async function loadJSON(path) {
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

function fmtUpdated(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "Updated " + d.toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// First match of the 2026 World Cup: 11 June 2026 (Mexico City opener).
const KICKOFF = new Date("2026-06-11T19:00:00Z");
function countdownToKickoff() {
  const ms = KICKOFF - new Date();
  if (ms <= 0) return "Tournament under way ⚽";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `Kicks off in ${days} day${days === 1 ? "" : "s"}`;
  return `Kicks off in ${hours} hour${hours === 1 ? "" : "s"}`;
}

// "out" = truly knocked out; podium finishes (final/bronze) are never treated as out.
function isOut(t) { return t.eliminated && t.stage !== "champion" && t.stage !== "final" && t.stage !== "bronze"; }

function buildPlayer(player, teamsMeta, results) {
  // Attach result + meta to each of the player's teams.
  const teams = player.teams.map((id) => {
    const meta = teamsMeta[id] || { name: id, flag: "🏳️", group: "?" };
    const res = results[id] || { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, stage: "group", eliminated: false };
    return { id, ...meta, ...res };
  });

  // Best team = strongest non-eliminated team; fall back to strongest overall
  // only when every team is out (so the star always sits on an active team
  // whenever one exists, and eliminated teams can be sorted to the bottom).
  const active = teams.filter((t) => !isOut(t));
  const best = (active.length ? active : teams).reduce((a, b) => (compareTeams(b, a) > 0 ? b : a));

  // Still "alive" if the best team hasn't been knocked out, or it's a podium finish.
  const alive = !best.eliminated || best.stage === "champion" || best.stage === "final" || best.stage === "bronze";

  // "live" if any of this player's teams is currently playing.
  const live = teams.some((t) => t.live);

  // "played" if any of this player's teams has played a match (used as a
  // tiebreaker so players already in the action edge out those yet to kick off).
  const played = teams.some((t) => (t.p || 0) > 0);

  return { name: player.name, teams, best, alive, live, played };
}

function rankPlayers(players) {
  return [...players].sort((A, B) => {
    // Fully-eliminated players always sink below those still alive.
    if (A.alive !== B.alive) return A.alive ? -1 : 1;
    const c = compareTeams(B.best, A.best);
    if (c !== 0) return c;
    // Tie on the best team: favour the player who already has a team that's played.
    if (A.played !== B.played) return A.played ? -1 : 1;
    return A.name.localeCompare(B.name); // stable, keeps a clean 1..12
  });
}

function stageBadge(t, isLiveGroup, notPlayed) {
  const meta = STAGE[t.stage] || STAGE.group;
  const out = isOut(t);
  let cls = meta.cls;
  let label = meta.label;
  if (t.stage === "group") {
    // During the live group stage (not yet eliminated) show points; otherwise "out".
    cls = isLiveGroup ? "st-group-live" : "st-group";
    label = isLiveGroup ? "Group stage" : "Out — groups";
    // None of this player's teams has kicked off yet → muted "yet to play" style.
    if (notPlayed) cls = "st-waiting";
  } else if (t.stage === "final" && t.eliminated) {
    label = "Silver medal"; // lost the final → runner-up; keep st-final silver styling
  } else if (out) {
    // Knocked out — grey badge.
    cls = "st-group";
    label = `Out — ${meta.label}`;
  }
  const showPts = stageOrder(t) <= 1; // group / r32: points still the interesting number
  const pts = showPts ? `<span class="pts">${t.pts} pts · GD ${gd(t) >= 0 ? "+" : ""}${gd(t)}</span>` : "";
  return `<div class="stage-badge ${cls}">${label}${pts}</div>`;
}

function teamLine(t, isBest) {
  const meta = STAGE[t.stage] || STAGE.group;
  const out = isOut(t);
  const stageLabel = t.stage === "group"
    ? (out ? "Out in groups" : "Group stage")
    : t.stage === "final" && t.eliminated
      ? "Silver medal"
      : (out ? `Out — ${meta.label}` : meta.label);
  const liveLabel = t.live ? '<span class="team-live">● LIVE</span> ' : "";
  return `
    <div class="team-line ${isBest ? "is-best" : ""} ${out ? "out" : ""} ${t.live ? "live" : ""}">
      <span class="tflag">${t.flag}</span>
      <span class="tname">${liveLabel}${t.name}${isBest ? " ⭐" : ""}</span>
      <span class="tstage">${stageLabel}</span>
      <span class="tpts">${t.pts} pts · GD ${gd(t) >= 0 ? "+" : ""}${gd(t)}</span>
    </div>`;
}

function render(ranked) {
  const board = document.getElementById("leaderboard");
  board.innerHTML = "";

  ranked.forEach((p, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
    const isLiveGroup = p.best.stage === "group" && !p.best.eliminated;
    // "Yet to play" = none of this player's four teams has played a match.
    const notPlayed = p.teams.every((t) => (t.p || 0) === 0);

    const row = document.createElement("div");
    row.className = `row rank-${rank}${p.live ? " live" : ""}${!p.alive ? " out" : ""}`;
    row.innerHTML = `
      <div class="rank">${medal ? `<span class="medal">${medal}</span>` : rank}</div>
      <div class="player-main">
        <div class="player-name">${p.name}${p.live ? '<span class="live-tag">● LIVE</span>' : ""}</div>
        <div class="best-line">
          <span class="bigflag">${p.best.flag}</span>
          <span class="bname">${p.best.name}</span>
        </div>
      </div>
      ${stageBadge(p.best, isLiveGroup, notPlayed)}
      <div class="teams-detail">
        ${[...p.teams].sort((a, b) => {
            const aOut = isOut(a), bOut = isOut(b);
            if (aOut !== bOut) return aOut ? 1 : -1; // active teams first
            return compareTeams(b, a);
          }).map((t) => teamLine(t, t.id === p.best.id)).join("")}
      </div>`;
    row.addEventListener("click", () => row.classList.toggle("open"));
    board.appendChild(row);
  });
}

function showSkeleton() {
  const board = document.getElementById("leaderboard");
  board.innerHTML = Array.from({ length: 12 }, () => '<div class="skeleton"></div>').join("");
}

async function refresh() {
  try {
    const [teamsFile, playersFile, resultsFile] = await Promise.all([
      loadJSON("data/teams.json"),
      loadJSON("data/players.json"),
      loadJSON("data/results.json"),
    ]);

    const teamsMeta = teamsFile.teams || {};
    const results = resultsFile.teams || {};
    const players = (playersFile.players || []).map((p) => buildPlayer(p, teamsMeta, results));
    render(rankPlayers(players));

    // Status pills
    const statusPill = document.getElementById("status-pill");
    const updatedEl = document.getElementById("updated");
    if (resultsFile.notStarted) {
      statusPill.textContent = "Not started";
      statusPill.className = "pill demo";
      updatedEl.textContent = countdownToKickoff();
    } else if (resultsFile.anyLive) {
      statusPill.textContent = "● LIVE — as it stands";
      statusPill.className = "pill live-pill";
      updatedEl.textContent = fmtUpdated(resultsFile.lastUpdated);
    } else if (resultsFile.demo) {
      statusPill.textContent = "Demo data";
      statusPill.className = "pill demo";
      updatedEl.textContent = fmtUpdated(resultsFile.lastUpdated);
    } else {
      statusPill.textContent = "Live";
      statusPill.className = "pill";
      updatedEl.textContent = fmtUpdated(resultsFile.lastUpdated);
    }
    document.getElementById("error").hidden = true;
  } catch (err) {
    const e = document.getElementById("error");
    e.hidden = false;
    e.textContent = `⚠️ ${err.message}. If you're opening this file directly, use the live link (GitHub Pages) instead — browsers block loading data files from the local filesystem.`;
    console.error(err);
  }
}

// "How it works" toggle
document.getElementById("how-toggle").addEventListener("click", (e) => {
  const body = document.getElementById("how-body");
  const open = body.hidden;
  body.hidden = !open;
  e.target.setAttribute("aria-expanded", String(open));
  e.target.textContent = open ? "How the ranking works ▴" : "How the ranking works ▾";
});

showSkeleton();
refresh();
setInterval(refresh, REFRESH_MS);
