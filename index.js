import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_ID = process.env.BATTLEMETRICS_SERVER_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);

const BM_URL = `https://api.battlemetrics.com/servers/${SERVER_ID}?include=player`;

// In-memory state (resets on restart, which is fine for this use case)
let previousPlayers = new Map(); // playerId -> playerName
let isFirstRun = true;
let lastServerName = 'Rust Server';
let lastKnownOnlineCount = 0;
let lastCheckTime = null;
let lastError = null;

/**
 * Fetch current server info + online players from BattleMetrics.
 * No API key is required for public server data.
 */
async function fetchServerState() {
  const res = await fetch(BM_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`BattleMetrics API responded with ${res.status}`);
  }

  const data = await res.json();
  const serverName = data?.data?.attributes?.name || 'Rust Server';
  const isOnline = data?.data?.attributes?.status === 'online';

  const players = new Map();
  for (const item of data.included || []) {
    if (item.type === 'player') {
      players.set(item.id, item.attributes?.name || 'Unknown');
    }
  }

  return { serverName, isOnline, players };
}

/** Send an embed to the configured Discord webhook. */
async function sendDiscordEmbed(embed) {
  if (!WEBHOOK_URL) {
    console.warn('[bot] DISCORD_WEBHOOK_URL is not set, skipping notification');
    return;
  }

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    console.error(`[bot] Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}

function buildEmbed({ title, description, color, fields }) {
  return {
    title,
    description,
    color,
    fields: fields || [],
    footer: { text: `Server ID ${SERVER_ID} • BattleMetrics` },
    timestamp: new Date().toISOString(),
  };
}

function listBlock(names) {
  // Discord embed field values max out at 1024 chars — trim if the list is huge
  const lines = names.map((n) => `• ${n}`);
  let text = lines.join('\n');
  if (text.length > 1000) {
    text = text.slice(0, 1000) + `\n…and more`;
  }
  return text;
}

async function checkServer() {
  try {
    const { serverName, isOnline, players } = await fetchServerState();
    lastServerName = serverName;
    lastCheckTime = new Date();
    lastError = null;

    if (!isOnline) {
      lastKnownOnlineCount = 0;
      if (!isFirstRun && previousPlayers.size > 0) {
        await sendDiscordEmbed(
          buildEmbed({
            title: `🔴 ${serverName} is offline`,
            description: 'The server is not responding right now.',
            color: 0xed4245,
          })
        );
      }
      previousPlayers = new Map();
      isFirstRun = false;
      return;
    }

    lastKnownOnlineCount = players.size;

    // First successful check after startup: post a baseline, don't treat everyone as "joined"
    if (isFirstRun) {
      const names = [...players.values()];
      await sendDiscordEmbed(
        buildEmbed({
          title: `👀 Now watching ${serverName}`,
          description:
            names.length > 0
              ? `Currently online (${names.length}):\n${listBlock(names)}`
              : 'No players currently online.',
          color: 0x5865f2,
        })
      );
      previousPlayers = players;
      isFirstRun = false;
      return;
    }

    const joined = [];
    const left = [];

    for (const [id, name] of players) {
      if (!previousPlayers.has(id)) joined.push(name);
    }
    for (const [id, name] of previousPlayers) {
      if (!players.has(id)) left.push(name);
    }

    if (joined.length > 0 || left.length > 0) {
      const fields = [];
      if (joined.length > 0) {
        fields.push({ name: `🟢 Joined (${joined.length})`, value: listBlock(joined), inline: true });
      }
      if (left.length > 0) {
        fields.push({ name: `🔴 Left (${left.length})`, value: listBlock(left), inline: true });
      }

      const color = joined.length > 0 && left.length === 0
        ? 0x57f287 // green
        : joined.length === 0 && left.length > 0
        ? 0xed4245 // red
        : 0xfee75c; // yellow, mixed

      await sendDiscordEmbed(
        buildEmbed({
          title: `${serverName} — ${players.size} online`,
          color,
          fields,
        })
      );
    }

    previousPlayers = players;
  } catch (err) {
    console.error('[bot] Error checking server:', err.message);
    lastError = err.message;
  }
}

// --- HTTP endpoints ---

// Health check for UptimeRobot (also doubles as a quick status view)
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    server: lastServerName,
    online: lastKnownOnlineCount,
    lastCheck: lastCheckTime,
    lastError,
  });
});

// On-demand live lookup (bypasses cached state, useful for debugging)
app.get('/status', async (req, res) => {
  try {
    const { serverName, isOnline, players } = await fetchServerState();
    res.json({
      serverName,
      isOnline,
      count: players.size,
      players: [...players.values()],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[bot] Listening on port ${PORT}`);

  if (!SERVER_ID) console.warn('[bot] BATTLEMETRICS_SERVER_ID is not set!');
  if (!WEBHOOK_URL) console.warn('[bot] DISCORD_WEBHOOK_URL is not set!');

  checkServer();
  setInterval(checkServer, POLL_INTERVAL_MS);
});
