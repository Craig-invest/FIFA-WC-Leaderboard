# 🏆 World Cup 2026 — Pool Leaderboard

A one-page live leaderboard for our 12-person World Cup sweepstake. Each person is
allocated 4 teams; you're ranked by your **single best-performing team**. As teams get
knocked out, their owners slide down the board.

**This is Phase 1:** a fully working page running on *demo data* (a made-up finished
tournament) so you can see exactly how it looks and behaves. Phase 2 adds automatic
live updates from a free football API.

---

## 📁 What's in here (plain English)

| File | What it is | Do you touch it? |
|------|-----------|------------------|
| `index.html` | The web page itself | No |
| `styles.css` | The design/look | No |
| `app.js` | The brain: loads data, ranks everyone | No |
| `data/teams.json` | The 48 World Cup teams + their groups | Rarely |
| **`data/players.json`** | **The 12 people + their 4 teams each** | **YES — after your draft** |
| `data/results.json` | Match results (the robot fills this in Phase 2) | Auto |

---

## ✏️ After your draft: entering the 12 people and their teams

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

> Don't worry about getting it perfect by hand — once you've done your draft, just
> paste the names + teams to me and I'll fill this file in for you and double-check it.

---

## 🌐 Seeing it live (GitHub Pages)

Once this is pushed to GitHub, turn on free hosting:

1. On GitHub, go to the repo → **Settings** → **Pages** (left sidebar).
2. Under **Source**, choose **Deploy from a branch**.
3. Pick branch **`main`** (or whichever you've merged into) and folder **`/ (root)`**, then **Save**.
4. Wait ~1 minute, refresh, and GitHub shows your live link at the top
   (looks like `https://YOURNAME.github.io/fifa-wc-leaderboard/`).
5. That's the link you send your 12 friends. 🎉

> ⚠️ Opening `index.html` by double-clicking it on your computer won't fully work —
> browsers block local file loading. Always use the GitHub Pages link.

---

## 🧮 How the ranking works

1. **Your best team carries you** — only your single strongest team sets your position.
2. **Stage first:** Champions → Final → Semi → Quarter → Round of 16 → Round of 32 → Group.
3. **In the group stage:** points decide it (3 win / 1 draw).
4. **Tie-breakers:** goal difference, then goals scored.

---

*Phase 2 (auto-updates) and the live API wiring come next.*
