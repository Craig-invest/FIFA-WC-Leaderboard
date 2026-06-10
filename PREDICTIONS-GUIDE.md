# 🎯 Prediction Helper — setup & guide

A **personal** tool (just for you) that lists every World Cup game with **live
odds** and a **suggested pick** — both an outcome (Home/Draw/Away) and a likely
scoreline — and **emails you one digest** of the games kicking off in ~2 days so
you can lodge your predictions in time.

> This is completely separate from the pool **leaderboard**. Different page,
> different robot, different data files — they don't touch each other.

- **The page:** `https://Craig-invest.github.io/FIFA-WC-Leaderboard/predictions/`
- **The robot:** GitHub Actions workflow *"WC prediction helper"*, every 6 hours.

---

## ⚡ What you need to do once (~10 minutes)

You add **4 secrets** to the repo. Nothing goes in the code.

> Repo → **Settings → Secrets and variables → Actions → New repository secret**

### 1. Odds API key — `ODDS_API_KEY`
1. Go to **https://the-odds-api.com/** → **Get API key** (free plan).
2. Copy the key.
3. Add it as a secret named exactly `ODDS_API_KEY`.

*Free plan = 500 credits/month. The robot uses ~2 credits per run × 4 runs/day
≈ 240/month — comfortably inside the limit.*

### 2–4. Email (Gmail app password)
The robot emails from your own Gmail using an **app password** (not your normal
password). This works even with 2-factor on.

1. Turn on 2-Step Verification (if not already): https://myaccount.google.com/security
2. Create an app password: https://myaccount.google.com/apppasswords
   → pick "Mail" / "Other", name it "WC picks", copy the 16-character code.
3. Add **three** secrets:
   - `GMAIL_USER` → your full Gmail address (e.g. `craig@gmail.com`)
   - `GMAIL_APP_PASSWORD` → the 16-character app password (spaces are fine)
   - `ALERT_TO` → where reminders should go (your email — can be the same one)

### Then switch it on
1. **Actions** tab → enable workflows if prompted.
2. Open **"WC prediction helper"** → **Run workflow** to test immediately.
3. After that it runs every 6 hours automatically. Done. ✅

> Make sure GitHub Pages is on (it already is for the leaderboard):
> Settings → Pages → Deploy from branch → `/ (root)`. The page is at `/predictions/`.

---

## 📬 How the email works

- Every run, the robot finds games kicking off in the **next ~2 days** that it
  **hasn't already emailed**, and sends **one digest** listing them all (odds,
  implied %, suggested outcome + score). No spam — each game is emailed once.
- It records emailed games in `data/wc-notified.json` so you never get a repeat.

Want the reminder earlier/later? Change `EMAIL_LEAD_HOURS` in
`.github/workflows/wc-predictions.yml` (default `60` ≈ 2.5 days).

---

## 🧮 How a suggested pick is decided

1. **Odds → probability:** decimal odds become implied probabilities, then the
   bookmaker's margin is removed so Home/Draw/Away sum to 100%.
2. **Outcome:** the highest of the three, labelled **Strong** (≥55%),
   **Lean** (40–55%) or **Toss-up**.
3. **Scoreline:** expected goals are estimated from the over/under market and
   split between the teams (a simple Poisson model) to find the most likely
   exact score that matches the suggested outcome.

It's a data-driven nudge from the betting market — not a guarantee.

---

## 🛟 Troubleshooting

| Symptom | Fix |
|---------|-----|
| Page says "Demo data" | The robot hasn't run yet, or `ODDS_API_KEY` is missing. Add the secret and **Run workflow**. |
| No email arrived | Check the **Actions** run is green; confirm `GMAIL_*` + `ALERT_TO` secrets; check spam. Reminders only fire when a game enters the 2-day window. |
| A team shows a 🏳️ blank flag | The odds API spelled its name differently. Add that spelling to the team's `aliases` in `data/wc-teams.json`. |
| Red ✗ on every run | Usually a missing/wrong `ODDS_API_KEY`. Re-add it under Settings → Secrets. |
| Want more "live" odds | Lower the cron interval in the workflow (watch your credit budget). |

---

## 🧑‍💻 For the curious

```bash
npm run test:predictions   # unit + integration tests for the pick logic
npm run update:odds        # fetch odds now (needs ODDS_API_KEY in your environment)
npm run serve              # serve locally → http://localhost:8099/predictions/
```

- Pick maths lives in `scripts/wc/lib/picks.mjs` (covered by `picks.test.mjs`).
- The robot is `scripts/wc/fetch-odds.mjs` (parsing covered by `parse.test.mjs`).
- Safety: if the Odds API errors or returns nothing, the robot **won't** wipe the
  last good odds — the page keeps showing what it had.
