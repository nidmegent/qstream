
import { db } from './firebase-config.js';

import {
  ref,
  onValue
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

const $ = id => document.getElementById(id);

const settingsRef = ref(db, 'streamQueue/settings');
const participantsRef = ref(db, 'streamQueue/participants');

let participants = [];
let previousIds = new Set();
let firstLoad = true;

function setStatus(text, closed = false) {
  $('status').textContent = text;
  $('status').classList.toggle('closed', closed);
}

function applySettings(settings = {}) {
  const theme = /^#[0-9a-fA-F]{6}$/.test(settings.theme)
    ? settings.theme
    : '#8b5cf6';

  document.documentElement.style.setProperty('--accent', theme);

  $('title').textContent =
    settings.title ?? '参加者待機リスト';

  $('message').textContent =
    settings.message ?? '参加希望は「!参加」とコメント！';

  setStatus(
    settings.accepting ? '参加受付中' : '受付終了',
    !settings.accepting
  );
}

function normalizeParticipants(data) {
  if (Array.isArray(data)) {
    return data.filter(p => p && typeof p === 'object');
  }

  return [];
}

function renderNextPlayers() {
  const container = $('nextPlayer');
  container.replaceChildren();

  if (!participants.length) {
    container.textContent = '待機なし';
    return;
  }

  const fragment = document.createDocumentFragment();

  // 全員表示・人数上限なし
  participants.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'next-player-item';

    if (index === 0) row.classList.add('first');

    const number = document.createElement('span');
    number.className = 'next-player-number';
    number.textContent = String(index + 1).padStart(2, '0');

    const name = document.createElement('span');
    name.className = 'next-player-name';
    name.textContent = String(player.name ?? '名前なし');

    row.append(number, name);
    fragment.append(row);
  });

  container.append(fragment);
}

function createPlayer(player, index, animate) {
  const row = document.createElement('div');
  row.className = 'player';

  if (index === 0) row.classList.add('next');
  if (!animate) row.style.animation = 'none';

  const number = document.createElement('span');
  number.className = 'number';
  number.textContent = String(index + 1).padStart(2, '0');

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = String(player.name ?? '名前なし');

  row.append(number, name);
  return row;
}

function renderQueue() {
  const queue = $('queue');

  const nextIds = new Set(
    participants.map(p => String(p.id))
  );

  const rows = participants.map((player, index) => {
    const isNew = !firstLoad &&
      !previousIds.has(String(player.id));

    return createPlayer(player, index, isNew);
  });

  queue.replaceChildren(...rows);

  $('total').textContent = `${participants.length} PLAYERS`;
  renderNextPlayers();

  $('empty').hidden = participants.length > 0;

  previousIds = nextIds;
  firstLoad = false;
}

onValue(
  settingsRef,
  snapshot => {
    applySettings(snapshot.val() || {});
  },
  error => {
    console.error('Settings sync error:', error);
    setStatus('接続エラー', true);
  }
);

onValue(
  participantsRef,
  snapshot => {
    participants = normalizeParticipants(snapshot.val());
    renderQueue();
  },
  error => {
    console.error('Queue sync error:', error);
    setStatus('接続エラー', true);
  }
);
