const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  homeName: $('#homeName'), createButton: $('#createButton'), joinButton: $('#joinButton'), joinArea: $('#joinArea'),
  inviteCode: $('#inviteCode'), rulesButton: $('#rulesButton'), rulesModal: $('#rulesModal'), roomCode: $('#roomCode'),
  shareButton: $('#shareButton'), players: $('#players'), timerOptions: $('#timerOptions'), readyButton: $('#readyButton'),
  connectionBadge: $('#connectionBadge'), reelWord: $('#reelWord'), stopButton: $('#stopButton'), rouletteStatus: $('#rouletteStatus'),
  gamePlayers: $('#gamePlayers'), turnTimer: $('#turnTimer'), turnLabel: $('#turnLabel'), currentWord: $('#currentWord'),
  wordForm: $('#wordForm'), wordInput: $('#wordInput'), jokerButton: $('#jokerButton'), history: $('#history'), moveCount: $('#moveCount'),
  appealModal: $('#appealModal'), appealWord: $('#appealWord'), appealText: $('#appealText'), approveAppeal: $('#approveAppeal'),
  rejectAppeal: $('#rejectAppeal'), resultTitle: $('#resultTitle'), resultReason: $('#resultReason'), rematchButton: $('#rematchButton'),
  homeButton: $('#homeButton'), toast: $('#toast')
};

let socket;
let roomState;
let myIndex = null;
let myId = null;
let reelInterval;
let clockInterval;
let reconnectTimer;
let pendingAction = null;

const params = new URLSearchParams(location.search);
const invitedRoom = params.get('room')?.toUpperCase();
if (invitedRoom) {
  elements.joinArea.classList.remove('hidden');
  elements.inviteCode.textContent = invitedRoom;
  elements.createButton.classList.add('hidden');
}

function showScreen(id) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === id));
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
}

function playerKey(code) { return `last-word:${code}`; }
function getName() { return elements.homeName.value.trim() || localStorage.getItem('last-word:name') || ''; }
function setName() { if (getName()) localStorage.setItem('last-word:name', getName()); }

function connect(action) {
  pendingAction = action;
  clearTimeout(reconnectTimer);
  if (socket && socket.readyState <= 1) socket.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  elements.connectionBadge.textContent = 'מתחבר...';
  socket.addEventListener('open', () => {
    elements.connectionBadge.textContent = 'מחובר';
    if (pendingAction) send(pendingAction);
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'error') return toast(message.message);
    if (message.type === 'joined') {
      myIndex = message.playerIndex;
      myId = message.playerId;
      roomState = message.state;
      localStorage.setItem(playerKey(roomState.code), myId);
      history.replaceState({}, '', `?room=${roomState.code}`);
      pendingAction = { type: 'join_room', roomCode: roomState.code, playerId: myId, name: getName() };
      render(roomState);
      return;
    }
    if (message.state) {
      roomState = message.state;
      render(roomState);
    }
  });
  socket.addEventListener('close', () => {
    elements.connectionBadge.textContent = 'מנותק';
    if (roomState && roomState.phase !== 'finished') reconnectTimer = setTimeout(() => connect(pendingAction), 1400);
  });
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function render(state) {
  stopClock();
  if (state.phase === 'lobby') renderLobby(state);
  if (state.phase === 'roulette') renderRoulette(state);
  if (state.phase === 'playing') renderGame(state);
  if (state.phase === 'finished') renderFinished(state);
  renderAppeal(state);
}

function renderLobby(state) {
  clearInterval(reelInterval);
  showScreen('lobby');
  elements.roomCode.textContent = state.code;
  elements.players.innerHTML = state.players.map((player, index) => {
    if (!player) return `<div class="player-card"><div class="avatar">?</div><strong>מחכים...</strong><small>שחקן 2</small></div>`;
    const status = player.ready ? 'מוכן' : player.connected ? 'בחדר' : 'מנותק';
    return `<div class="player-card"><div class="avatar">${escapeHtml(player.name[0] || '?')}</div><strong>${escapeHtml(player.name)}${index === myIndex ? ' · אני' : ''}</strong><small>${status}</small></div>`;
  }).join('');
  $$('#timerOptions button').forEach((button) => {
    button.classList.toggle('selected', Number(button.dataset.time) === state.timerSeconds);
    button.disabled = myIndex !== 0;
  });
  const me = state.players[myIndex];
  const hasOpponent = Boolean(state.players[1]);
  elements.readyButton.disabled = !hasOpponent;
  elements.readyButton.textContent = !hasOpponent ? 'מחכים לשחקן נוסף...' : me?.ready ? 'ביטול מוכנות' : 'אני מוכן';
}

function renderRoulette(state) {
  showScreen('roulette');
  elements.stopButton.disabled = Date.now() < state.roulette.startedAt;
  elements.rouletteStatus.textContent = 'הראשון שלוחץ עוצר את המילה';
  clearInterval(reelInterval);
  const draw = () => {
    const elapsed = Math.max(0, Date.now() - state.roulette.startedAt);
    const index = Math.floor(elapsed / 110) % state.roulette.words.length;
    elements.reelWord.textContent = state.roulette.words[index] || 'מילה';
    elements.stopButton.disabled = elapsed <= 0;
  };
  draw();
  elements.reelWord.classList.add('spin');
  reelInterval = setInterval(draw, 60);
}

function renderGame(state) {
  clearInterval(reelInterval);
  elements.reelWord.classList.remove('spin');
  showScreen('game');
  elements.currentWord.textContent = state.currentWord;
  const myTurn = state.activePlayer === myIndex && !state.pendingAppeal;
  elements.turnLabel.textContent = myTurn ? 'התור שלך' : `התור של ${state.players[state.activePlayer]?.name || 'היריב'}`;
  elements.wordInput.disabled = !myTurn;
  $('.submit-word').disabled = !myTurn;
  elements.jokerButton.disabled = !myTurn || !state.players[myIndex]?.joker;
  if (myTurn) setTimeout(() => elements.wordInput.focus(), 150);
  elements.gamePlayers.innerHTML = state.players.map((player, index) => `<div class="mini-player ${state.activePlayer === index ? 'active' : ''}"><span class="mini-dot"></span>${escapeHtml(player?.name || '')}${player?.joker ? ' · 🃏' : ''}</div>`).join('');
  elements.history.innerHTML = [...state.history].reverse().map((entry) => `<span class="history-word ${entry.player === myIndex ? 'mine' : ''}">${escapeHtml(entry.word)}</span>`).join('');
  const moves = Math.max(0, state.history.length - 1);
  elements.moveCount.textContent = `${moves} מהלכים`;
  startClock(state.deadline, state.timerSeconds);
}

function renderAppeal(state) {
  const appeal = state.pendingAppeal;
  if (!appeal) return elements.appealModal.classList.add('hidden');
  elements.appealModal.classList.remove('hidden');
  elements.appealWord.textContent = appeal.word;
  const judging = appeal.judge === myIndex;
  elements.appealText.textContent = judging ? 'היריב טוען שזה שם עצם חוקי ביחיד. לאשר?' : 'מחכים להחלטת היריב...';
  elements.approveAppeal.classList.toggle('hidden', !judging);
  elements.rejectAppeal.classList.toggle('hidden', !judging);
}

function renderFinished(state) {
  showScreen('finished');
  const won = state.winner === myIndex;
  elements.resultTitle.textContent = won ? 'ניצחת!' : `${state.players[state.winner]?.name || 'היריב'} ניצח`;
  elements.resultReason.textContent = state.reason === 'time' ? 'הזמן נגמר לפני שנשלחה מילה חוקית.' : 'המשחק הסתיים.';
}

function startClock(deadline, total) {
  const draw = () => {
    const left = Math.max(0, (deadline - Date.now()) / 1000);
    const seconds = Math.ceil(left);
    elements.turnTimer.textContent = seconds;
    elements.turnTimer.style.setProperty('--progress', `${Math.max(0, Math.min(100, left / total * 100))}%`);
  };
  draw();
  clockInterval = setInterval(draw, 100);
}

function stopClock() { clearInterval(clockInterval); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

elements.createButton.addEventListener('click', () => {
  if (!getName()) return toast('יש להזין שם');
  setName();
  connect({ type: 'create_room', name: getName(), timerSeconds: 30 });
});
elements.joinButton.addEventListener('click', () => {
  if (!getName()) return toast('יש להזין שם');
  setName();
  connect({ type: 'join_room', roomCode: invitedRoom, playerId: localStorage.getItem(playerKey(invitedRoom)), name: getName() });
});
elements.rulesButton.addEventListener('click', () => elements.rulesModal.classList.remove('hidden'));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).classList.add('hidden')));
elements.shareButton.addEventListener('click', async () => {
  const url = `${location.origin}?room=${roomState.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'המילה האחרונה', text: 'בואו לשחק איתי!', url }); return; } catch {}
  }
  await navigator.clipboard.writeText(url);
  toast('הקישור הועתק');
});
elements.timerOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-time]');
  if (button) send({ type: 'set_timer', timerSeconds: Number(button.dataset.time) });
});
elements.readyButton.addEventListener('click', () => send({ type: 'ready', ready: !roomState.players[myIndex]?.ready }));
elements.stopButton.addEventListener('click', () => { elements.stopButton.disabled = true; send({ type: 'stop_roulette' }); });
elements.wordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const word = elements.wordInput.value.trim();
  if (!word) return;
  send({ type: 'submit_word', word });
  elements.wordInput.value = '';
});
elements.jokerButton.addEventListener('click', () => send({ type: 'use_joker' }));
elements.approveAppeal.addEventListener('click', () => send({ type: 'appeal_decision', approved: true }));
elements.rejectAppeal.addEventListener('click', () => send({ type: 'appeal_decision', approved: false }));
elements.rematchButton.addEventListener('click', () => send({ type: 'rematch' }));
elements.homeButton.addEventListener('click', () => { location.href = location.origin; });

elements.homeName.value = localStorage.getItem('last-word:name') || '';
if (invitedRoom && localStorage.getItem(playerKey(invitedRoom))) {
  connect({ type: 'join_room', roomCode: invitedRoom, playerId: localStorage.getItem(playerKey(invitedRoom)), name: getName() });
}
