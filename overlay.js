
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

  document.documentElement.style.setProperty(
    '--accent', theme
  );

  $('title').textContent =
    settings.title ?? '参加者待機リスト';

  $('message').textContent =
    settings.message ??
    '参加希望は「!参加」とコメント！';

  setStatus(
    settings.accepting ? '参加受付中' : '受付終了',
    !settings.accepting
  );
}

function platformLabel(platform) {
  switch (platform) {
    case 'youtube': return 'YouTube';
    case 'twitch': return 'Twitch';
    default: return '手動登録';
  }
}

function createPlayer(player, index, animate) {
  const row = document.createElement('div');
  row.className = 'player';

  if (index === 0) row.classList.add('next');
  if (!animate) row.style.animation = 'none';

  const number = document.createElement('span');
  number.className = 'number';
  number.textContent = String(index + 1).padStart(2, '0');

  const info = document.createElement('div');
  info.className = 'player-info';

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = String(player.name ?? '名前なし');

  const platform = document.createElement('span');
  platform.className = 'platform';
  platform.textContent = platformLabel(player.platform);

  info.append(name, platform);
  row.append(number, info);

  if (index === 0) {
    const next = document.createElement('span');
    next.className = 'next-label';
    next.textContent = 'NEXT';
    row.append(next);
  }

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

  $('count').textContent = participants.length;
  $('total').textContent =
    `${participants.length} PLAYERS`;

  $('nextPlayer').textContent =
    participants.length
      ? String(participants[0].name ?? '名前なし')
      : '待機なし';

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
    const data = snapshot.val();

    participants = Array.isArray(data)
      ? data.filter(Boolean)
      : [];

    renderQueue();
  },
  error => {
    console.error('Queue sync error:', error);
    setStatus('接続エラー', true);
  }
);
