# Rust Online Bot

Watches a Rust server on [BattleMetrics](https://www.battlemetrics.com/) and posts a Discord message whenever someone joins or leaves, using a Discord **webhook** (no bot token / login needed).

Tracking: `https://www.battlemetrics.com/servers/rust/16647013`

## How it works

- A small Express server polls the BattleMetrics public API (`GET /servers/{id}?include=player`) on an interval.
- It compares the current online player list to the previous check.
- If anyone joined or left, it posts an embed to your Discord webhook.
- It also exposes `GET /` (health check) and `GET /status` (live JSON of who's online right now) — `/` is what UptimeRobot will ping to keep the free Render instance awake.

No BattleMetrics API key is required — server player lists are public data.

## 1. Get a Discord webhook URL

1. In Discord, go to your server → the channel you want notifications in → **Edit Channel → Integrations → Webhooks → New Webhook**.
2. Name it (e.g. "Rust Server Watcher"), click **Copy Webhook URL**. Keep this secret — anyone with it can post to your channel.

## 2. Push this project to GitHub

1. Create a new repo on GitHub (e.g. `rust-online-bot`).
2. In this project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/rust-online-bot.git
   git push -u origin main
   ```
   (`.env` is already git-ignored — never commit your real webhook URL.)

## 3. Deploy on Render

1. Go to [render.com](https://render.com) → **New → Web Service**.
2. Connect your GitHub account and pick the `rust-online-bot` repo.
3. Settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine
4. Under **Environment Variables**, add:
   | Key | Value |
   |---|---|
   | `BATTLEMETRICS_SERVER_ID` | `16647013` |
   | `DISCORD_WEBHOOK_URL` | *(paste your webhook URL from step 1)* |
   | `POLL_INTERVAL_MS` | `60000` |
5. Click **Create Web Service**. Render will build and deploy it, then give you a public URL like `https://rust-online-bot.onrender.com`.
6. Visit that URL — you should see a small JSON status response, and shortly after, a "Now watching..." message should appear in your Discord channel.

## 4. Keep it awake with UptimeRobot

Render's free web services spin down after ~15 minutes of no incoming HTTP requests, which would pause the polling. UptimeRobot pings it regularly to keep it alive.

1. Go to [uptimerobot.com](https://uptimerobot.com) → **Add New Monitor**.
2. Monitor type: **HTTP(s)**.
3. URL: your Render URL (e.g. `https://rust-online-bot.onrender.com/`).
4. Monitoring interval: **5 minutes** (the free plan's minimum).
5. Save. UptimeRobot will now hit your `/` endpoint every 5 minutes, keeping the service running so it can keep polling BattleMetrics and posting to Discord.

## Configuration notes

- **`POLL_INTERVAL_MS`** — how often (ms) the bot checks BattleMetrics. `60000` (1 min) is a reasonable default. Avoid going much below `30000` to stay polite to the public API.
- **First run** — on startup the bot posts a "Now watching" message listing whoever's currently online, rather than announcing them all as "joined," then tracks changes from there.
- **State is in-memory** — if Render restarts the service (e.g. redeploy, free-tier spin-down/up), the bot treats the next check as a fresh "first run" and re-announces the current player list instead of a wall of joins. This is intentional and keeps things simple.
- **Server offline** — if BattleMetrics reports the server as offline, you'll get a one-time "is offline" message rather than repeated spam.

## Local testing

```bash
npm install
cp .env.example .env   # then fill in your real values
npm start
```

Visit `http://localhost:3000/status` to see a live snapshot of who's online, and `http://localhost:3000/` for the health check.
