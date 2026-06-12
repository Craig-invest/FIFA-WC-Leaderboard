# 🛠️ Admin Guide — running & fixing the leaderboard

Short, plain-English guide for you (the site owner). No coding needed.

---

## ⚡ Quick reference

| I want to… | Do this |
|------------|---------|
| Force a fresh pull from the API right now | **Run workflow** button (Section 1) |
| Fix a score the API got wrong / is missing | **Manual override** (Section 2) |
| Hand control back to the robot | Remove `"manual": true` (Section 2) |
| See if the robot is working | **Actions tab** → look for green ticks (Section 3) |

---

## 1. Force an immediate update (the "Run now" button)

Use this when a game has finished and you don't want to wait for the next
scheduled run — the API has the right data, you just want it pulled *now*.

1. Go to the **Actions** tab:
   https://github.com/Craig-invest/FIFA-WC-Leaderboard/actions
2. In the left list, click **"Update World Cup results"**.
3. On the right, click **Run workflow** → then the green **Run workflow** button.
4. Wait ~30 seconds. A new run appears with a spinning icon, then a green ✓.
5. Your live site updates within ~1 minute. (Hard-refresh if needed.)

✅ Works on your phone too (GitHub app or mobile browser).
✅ Free — uses 1 of your ~100 daily API requests.

---

## 2. Manually fix a score (when the API is wrong or behind)

Use this when clicking "Run workflow" *won't* help — because the data source
itself is wrong or hasn't updated. You take temporary manual control.

### Turn manual mode ON
1. Open the results file on GitHub:
   https://github.com/Craig-invest/FIFA-WC-Leaderboard/blob/main/data/results.json
2. Click the ✏️ **pencil** (top-right of the file) to edit.
3. Near the very top, find the line `"demo": ...` and add this line below it:
   ```json
   "manual": true,
   ```
4. Now edit whichever team is wrong. Each team looks like this:
   ```json
   "BRA": { "p": 3, "w": 2, "d": 1, "l": 0, "gf": 6, "ga": 1, "pts": 7, "stage": "r16", "eliminated": false },
   ```
   - `p` = played, `w/d/l` = win/draw/loss, `gf/ga` = goals for/against,
     `pts` = points, `stage` = how far they've got, `eliminated` = knocked out?
   - `stage` can be: `group`, `r32`, `r16`, `qf`, `sf`, `final`, `champion`
   - Example — to mark a team knocked out in the quarter-finals:
     `"stage": "qf", "eliminated": true`
5. Scroll down, click **Commit changes**.

➡️ While `"manual": true` is set, **the robot will NOT overwrite your edits.**
   Your corrections stay put.

### Turn manual mode OFF (hand control back to the robot)
1. Edit the same file again.
2. Delete the `"manual": true,` line.
3. **Commit changes.** Next scheduled run resumes auto-updates.

> 💡 Tip: most of the time you won't need this. It's your safety net for when
> the data source is wrong and you want the board correct anyway.

---

## 3. Check the robot is healthy

1. **Actions** tab: https://github.com/Craig-invest/FIFA-WC-Leaderboard/actions
2. Green ✓ = ran fine. Red ✗ = something failed (click it to see why —
   usually a missing/expired API token).
3. The leaderboard also shows a timestamp ("Updated …") so you can see at a
   glance how fresh the data is.

---

## 4. Common gotchas

- **Board looks stale in my browser but fine elsewhere** → browser cache.
  Hard-refresh: Cmd/Ctrl + Shift + R (desktop) or pull-to-refresh (mobile).
- **Red ✗ on every run** → the `FOOTBALL_DATA_TOKEN` secret is missing/wrong/expired
  (football-data.org deletes unverified accounts). Re-add it: repo **Settings →
  Secrets and variables → Actions**. (Even if it expires, the robot falls back to
  openfootball, so the board keeps updating — just less promptly.)
- **Edited results.json and it broke** → JSON is fussy about commas/quotes.
  If unsure, paste the change to me and I'll check it.
