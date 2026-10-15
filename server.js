const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = Number(process.env.PORT || 3000);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// A deliberately small MVP dictionary. Production will replace this with a
// reviewed list of Hebrew common nouns in singular form.
const WORDS = [
  'אור','אוזן','אוצר','אוכל','אולם','אופק','אושר','אוויר','אויב','איש','ארון','אריה','ארץ','אש','אשכול',
  'בגד','בובה','בוץ','בור','בית','ביצה','בירה','ברז','ברק','בשר','גג','גוף','גול','גשר','גן','גזר','גל','גלגל',
  'דג','דגל','דלי','דלת','דם','דף','דקה','דוב','דור','דרך','הר','הרגל','זהב','זאב','זנב','זמן','זר','חבל',
  'חדר','חול','חום','חוף','חוט','חוק','חור','חלון','חלום','חלב','חץ','חתול','יד','ידע','יין','ים','יער','כדור',
  'כובע','כוכב','כוס','כיס','כיסא','כפר','כור','כביש','כלב','כתב','כתר','לחם','לוח','לב','לילה','לשון','מגדל',
  'מדף','מזל','מטבע','מיטה','מים','מכונה','מכולה','מכללה','מכתב','מלך','מסך','מסר','מעיל','מפתח','מרק','משחק',
  'נבואה','נחל','נמר','נר','נשר','סוס','סיר','סלע','ספר','עור','עין','עיר','עץ','ענן','עוף','עכבר','פה','פח','פיל',
  'פנס','פרח','צבע','צד','ציד','ציוד','ציר','צל','צלחת','צמר','צור','קיר','קול','קור','קרח','קרן','ראש','רגל',
  'רוח','רחוב','רכב','שולחן','שור','שוק','שיר','שמש','שעון','שער','תוף','תור','תיק','תמונה','תפוח','תכונה',
  'תבונה','תבואה','מבואה','מבוכה','שכונה','מפה','קפה','יפה','שפה','ספה','קופה','תקופה','טיפה','כיפה','קליפה',
  'חיה','חידה','יחידה','ילד','ילדה','לידה','מידה','עבודה','עובד','עולם','סולם','שלום','חלום','אלום','מקום',
  'מקל','משקל','שקל','שק','שקית','קשית','כרית','ברית','בית','זית','חיל','חול','קול','כלי','דלי','טלי','טיל',
  'שביל','תבשיל','בישול','חישול','גידול','טיפול','טיול','ציור','סיפור','ציפור','כדור','כפור','תנור','צינור'
];

const FINAL_MAP = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const dictionary = new Set(WORDS.map(normalize));
const rooms = new Map();

function normalize(value = '') {
  return String(value)
    .trim()
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^א-ת]/g, '')
    .split('')
    .map((letter) => FINAL_MAP[letter] || letter)
    .join('');
}

function oneEditApart(aRaw, bRaw) {
  const a = normalize(aRaw);
  const b = normalize(bRaw);
  if (!a || !b || a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let differences = 0;
    for (let i = 0; i < a.length; i += 1) differences += a[i] !== b[i] ? 1 : 0;
    return differences === 1;
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else {
      skipped += 1;
      j += 1;
      if (skipped > 1) return false;
    }
  }
  return true;
}

function neighbors(word, used = new Set()) {
  return WORDS.filter((candidate) => {
    const key = normalize(candidate);
    return !used.has(key) && key !== normalize(word) && oneEditApart(word, candidate);
  });
}

const starterPool = WORDS.filter((word) => neighbors(word).length >= 3);

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

function token() {
  return crypto.randomBytes(18).toString('base64url');
}

function cleanName(name) {
  const result = String(name || '').trim().slice(0, 18);
  return result || 'שחקן';
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    timerSeconds: room.timerSeconds,
    players: room.players.map((player, index) => player ? {
      index,
      name: player.name,
      ready: player.ready,
      connected: Boolean(player.ws && player.ws.readyState === WebSocket.OPEN),
      joker: player.joker
    } : null),
    roulette: room.roulette ? {
      words: room.roulette.words,
      startedAt: room.roulette.startedAt,
      stoppedBy: room.roulette.stoppedBy
    } : null,
    currentWord: room.currentWord,
    activePlayer: room.activePlayer,
    deadline: room.deadline,
    history: room.history,
    pendingAppeal: room.pendingAppeal ? {
      word: room.pendingAppeal.word,
      by: room.pendingAppeal.by,
      judge: room.pendingAppeal.judge
    } : null,
    winner: room.winner,
    reason: room.reason
  };
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, type = 'state') {
  const state = publicRoom(room);
  room.players.forEach((player) => player && send(player.ws, { type, state }));
}

function error(ws, message) {
  send(ws, { type: 'error', message });
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
}

function startTurn(room, playerIndex) {
  clearTurnTimer(room);
  room.activePlayer = playerIndex;
  room.deadline = Date.now() + room.timerSeconds * 1000;
  room.turnTimer = setTimeout(() => finish(room, 1 - playerIndex, 'time'), room.timerSeconds * 1000 + 50);
  broadcast(room);
}

function finish(room, winner, reason) {
  clearTurnTimer(room);
  room.phase = 'finished';
  room.winner = winner;
  room.reason = reason;
  room.deadline = null;
  room.activePlayer = null;
  broadcast(room);
}

function resetRound(room) {
  clearTurnTimer(room);
  room.phase = 'lobby';
  room.players.forEach((player) => {
    if (player) {
      player.ready = false;
      player.joker = 1;
    }
  });
  room.roulette = null;
  room.currentWord = null;
  room.activePlayer = null;
  room.deadline = null;
  room.history = [];
  room.pendingAppeal = null;
  room.winner = null;
  room.reason = null;
  broadcast(room);
}

function beginRoulette(room) {
  const pool = starterPool.length >= 12 ? starterPool : WORDS.filter((word) => neighbors(word).length);
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(24, pool.length));
  room.phase = 'roulette';
  room.roulette = { words: shuffled, startedAt: Date.now() + 600, stoppedBy: null };
  broadcast(room);
}

function submitAcceptedWord(room, playerIndex, word) {
  clearTurnTimer(room);
  room.currentWord = word;
  room.history.push({ word, player: playerIndex, at: Date.now() });
  room.pendingAppeal = null;
  startTurn(room, 1 - playerIndex);
}

function requirePlayer(ws) {
  if (!ws.room || ws.playerIndex === undefined) return null;
  const player = ws.room.players[ws.playerIndex];
  return player && player.id === ws.playerId ? player : null;
}

function handleMessage(ws, message) {
  let data;
  try { data = JSON.parse(message.toString()); } catch { return error(ws, 'הודעה לא תקינה'); }

  if (data.type === 'create_room') {
    let roomCode;
    do { roomCode = code(); } while (rooms.has(roomCode));
    const playerId = token();
    const room = {
      code: roomCode,
      phase: 'lobby',
      timerSeconds: [15, 30, 60].includes(Number(data.timerSeconds)) ? Number(data.timerSeconds) : 30,
      players: [{ id: playerId, name: cleanName(data.name), ready: false, joker: 1, ws }, null],
      roulette: null,
      currentWord: null,
      activePlayer: null,
      deadline: null,
      history: [],
      pendingAppeal: null,
      winner: null,
      reason: null,
      turnTimer: null,
      createdAt: Date.now()
    };
    rooms.set(roomCode, room);
    ws.room = room;
    ws.playerIndex = 0;
    ws.playerId = playerId;
    send(ws, { type: 'joined', playerIndex: 0, playerId, state: publicRoom(room) });
    return;
  }

  if (data.type === 'join_room') {
    const roomCode = String(data.roomCode || '').toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return error(ws, 'החדר לא נמצא');
    const reconnectIndex = room.players.findIndex((player) => player && player.id === data.playerId);
    let playerIndex = reconnectIndex;
    let playerId = data.playerId;
    if (playerIndex < 0) {
      if (room.players[1]) return error(ws, 'החדר כבר מלא');
      if (room.phase !== 'lobby') return error(ws, 'המשחק כבר התחיל');
      playerIndex = 1;
      playerId = token();
      room.players[1] = { id: playerId, name: cleanName(data.name), ready: false, joker: 1, ws };
    } else {
      room.players[playerIndex].ws = ws;
      if (data.name) room.players[playerIndex].name = cleanName(data.name);
    }
    ws.room = room;
    ws.playerIndex = playerIndex;
    ws.playerId = playerId;
    send(ws, { type: 'joined', playerIndex, playerId, state: publicRoom(room) });
    broadcast(room);
    return;
  }

  const player = requirePlayer(ws);
  if (!player) return error(ws, 'יש להצטרף לחדר קודם');
  const room = ws.room;
  const me = ws.playerIndex;

  if (data.type === 'set_timer') {
    if (room.phase !== 'lobby' || me !== 0) return error(ws, 'לא ניתן לשנות זמן עכשיו');
    const value = Number(data.timerSeconds);
    if (![15, 30, 60].includes(value)) return error(ws, 'זמן לא תקין');
    room.timerSeconds = value;
    room.players.forEach((p) => { if (p) p.ready = false; });
    return broadcast(room);
  }

  if (data.type === 'ready') {
    if (room.phase !== 'lobby' || !room.players[1]) return error(ws, 'מחכים לשחקן נוסף');
    player.ready = Boolean(data.ready);
    if (room.players.every((p) => p && p.ready)) beginRoulette(room);
    else broadcast(room);
    return;
  }

  if (data.type === 'stop_roulette') {
    if (room.phase !== 'roulette' || room.roulette.stoppedBy !== null) return;
    const elapsed = Math.max(0, Date.now() - room.roulette.startedAt);
    const index = Math.floor(elapsed / 110) % room.roulette.words.length;
    room.roulette.stoppedBy = me;
    room.currentWord = room.roulette.words[index];
    room.history = [{ word: room.currentWord, player: null, at: Date.now() }];
    room.phase = 'playing';
    startTurn(room, 1 - me);
    return;
  }

  if (data.type === 'submit_word') {
    if (room.phase !== 'playing' || room.pendingAppeal) return error(ws, 'לא ניתן לשלוח מילה עכשיו');
    if (room.activePlayer !== me) return error(ws, 'זה לא התור שלך');
    const word = String(data.word || '').trim().replace(/[\u0591-\u05C7]/g, '');
    if (!/^[א-ת]+$/.test(word)) return error(ws, 'יש להזין אותיות בעברית בלבד');
    if (!oneEditApart(room.currentWord, word)) return error(ws, 'יש להוסיף, להסיר או להחליף אות אחת בלבד');
    const used = new Set(room.history.map((entry) => normalize(entry.word)));
    if (used.has(normalize(word))) return error(ws, 'המילה כבר הופיעה במשחק');
    if (dictionary.has(normalize(word))) return submitAcceptedWord(room, me, word);
    clearTurnTimer(room);
    room.deadline = null;
    room.pendingAppeal = { word, by: me, judge: 1 - me };
    return broadcast(room);
  }

  if (data.type === 'appeal_decision') {
    const appeal = room.pendingAppeal;
    if (!appeal || appeal.judge !== me) return error(ws, 'אין ערעור להכריע בו');
    if (data.approved) return submitAcceptedWord(room, appeal.by, appeal.word);
    room.pendingAppeal = null;
    return startTurn(room, appeal.by);
  }

  if (data.type === 'use_joker') {
    if (room.phase !== 'playing' || room.activePlayer !== me || room.pendingAppeal) return error(ws, 'לא ניתן להשתמש בג׳וקר עכשיו');
    if (!player.joker) return error(ws, 'הג׳וקר כבר נוצל');
    const used = new Set(room.history.map((entry) => normalize(entry.word)));
    const options = neighbors(room.currentWord, used);
    if (!options.length) return error(ws, 'לא נמצאה מילה חוקית — הג׳וקר נשמר');
    const chosen = options[crypto.randomInt(options.length)];
    player.joker = 0;
    return submitAcceptedWord(room, me, chosen);
  }

  if (data.type === 'rematch') {
    if (room.phase !== 'finished') return;
    return resetRound(room);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => handleMessage(ws, message));
  ws.on('close', () => {
    if (!ws.room) return;
    const room = ws.room;
    const player = room.players[ws.playerIndex];
    if (player && player.id === ws.playerId) player.ws = null;
    broadcast(room);
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [roomCode, room] of rooms.entries()) {
    const connected = room.players.some((player) => player && player.ws && player.ws.readyState === WebSocket.OPEN);
    if (!connected && room.createdAt < cutoff) {
      clearTurnTimer(room);
      rooms.delete(roomCode);
    }
  }
}, 15 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Hebrew Word Duel listening on 0.0.0.0:${PORT}`);
  });
}

module.exports = { normalize, oneEditApart, neighbors };
