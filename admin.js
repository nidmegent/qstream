
import { auth, db } from './firebase-config.js';

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

import {
  ref,
  onValue,
  runTransaction,
  update,
  get
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

import './youtube-monitor.js';

// 既存の管理者2人を維持
const ADMIN_UIDS = [
  'IBrHgaO4cxdTbMulaMpWyJuNRYI2',
  'JneD98SMF8Pb3gWvD8MYmsPprlD3'
];

const $ = id => document.getElementById(id);
const root = ref(db, 'streamQueue');
const participantsRef = ref(db, 'streamQueue/participants');

const defaults = {
  settings: {
    accepting: true,
    theme: '#8b5cf6',
    title: '参加者待機リスト',
    message: '参加希望は「!参加」とコメント！',
    youtubeUrl: '',
    twitchChannel: ''
  },
  participants: []
};

let state = structuredClone(defaults);
let unsubscribe = null;

function notify(message) {
  $('notice').textContent = message;
}

function getParticipants() {
  return Array.isArray(state.participants)
    ? state.participants.filter(Boolean)
    : [];
}

function isNow(player) {
  return player.status === 'now';
}

function createQueueRow(player, index, group, total) {
  const row = document.createElement('div');
  row.className = 'queue-row';

  const number = document.createElement('span');
  number.className = 'index';
  number.textContent = String(index + 1).padStart(2, '0');

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = String(player.name ?? '名前なし');

  const actions = document.createElement('div');
  actions.className = 'actions';

  function addButton(label, action, disabled = false, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    if (className) button.className = className;

    button.addEventListener('click', () => {
      changeQueue(action, player.id);
    });

    actions.append(button);
  }

  if (group === 'waiting') {
    addButton('NOWへ', 'toNow', false, 'now-button');
  } else {
    addButton('WAITINGへ', 'toWaiting', false, 'waiting-button');
  }

  addButton('↑', 'up', index === 0, 'secondary');
  addButton('↓', 'down', index === total - 1, 'secondary');
  addButton('削除', 'delete', false, 'danger');

  row.append(number, name, actions);
  return row;
}

function render() {
  const s = state.settings || defaults.settings;

  $('accepting').checked = !!s.accepting;
  $('statusLabel').textContent =
    s.accepting ? '受付中' : '受付終了';

  $('theme').value =
    /^#[0-9a-f]{6}$/i.test(s.theme)
      ? s.theme
      : '#8b5cf6';

  $('themeHex').value = $('theme').value;

  for (const key of ['title', 'message', 'youtubeUrl', 'twitchChannel']) {
    $(key).value = s[key] || '';
  }

  const list = getParticipants();
  const nowPlayers = list.filter(isNow);
  const waitingPlayers = list.filter(p => !isNow(p));

  $('count').textContent =
    `${waitingPlayers.length}人待機中 / ${nowPlayers.length}人プレイ中`;

  $('nowCount').textContent = `${nowPlayers.length}人`;
  $('waitingCount').textContent = `${waitingPlayers.length}人`;

  $('nowQueue').replaceChildren();
  $('queue').replaceChildren();

  nowPlayers.forEach((player, index) => {
    $('nowQueue').append(
      createQueueRow(player, index, 'now', nowPlayers.length)
    );
  });

  waitingPlayers.forEach((player, index) => {
    $('queue').append(
      createQueueRow(player, index, 'waiting', waitingPlayers.length)
    );
  });

  $('nowEmpty').hidden = nowPlayers.length > 0;
  $('waitingEmpty').hidden = waitingPlayers.length > 0;
  $('complete').disabled = waitingPlayers.length === 0;
}

async function changeQueue(action, id) {
  try {
    const result = await runTransaction(participantsRef, current => {
      const list = Array.isArray(current)
        ? current.filter(Boolean).map(p => ({ ...p }))
        : [];

      const index = list.findIndex(p => p.id === id);
      if (index < 0) return;

      const player = list[index];

      if (action === 'delete' || action === 'complete') {
        list.splice(index, 1);
        return list;
      }

      if (action === 'toNow') {
        player.status = 'now';
        return list;
      }

      if (action === 'toWaiting') {
        player.status = 'waiting';
        return list;
      }

      if (action === 'up' || action === 'down') {
        const now = isNow(player);

        const groupIndices = list
          .map((p, i) => ({ p, i }))
          .filter(item => isNow(item.p) === now)
          .map(item => item.i);

        const position = groupIndices.indexOf(index);
        const targetPosition =
          action === 'up' ? position - 1 : position + 1;

        if (
          targetPosition < 0 ||
          targetPosition >= groupIndices.length
        ) return;

        const targetIndex = groupIndices[targetPosition];

        [list[index], list[targetIndex]] =
          [list[targetIndex], list[index]];

        return list;
      }

      return;
    });

    if (!result.committed) {
      notify('更新されませんでした。');
    }
  } catch (error) {
    notify('参加者の更新に失敗: ' + error.message);
  }
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();

  try {
    notify('ログイン中…');

    await signInWithEmailAndPassword(
      auth,
      $('email').value,
      $('password').value
    );

    $('password').value = '';
    notify('ログインしました');
  } catch (error) {
    notify('ログイン失敗: ' + error.message);
  }
});

$('logout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async user => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const allowed = !!user && ADMIN_UIDS.includes(user.uid);

  $('loginPanel').hidden = allowed;
  $('adminPanel').hidden = !allowed;
  $('connection').textContent =
    allowed ? 'Firebase接続中' : '未接続';

  if (user && !allowed) {
    notify('このアカウントには管理者権限がありません。');
    await signOut(auth);
    return;
  }

  if (!allowed) return;

  try {
    const snapshot = await get(root);

    if (!snapshot.exists()) {
      await update(root, defaults);
    }

    unsubscribe = onValue(
      root,
      snapshot => {
        const data = snapshot.val() || {};

        state = {
          settings: {
            ...defaults.settings,
            ...(data.settings || {})
          },
          participants: Array.isArray(data.participants)
            ? data.participants
            : []
        };

        render();
        $('connection').textContent = '同期中';
      },
      error => notify('同期エラー: ' + error.message)
    );
  } catch (error) {
    notify('データベースへの接続に失敗: ' + error.message);
  }
});

$('addForm').addEventListener('submit', async event => {
  event.preventDefault();

  const name = $('participantName').value.trim();
  if (!name) return;

  const id = crypto.randomUUID();

  try {
    const result = await runTransaction(participantsRef, current => {
      const list = Array.isArray(current)
        ? current.filter(Boolean)
        : [];

      if (list.some(p =>
        String(p.name ?? '').toLocaleLowerCase() ===
        name.toLocaleLowerCase()
      )) return;

      list.push({
        id,
        name,
        platform: 'manual',
        status: 'waiting',
        createdAt: Date.now()
      });

      return list;
    });

    if (result.committed) {
      $('participantName').value = '';
    } else {
      notify('同じ名前がすでに登録されています。');
    }
  } catch (error) {
    notify('追加失敗: ' + error.message);
  }
});

$('complete').addEventListener('click', () => {
  const first = getParticipants().find(p => !isNow(p));

  if (first) {
    changeQueue('complete', first.id);
  }
});

$('accepting').addEventListener('change', async event => {
  try {
    await update(ref(db, 'streamQueue/settings'), {
      accepting: event.target.checked
    });
  } catch (error) {
    notify('受付状態の変更に失敗: ' + error.message);
    render();
  }
});

$('theme').addEventListener('input', event => {
  $('themeHex').value = event.target.value;
});

$('themeHex').addEventListener('input', event => {
  if (/^#[0-9a-f]{6}$/i.test(event.target.value)) {
    $('theme').value = event.target.value;
  }
});

$('saveSettings').addEventListener('click', async () => {
  const theme = $('themeHex').value;

  if (!/^#[0-9a-f]{6}$/i.test(theme)) {
    notify('カラーは #RRGGBB 形式で入力してください。');
    return;
  }

  const youtubeUrl = $('youtubeUrl').value.trim();

  if (youtubeUrl) {
    try {
      const url = new URL(youtubeUrl);

      if (
        url.protocol !== 'https:' ||
        ![
          'youtube.com',
          'www.youtube.com',
          'youtu.be',
          'm.youtube.com'
        ].includes(url.hostname)
      ) throw Error();
    } catch {
      notify('有効なYouTubeのHTTPS URLを入力してください。');
      return;
    }
  }

  const twitchChannel = $('twitchChannel').value.trim();

  if (
    twitchChannel &&
    !/^[a-zA-Z0-9_]{3,25}$/.test(twitchChannel)
  ) {
    notify('Twitchチャンネル名を確認してください。');
    return;
  }

  try {
    await update(ref(db, 'streamQueue/settings'), {
      theme,
      title: $('title').value.trim(),
      message: $('message').value.trim(),
      youtubeUrl,
      twitchChannel
    });

    notify('設定を保存しました。');
  } catch (error) {
    notify('保存失敗: ' + error.message);
  }
});
