import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const KICK_CHANNEL = (process.env.KICK_CHANNEL || '').replace('https://kick.com/', '').replace('@', '').trim();
const MANUAL_CHATROOM_ID = (process.env.KICK_CHATROOM_ID || '').trim();
const PUSHER_KEY = '32cbd69e4b950bf97679';
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.6.0&flash=false`;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/overlay', (req, res) => {
  res.sendFile(path.join(publicDir, 'overlay.html'));
});

const state = {
  channel: KICK_CHANNEL,
  chatroomId: MANUAL_CHATROOM_ID || null,
  connected: false,
  locked: false,
  correctSide: null,
  votes: new Map(), // usernameLower -> { username, side, at }
  recent: [],
  winners: [],
  lastError: null,
  startedAt: new Date().toISOString()
};

const aliases = new Map([
  ['1', '1'], ['yes', '1'], ['y', '1'], ['over', '1'], ['red', '1'], ['left', '1'],
  ['2', '2'], ['no', '2'], ['n', '2'], ['under', '2'], ['black', '2'], ['right', '2']
]);

function publicState() {
  const votes = [...state.votes.values()];
  const side1 = votes.filter(v => v.side === '1').length;
  const side2 = votes.filter(v => v.side === '2').length;
  return {
    channel: state.channel,
    chatroomId: state.chatroomId,
    connected: state.connected,
    locked: state.locked,
    correctSide: state.correctSide,
    total: votes.length,
    side1,
    side2,
    recent: state.recent.slice(0, 20),
    winners: state.winners.slice(0, 20),
    lastError: state.lastError,
    startedAt: state.startedAt
  };
}

function broadcast() {
  io.emit('state', publicState());
}

function normalizeMessageText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function extractChatPayload(event) {
  let data = event?.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  return data || null;
}

function getUsername(payload) {
  return payload?.sender?.username || payload?.sender?.name || payload?.user?.username || payload?.username || payload?.sender_username || null;
}

function getMessage(payload) {
  return payload?.content || payload?.message || payload?.text || payload?.body || '';
}

function handleChatMessage(payload) {
  const username = getUsername(payload);
  const message = normalizeMessageText(getMessage(payload));
  if (!username || !message) return;

  const match = message.match(/^!vote\s+([^\s]+)/i);
  if (!match) return;

  if (state.locked) {
    state.recent.unshift({ username, side: 'ignored locked', at: new Date().toISOString() });
    state.recent = state.recent.slice(0, 40);
    broadcast();
    return;
  }

  const requested = match[1].toLowerCase();
  const side = aliases.get(requested);
  if (!side) return;

  const key = username.toLowerCase();
  const vote = { username, side, at: new Date().toISOString() };
  state.votes.set(key, vote);
  state.recent.unshift(vote);
  state.recent = state.recent.slice(0, 40);
  broadcast();
}

async function resolveChatroomId(slug) {
  if (MANUAL_CHATROOM_ID) return MANUAL_CHATROOM_ID;
  if (!slug) throw new Error('Missing KICK_CHANNEL in .env');

  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'accept': 'application/json,text/plain,*/*',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'referer': `https://kick.com/${slug}`
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const id = data?.chatroom?.id || data?.livestream?.chatroom?.id || data?.chatroom_id;
      if (id) return String(id);
    } catch (err) {
      // Try the next endpoint.
    }
  }

  throw new Error('Could not resolve Kick chatroom ID. Add KICK_CHATROOM_ID manually in .env.');
}

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

async function connectKick() {
  clearTimeout(reconnectTimer);

  try {
    state.chatroomId = await resolveChatroomId(KICK_CHANNEL);
    state.lastError = null;
  } catch (err) {
    state.connected = false;
    state.lastError = err.message;
    broadcast();
    scheduleReconnect();
    return;
  }

  ws = new WebSocket(PUSHER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });

  ws.on('open', () => {
    state.connected = true;
    state.lastError = null;
    reconnectAttempt = 0;
    broadcast();
  });

  ws.on('message', (buf) => {
    let event;
    try { event = JSON.parse(buf.toString()); } catch { return; }

    if (event.event === 'pusher:connection_established') {
      const channels = [`chatrooms.${state.chatroomId}.v2`, `chatroom.${state.chatroomId}`];
      for (const channel of channels) {
        ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }));
      }
      return;
    }

    if (event.event === 'pusher:ping') {
      ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      return;
    }

    if (event.event === 'App\\Events\\ChatMessageEvent' || event.event === 'App\\Events\\MessageSentEvent') {
      const payload = extractChatPayload(event);
      handleChatMessage(payload);
    }
  });

  ws.on('close', () => {
    state.connected = false;
    broadcast();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    state.connected = false;
    state.lastError = err.message;
    broadcast();
  });
}

function scheduleReconnect() {
  const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt++));
  reconnectTimer = setTimeout(connectKick, delay);
}

io.on('connection', (socket) => {
  socket.emit('state', publicState());
});

app.post('/api/reset', (req, res) => {
  state.locked = false;
  state.correctSide = null;
  state.votes.clear();
  state.recent = [];
  state.winners = [];
  broadcast();
  res.json(publicState());
});

app.post('/api/lock', (req, res) => {
  state.locked = true;
  broadcast();
  res.json(publicState());
});

app.post('/api/unlock', (req, res) => {
  state.locked = false;
  broadcast();
  res.json(publicState());
});

app.post('/api/correct', (req, res) => {
  const side = String(req.body?.side || '');
  if (!['1', '2'].includes(side)) return res.status(400).json({ error: 'side must be 1 or 2' });
  state.correctSide = side;
  broadcast();
  res.json(publicState());
});

app.post('/api/pick', (req, res) => {
  let side = String(req.body?.side || state.correctSide || 'winning');
  const totals = publicState();
  if (side === 'winning') side = totals.side1 >= totals.side2 ? '1' : '2';
  if (!['1', '2'].includes(side)) return res.status(400).json({ error: 'Pick a correct side first.' });

  const pool = [...state.votes.values()].filter(v => v.side === side);
  if (!pool.length) return res.status(400).json({ error: `No voters on side ${side}.` });

  const winner = pool[Math.floor(Math.random() * pool.length)];
  const result = { ...winner, pickedFromSide: side, pickedAt: new Date().toISOString(), poolSize: pool.length };
  state.winners.unshift(result);
  state.winners = state.winners.slice(0, 20);
  broadcast();
  res.json(result);
});

app.get('/api/export.csv', (req, res) => {
  const rows = [['username', 'side', 'voted_at']];
  for (const v of state.votes.values()) rows.push([v.username, v.side, v.at]);
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kick-votes.csv"');
  res.send(csv);
});

server.listen(PORT, () => {
  console.log(`Kick Vote Bot running: http://localhost:${PORT}`);
  console.log(`OBS overlay: http://localhost:${PORT}/overlay`);
  connectKick();
});
