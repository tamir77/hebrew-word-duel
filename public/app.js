const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  homeName: $('#homeName'), createButton: $('#createButton'), joinButton: $('#joinButton'), joinArea: $('#joinArea'),
  inviteCode: $('#inviteCode'), rulesButton: $('#rulesButton'), rulesModal: $('#rulesModal'), lobby: $('#lobby'), roomCode: $('#roomCode'),
  shareButton: $('#shareButton'), players: $('#players'), timerOptions: $('#timerOptions'), readyButton: $('#readyButton'),
  waitingCallout: $('#waitingCallout'), soundToggle: $('#soundToggle'),
  connectionBadge: $('#connectionBadge'), reelBefore: $('#reelBefore'), reelWord: $('#reelWord'), reelAfter: $('#reelAfter'), rouletteStatus: $('#rouletteStatus'),
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
let audioContext;
let soundEnabled = localStorage.getItem('last-word:sound') !== 'off';
let activeRouletteKey = '';
let lastReelStep = -1;
let settledSoundKey = '';
let lastTurnSoundSecond = null;

function updateSoundToggle() {
  elements.soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
  elements.soundToggle.setAttribute('aria-label', soundEnabled ? 'כיבוי צלילים' : 'הפעלת צלילים');
  elements.soundToggle.title = soundEnabled ? 'כיבוי צלילים' : 'הפעלת צלילים';
  elements.soundToggle.classList.toggle('muted', !soundEnabled);
}

function ensureAudio() {
  if (!soundEnabled) return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function tone(frequency, duration = .05, volume = .025, type = 'sine', delay = 0) {
  const context = ensureAudio();
  if (!context) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + .02);
}

function playReelTick(step) {
  tone(720 + (step % 4) * 55, .032, .018, 'square');
}

function playRouletteSettle() {
  tone(523.25, .16, .035, 'triangle');
  tone(659.25, .18, .04, 'triangle', .12);
  tone(783.99, .28, .045, 'triangle', .25);
}

function playTurnTick(seconds) {
  if (seconds <= 5) tone(690 + (5 - seconds) * 35, .075, .028, 'sine');
  else tone(330, .045, .012, 'sine');
}

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
    if (!player) return `<div class="player-card waiting-player"><div class="avatar"><span>?</span></div><strong>המקום מחכה</strong><small>שחקן 2</small></div>`;
    const status = player.ready ? 'מוכן' : player.connected ? 'בחדר' : 'מנותק';
    return `<div class="player-card"><div class="avatar">${escapeHtml(player.name[0] || '?')}</div><strong>${escapeHtml(player.name)}${index === myIndex ? ' · אני' : ''}</strong><small>${status}</small></div>`;
  }).join('');
  $$('#timerOptions button').forEach((button) => {
    button.classList.toggle('selected', Number(button.dataset.time) === state.timerSeconds);
    button.disabled = myIndex !== 0;
  });
  const me = state.players[myIndex];
  const hasOpponent = Boolean(state.players[1]);
  elements.lobby.classList.toggle('waiting', !hasOpponent);
  elements.waitingCallout.classList.toggle('hidden', hasOpponent);
  elements.readyButton.disabled = !hasOpponent;
  elements.readyButton.textContent = !hasOpponent ? 'מחכים לשחקן נוסף...' : me?.ready ? 'ביטול מוכנות' : 'אני מוכן';
}

function renderRoulette(state) {
  showScreen('roulette');
  clearInterval(reelInterval);
  const roulette = state.roulette;
  const key = `${state.code}:${roulette.startedAt}`;
  if (activeRouletteKey !== key) {
    activeRouletteKey = key;
    lastReelStep = -1;
    settledSoundKey = '';
  }
  const wordCount = roulette.words.length;
  const baseSteps = 48;
  const totalSteps = baseSteps + ((roulette.selectedIndex - (baseSteps % wordCount) + wordCount) % wordCount);
  const showStep = (step) => {
    const index = ((step % wordCount) + wordCount) % wordCount;
    elements.reelBefore.textContent = roulette.words[(index - 1 + wordCount) % wordCount];
    elements.reelWord.textContent = roulette.words[index] || 'מילה';
    elements.reelAfter.textContent = roulette.words[(index + 1) % wordCount];
  };
  const draw = () => {
    const now = Date.now();
    const duration = roulette.settlesAt - roulette.startedAt;
    const progress = Math.max(0, Math.min(1, (now - roulette.startedAt) / duration));
    const eased = 1 - Math.pow(1 - progress, 2.35);
    const step = Math.min(totalSteps, Math.floor(eased * totalSteps));
    showStep(step);
    if (step !== lastReelStep && progress > 0 && progress < 1) playReelTick(step);
    lastReelStep = step;
    const settled = progress >= 1 || roulette.settled;
    elements.reelWord.classList.toggle('settled', settled);
    elements.rouletteStatus.textContent = settled ? 'המילה נבחרה — המשחק מתחיל!' : progress > 0 ? 'המכונה בוחרת...' : 'המכונה מתחממת...';
    if (settled && settledSoundKey !== key) {
      settledSoundKey = key;
      playRouletteSettle();
    }
    if (settled) clearInterval(reelInterval);
  };
  draw();
  reelInterval = setInterval(draw, 32);
}

function renderGame(state) {
  clearInterval(reelInterval);
  elements.reelWord.classList.remove('settled');
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
  startClock(state.deadline, state.timerSeconds, myTurn);
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

function startClock(deadline, total, soundForTurn = false) {
  lastTurnSoundSecond = null;
  const draw = () => {
    const left = Math.max(0, (deadline - Date.now()) / 1000);
    const seconds = Math.ceil(left);
    elements.turnTimer.textContent = seconds;
    elements.turnTimer.style.setProperty('--progress', `${Math.max(0, Math.min(100, left / total * 100))}%`);
    if (soundForTurn && seconds > 0 && seconds !== lastTurnSoundSecond) {
      playTurnTick(seconds);
      lastTurnSoundSecond = seconds;
    }
  };
  draw();
  clockInterval = setInterval(draw, 100);
}

function stopClock() { clearInterval(clockInterval); lastTurnSoundSecond = null; }
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
elements.soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('last-word:sound', soundEnabled ? 'on' : 'off');
  updateSoundToggle();
  if (soundEnabled) {
    ensureAudio();
    tone(523.25, .08, .025, 'triangle');
  }
});
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
updateSoundToggle();
document.addEventListener('pointerdown', () => ensureAudio(), { once: true });
if (invitedRoom && localStorage.getItem(playerKey(invitedRoom))) {
  connect({ type: 'join_room', roomCode: invitedRoom, playerId: localStorage.getItem(playerKey(invitedRoom)), name: getName() });
}
