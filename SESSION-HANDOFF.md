# 🤝 Session Handoff — continuing this project in a new Claude account

This doc lets a fresh Claude Code session (or a new Claude account) pick up exactly
where the previous one left off. **Read this first**, then `PREDICTIONS-GUIDE.md`
(the prediction tool) and `ADMIN-GUIDE.md` (the leaderboard).

---

## 0. The single most important thing
**The live system runs entirely on GitHub — not inside Claude.** GitHub Actions
runs the robots, GitHub Pages serves the sites, and all API keys live as GitHub
**repository secrets**. So switching Claude accounts changes *nothing* about the
running tools — you're only changing which "developer" edits the code. Nothing to
migrate, no keys to re-enter, no downtime.

---

## 1. What this repo is — TWO separate tools
| Tool | Lives in | Live URL | Robot (GitHub Action) |
|------|----------|----------|------------------------|
| **Pool leaderboard** (12-person sweepstake) | `index.html`, `app.js`, `styles.css`, `data/teams.json`, `data/players.json`, `data/results.json`, `scripts/` | `https://craig-invest.github.io/FIFA-WC-Leaderboard/` | `update-results.yml` |
| **Prediction helper** (personal — odds + suggested picks + email) | `predictions/`, `scripts/wc/`, `data/wc-*.json` | `https://craig-invest.github.io/FIFA-WC-Leaderboard/predictions/` | `wc-predictions.yml` |

They are deliberately **unlinked** (separate pages, scripts, data, workflows). The
prediction helper reuses a couple of the leaderboard's *pure* helper functions
(`scripts/lib/transform.mjs`) for group standings — backend only, no UI link.

---

## 2. ⚠️ Critical repo conventions / gotchas (learned the hard way)
1. **Default branch is `claude/amazing-ramanujan-yRbeg`** — NOT `main`. GitHub
   Pages builds from it, and GitHub registers/runs the workflows from it.
   - `main` is a stale leftover; ignore it.
   - **Dev workflow:** branch off `claude/amazing-ramanujan-yRbeg`, open a PR back
     into it, squash-merge. (PRs are created/merged via the GitHub MCP tools.)
2. **Never commit with `[skip ci]`** in auto-commit messages — it suppresses the
   `pages-build-deployment` rebuild, so the live site goes stale. Both robots
   already commit without it; keep it that way.
3. **The GitHub MCP token cannot edit files under `.github/workflows/`** (401). To
   change a workflow file, edit it **locally and `git push`** (local git has the
   `workflows` scope), then PR/merge.
4. **PR data-file conflicts:** because we squash-merge, re-merging the default
   branch into a feature branch shows add/add conflicts. Resolve by taking **your
   branch's version for all code**, and **the default branch's `data/wc-notified.json`**
   (so already-emailed games don't re-send). `data/wc-matches.json` is regenerated
   by the next robot run, so either side is fine.
5. **After merging a code change, trigger the workflow** (`Run workflow`) so the
   robot regenerates `data/wc-matches.json` with the new logic — otherwise the
   merge may leave the seeded demo file live until the next scheduled run.
6. **The sandbox has a host allowlist** — Claude can't `curl`/WebFetch arbitrary
   sites (e.g. odds/schedule feeds) from here, but the GitHub Actions runner has
   open internet, so the robots work in production. `WebSearch` does work for research.

---

## 3. Prediction helper — how it works
**Data flow (every 6 h via `wc-predictions.yml`):**
1. `scripts/wc/fetch-odds.mjs` pulls World Cup odds from **The Odds API**
   (`soccer_fifa_world_cup`, markets `h2h` + `totals`, region `uk`).
2. Reduces each game's bookmakers to consensus odds → de-vigs to probabilities
   (`scripts/wc/lib/picks.mjs`).
3. Derives **group round** (1/2/3) from the schedule (date-order within each group)
   and, for round-3 games, checks **does a draw send both teams through?**
   (`scripts/wc/lib/qualify.mjs`, using API-Football standings — dormant if no key).
4. Computes the pick + writes `data/wc-matches.json` (the page reads this).
5. Emails ONE digest of games kicking off in the next ~2 days (SMTP via Gmail),
   deduped through `data/wc-notified.json`.
6. Knockout fixtures shown as "teams & odds to be confirmed" placeholders
   (`data/wc-knockouts.json`) until odds exist. Concluded games (kicked off > 3 h
   ago) are pruned/hidden.

**The pick logic (`PICK_CONFIG` at the top of `scripts/wc/lib/picks.mjs` — all tunable):**
- **Outcome** = the favourite, unless *incredibly tight* (no side reaches
  `draw_tight = 0.40` no-vig win prob) → **DRAW**.
- **Scoreline** = the historic modal score for the stage (maximises the Superbru
  exact-3.0 bucket):
  - favourite ≥ `walkover = 0.70` → **2-0**
  - draw → **1-1**
  - tight win, **group round 1** → **2-1** (opening games run higher)
  - tight win, **round 2 onward incl. knockouts** → **1-0**
- **Situational draw boost:** round-3 group games where a draw qualifies BOTH teams
  → `p_draw × draw_boost (1.125)`.
- Every pick carries a plain-language `reason` string (shown on the card + email).

**Scoring context (Superbru):** 3 = exact, 1.5 = right result + close, 1 = right
result only, 0 = wrong. Exact dominates, so we predict the most likely *exact*
score per stage (validated against historic data in `scripts/wc/test/modal.test.mjs`).

**Tests (run `npm run test:predictions`):** `picks`, `parse`, `decide`, `qualify`,
`modal` — ~79 assertions. CI runs them on every robot run.

---

## 4. GitHub repository secrets (Settings → Secrets and variables → Actions)
These persist on GitHub regardless of Claude account.

| Secret | Used by | Purpose |
|--------|---------|---------|
| `ODDS_API_KEY` | prediction helper | the-odds-api.com (odds) |
| `API_FOOTBALL_KEY` | prediction helper | API-Football standings → round-3 draw boost (optional; boost just stays off if absent) |
| `GMAIL_USER` | prediction helper | sender Gmail address |
| `GMAIL_APP_PASSWORD` | prediction helper | Google app password (not the normal password) |
| `ALERT_TO` | prediction helper | where the reminder email is sent |
| `FOOTBALL_DATA_TOKEN` | leaderboard | results source for the leaderboard robot |

---

## 5. What to do on the NEW Claude account (one-time)
1. **Sign in** to the new account at claude.ai (and/or the Claude Code web app).
2. **Connect GitHub:** authorise Claude's GitHub integration and grant access to
   the **`Craig-invest/FIFA-WC-Leaderboard`** repo. (Settings → Connectors/GitHub,
   or you'll be prompted when you add the repo to a session.)
3. **Start a Claude Code session on this repo**, and tell it to develop on a feature
   branch off `claude/amazing-ramanujan-yRbeg` and PR back into it (see §2).
4. **Network policy:** pick one that allows GitHub + web access (so Claude can use
   the GitHub tools and `WebSearch` for research). Docs:
   https://code.claude.com/docs/en/claude-code-on-the-web
5. **Nothing to re-enter:** GitHub secrets, Pages config, the default-branch setup,
   and the cron schedules all live on GitHub and are untouched by the account switch.
6. *(Optional)* If you want Claude itself to read your Gmail/Calendar in-chat, you'd
   reconnect those connectors on the new account — but note the **reminder emails do
   NOT use that**; they're sent by GitHub Actions via the Gmail app-password secret,
   so they keep working either way.

---

## 6. Handy commands
```bash
npm run test:predictions   # all prediction-helper unit tests
npm run update:odds        # run the odds robot locally (needs ODDS_API_KEY in env)
npm run serve              # serve locally → http://localhost:8099/predictions/
```
- Force a live refresh: GitHub **Actions → "WC prediction helper" → Run workflow**.
- Tune picks: edit `PICK_CONFIG` in `scripts/wc/lib/picks.mjs`.
- Change refresh cadence: the `cron` in `.github/workflows/wc-predictions.yml`
  (currently `0 */6 * * *` = every 6 h).

---

## 7. Kickoff prompt for the new account
Paste this as your first message in the new account's session on this repo:

> I'm continuing work on my FIFA World Cup 2026 repo. Please read `SESSION-HANDOFF.md`,
> then `PREDICTIONS-GUIDE.md` and `ADMIN-GUIDE.md`, and confirm you understand the
> two tools, the branch/Pages setup (default branch `claude/amazing-ramanujan-yRbeg`,
> never `[skip ci]`), and the prediction pick logic. Then wait for my next request.
