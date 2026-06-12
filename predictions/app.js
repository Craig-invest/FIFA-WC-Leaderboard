/* WC 2026 Prediction Helper — front-end.
 * Reads data/wc-matches.json (odds + computed picks, written by the robot) and
 * data/wc-teams.json (flags), groups matches by day, and renders each with its
 * odds, implied probabilities, suggested outcome + scoreline, and predict-by tag.
 * Pure display — all the maths happens in the robot so the page can't drift.
 */
const REFRESH_MS = 5 * 60 * 1000;
const PREDICT_BY_HOURS = 48;
// A match is treated as concluded (and dropped from the board) this long after
// kickoff — enough to cover 90' + stoppage, plus extra time & penalties.
const CONCLUDED_AFTER_MS = 3 * 60 * 60 * 1000;

const els = {
  matches: document.getElementById("matches"),
  empty: document.getElementById("empty"),
  error: document.getElementById("error"),
  pill: document.getElementById("status-pill"),
  updated: document.getElementById("updated"),
  upcomingOnly: document.getElementById("upcoming-only"),
};

let teamLut = new Map();

async function loadJSON(path) {
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

function buildTeamLut(teamsFile) {
  const lut = new Map();
  for (const [name, info] of Object.entries(teamsFile.teams || {})) {
    const entry = { flag: info.flag, group: info.group };
    lut.set(name.toLowerCase(), entry);
    for (const a of info.aliases || []) lut.set(a.toLowerCase(), entry);
  }
  return lut;
}
function flagFor(name, embedded) {
  return embedded || teamLut.get(String(name).toLowerCase())?.flag || "🏳️";
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
function fmtKick(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
}
function dayKey(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function predictByDate(m) {
  const t = m.predictBy ? new Date(m.predictBy)
    : new Date(new Date(m.commenceTime).getTime() - PREDICT_BY_HOURS * 3600e3);
  return t;
}

// Returns the predict-by status for a match: locked / now / soon / open.
function predictStatus(m) {
  const now = Date.now();
  const kick = new Date(m.commenceTime).getTime();
  const by = predictByDate(m).getTime();
  if (now >= kick) return { cls: "locked", text: "Kicked off — locked" };
  if (now >= by) return { cls: "now", text: "⏰ Predict now" };
  return { cls: "open", text: `Predict by ${predictByDate(m).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` };
}

function outcomeText(m) {
  const p = m.pick?.outcome?.pick;
  if (p === "HOME") return `${m.home} win`;
  if (p === "AWAY") return `${m.away} win`;
  return "Draw";
}
function confClass(c) {
  return c === "Strong" ? "conf-strong" : c === "Lean" ? "conf-lean" : "conf-toss";
}

// A game whose teams/odds aren't decided yet (e.g. a knockout fixture).
function pendingCard(m) {
  const when = m.windowLabel || fmtKick(m.commenceTime);
  return `
    <article class="card pending">
      <div class="card-top">
        <span class="stage">${m.stage || ""}${m.matchNo ? ` · Match ${m.matchNo}` : ""}</span>
        <span class="kick">${when}</span>
      </div>
      <div class="teams tbd">
        <span class="team home"><span class="flag">🏳️</span>TBD</span>
        <span class="vs">v</span>
        <span class="team away">TBD<span class="flag">🏳️</span></span>
      </div>
      <div class="pending-note">Teams &amp; odds to be confirmed</div>
    </article>`;
}

function matchCard(m) {
  if (!m.oddsReady) return pendingCard(m);
  const homeFlag = flagFor(m.home, m.homeFlag);
  const awayFlag = flagFor(m.away, m.awayFlag);
  const o = m.odds || {};
  const pr = m.pick?.probs || { HOME: 0, DRAW: 0, AWAY: 0 };
  const status = predictStatus(m);
  const pick = m.pick?.outcome;
  const score = m.pick?.score;

  return `
    <article class="card status-${status.cls}">
      <div class="card-top">
        <span class="stage">${m.stage || ""}</span>
        <span class="kick">${fmtKick(m.commenceTime)}</span>
      </div>

      <div class="teams">
        <span class="team home"><span class="flag">${homeFlag}</span>${m.home}</span>
        <span class="vs">v</span>
        <span class="team away">${m.away}<span class="flag">${awayFlag}</span></span>
      </div>

      <div class="odds">
        <div class="odd"><span class="lbl">Home</span><span class="val">${o.home ?? "–"}</span><span class="imp">${pct(pr.HOME)}</span></div>
        <div class="odd"><span class="lbl">Draw</span><span class="val">${o.draw ?? "–"}</span><span class="imp">${pct(pr.DRAW)}</span></div>
        <div class="odd"><span class="lbl">Away</span><span class="val">${o.away ?? "–"}</span><span class="imp">${pct(pr.AWAY)}</span></div>
      </div>
      <div class="bar">
        <span class="seg h" style="width:${pct(pr.HOME)}"></span>
        <span class="seg d" style="width:${pct(pr.DRAW)}"></span>
        <span class="seg a" style="width:${pct(pr.AWAY)}"></span>
      </div>

      <div class="suggestion">
        <div class="sug-main">
          <span class="sug-label">Suggested</span>
          <span class="sug-pick ${confClass(pick?.confidence)}">${outcomeText(m)}</span>
          <span class="sug-conf">${pick?.confidence || ""}</span>
        </div>
        ${score ? `<div class="sug-score">${m.home} <strong>${score.home}–${score.away}</strong> ${m.away}</div>` : ""}
      </div>
      ${m.pick?.reason ? `<div class="sug-reason">${m.pick.reason}</div>` : ""}

      <div class="predict ${status.cls}">${status.text}</div>
    </article>`;
}

function render(file) {
  const upcomingOnly = els.upcomingOnly.checked;
  const now = Date.now();
  let matches = [...(file.matches || [])].sort(
    (a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
  // Drop concluded games (kicked off more than ~3h ago) so the board stays current.
  matches = matches.filter((m) => now < new Date(m.commenceTime).getTime() + CONCLUDED_AFTER_MS);
  if (upcomingOnly) matches = matches.filter((m) => new Date(m.commenceTime).getTime() > now);

  els.matches.innerHTML = "";
  if (!matches.length) {
    els.empty.hidden = false;
    els.empty.textContent = file.demo
      ? "Showing demo data. Add your Odds API key (see PREDICTIONS-GUIDE.md) and the robot fills this with live games."
      : upcomingOnly ? "No upcoming games with odds yet." : "No games with odds yet — the robot fills this in on its next run.";
    return;
  }
  els.empty.hidden = true;

  let currentDay = null;
  for (const m of matches) {
    const day = dayKey(m.commenceTime);
    if (day !== currentDay) {
      currentDay = day;
      const h = document.createElement("h2");
      h.className = "day-head";
      h.textContent = day;
      els.matches.appendChild(h);
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = matchCard(m);
    els.matches.appendChild(wrap.firstElementChild);
  }
}

async function refresh() {
  try {
    const [teamsFile, matchesFile] = await Promise.all([
      loadJSON("../data/wc-teams.json"),
      loadJSON("../data/wc-matches.json"),
    ]);
    teamLut = buildTeamLut(teamsFile);
    render(matchesFile);

    if (matchesFile.demo) {
      els.pill.textContent = "Demo data";
      els.pill.className = "pill demo";
    } else {
      els.pill.textContent = "● Live odds";
      els.pill.className = "pill live";
    }
    els.updated.textContent = matchesFile.lastUpdated
      ? "Updated " + new Date(matchesFile.lastUpdated).toLocaleString(undefined,
          { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
    els.error.hidden = true;
  } catch (err) {
    els.error.hidden = false;
    els.error.textContent = `⚠️ ${err.message}. If you opened this file directly, use the hosted link instead — browsers block loading data files from disk.`;
    console.error(err);
  }
}

document.getElementById("how-toggle").addEventListener("click", (e) => {
  const body = document.getElementById("how-body");
  const open = body.hidden;
  body.hidden = !open;
  e.target.setAttribute("aria-expanded", String(open));
  e.target.textContent = open ? "How the suggested picks are made ▴" : "How the suggested picks are made ▾";
});
els.upcomingOnly.addEventListener("change", refresh);

refresh();
setInterval(refresh, REFRESH_MS);
