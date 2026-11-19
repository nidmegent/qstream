
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

function isNow(player) {
  return player.status === 'now';
}

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

function renderNowPlayers(nowPlayers) {
  const container = $('nextPlayer');
  container.replaceChildren();

  if (!nowPlayers.length) {
    container.textContent = 'プレイ中なし';
    return;
  }

  const fragment = document.createDocumentFragment();

  nowPlayers.forEach((player, index) => {
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

function renderQueue() {
  const nowPlayers = participants.filter(isNow);
  const waitingPlayers = participants.filter(p => !isNow(p));

  const nextIds = new Set(
    waitingPlayers.map(p => String(p.id))
  );

  const rows = waitingPlayers.map((player, index) => {
    const isNew =
      !firstLoad &&
      !previousIds.has(String(player.id));

    return createPlayer(player, index, isNew);
  });

  $('queue').replaceChildren(...rows);

  $('total').textContent =
    `${waitingPlayers.length} PLAYERS`;

  renderNowPlayers(nowPlayers);

  $('empty').hidden = waitingPlayers.length > 0;

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
    const data = snapshot.val();

    participants = Array.isArray(data)
      ? data.filter(p => p && typeof p === 'object')
      : [];

    renderQueue();
  },
  error => {
    console.error('Queue sync error:', error);
    setStatus('接続エラー', true);
  }
);
