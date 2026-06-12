# 🏆 World Cup 2026 — Pool Leaderboard

A one-page live leaderboard for our 12-person World Cup sweepstake. Each person is
allocated 4 teams; you're ranked by your **single best-performing team**. As teams get
knocked out, their owners slide down the board.

- **Phase 1 ✅** — the working, good-looking page (currently showing *demo data*).
- **Phase 2 ✅** — the robot that auto-fetches real results from a free football API.
- **Phase 3 ⏳** — go live on GitHub Pages + plug in the API key (your steps below).

---

## 📁 What's in here (plain English)

| File | What it is | Do you touch it? |
|------|-----------|------------------|
| `index.html` | The web page itself | No |
| `styles.css` | The design/look | No |
| `app.js` | The brain: loads data, ranks everyone | No |
| `data/teams.json` | The 48 World Cup teams + their groups | Rarely |
| **`data/players.json`** | **The 12 people + their 4 teams each** | **YES — after your draft** |
| `data/results.json` | Match results (the robot fills this automatically) | Auto |
| `scripts/` | The robot + its tests | No |
| `.github/workflows/` | The schedule that runs the robot | No |

---

## ✏️ Step 1 — After your draft: enter the 12 people and their teams

Open **`data/players.json`**. You'll see 12 lines like this:

```json
{ "name": "Craig", "teams": ["ARG", "SWE", "CIV", "CUW"] },
```

1. Change `"Craig"` to the real person's name.
2. Change the 4 codes to that person's 4 teams.
3. The codes are 3-letter team codes — the full list is in `data/teams.json`
   (e.g. `BRA` = Brazil, `ENG` = England, `MEX` = Mexico).

**Rules:** every person needs exactly 4 teams, and all 48 teams should be used
exactly once across the group (no team owned by two people).

> Don't worry about doing this perfectly by hand — once you've done your draft, just
> paste the names + teams to me and I'll fill this file in and double-check it.

---

## 🌐 Step 2 — Go live (free hosting on GitHub Pages)

1. On GitHub, open the repo → **Settings** → **Pages** (left sidebar).
2. Under **Source**, choose **Deploy from a branch**.
3. Pick your branch and folder **`/ (root)`**, then **Save**.
4. Wait ~1 minute, refresh, and GitHub shows your live link at the top
   (like `https://YOURNAME.github.io/fifa-wc-leaderboard/`).
5. That's the link you send your 12 friends. 🎉

> ⚠️ Double-clicking `index.html` on your computer won't fully work — browsers block
> local file loading. Always use the GitHub Pages link (or run `npm run serve` locally).

---

## 🤖 Step 3 — Turn on automatic live updates

The robot is already built. It just needs a free API token to fetch real results.

We use **[football-data.org](https://www.football-data.org/)** — the World Cup is on its
free tier (free forever), and it posts finished results promptly. Results update **after
each match finishes** (not minute-by-minute in-play — that's a paid feature everywhere).
If football-data.org is ever down, the robot automatically falls back to the free
[openfootball](https://github.com/openfootball/worldcup.json) dataset.

### 3a. Get a free API token (3 minutes)
1. Register at **https://www.football-data.org/client/register**.
2. They email you an **API token** (a long string of letters/numbers).
3. ⚠️ Click the **verify-email** link in that email, or the free account is auto-deleted
   for inactivity.

### 3b. Give the token to GitHub (kept secret, never in the code)
1. On GitHub: repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name it exactly: `FOOTBALL_DATA_TOKEN`
4. Paste your token into the value box → **Add secret**.

### 3c. Switch it on
- Go to the **Actions** tab → enable workflows if prompted.
- Open **"Update World Cup results"** → **Run workflow** to test it immediately.
- After that it runs **several times a day automatically** and commits fresh results.
  GitHub Pages then shows the update within a minute. Set-and-forget. ✅

---

## 🛟 Manual override (if the API is ever wrong or late)

You're never stuck waiting on the API. To take manual control:

1. Open `data/results.json` and add `"manual": true` near the top.
2. Edit any team's line by hand, e.g. mark a team out:
   `"stage": "qf", "eliminated": true`.
3. While `"manual": true` is set, the robot **won't overwrite your edits**.
   Remove that line to hand control back to the robot.

`stage` can be: `group`, `r32`, `r16`, `qf`, `sf`, `final`, or `champion`.

---

## 🧮 How the ranking works

1. **Your best team carries you** — only your single strongest team sets your position.
2. **Stage first:** Champions → Final → Semi → Quarter → Round of 16 → Round of 32 → Group.
3. **In the group stage:** points decide it (3 win / 1 draw).
4. **Tie-breakers:** goal difference, then goals scored.

---

## 🧑‍💻 For the technically curious (optional)

```bash
npm test          # run the unit tests for the results-transform logic
npm run serve     # serve the page locally at http://localhost:8099
npm run update    # fetch results now (needs FOOTBALL_DATA_TOKEN in your environment)
```

- The robot fetches the World Cup (`competitions/WC/matches`) from football-data.org
  (falling back to openfootball), normalises each source to a common fixture shape
  (`scripts/lib/footballdata.mjs`, `scripts/lib/openfootball.mjs`), then derives the
  whole table — group points, stage reached, eliminations, champion — in
  `scripts/lib/transform.mjs`. All of it is covered by unit tests in `scripts/test/`.
- Safety: the robot **won't** overwrite good data if the API errors or returns nothing,
  and it respects the `"manual": true` override.
