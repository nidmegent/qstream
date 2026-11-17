
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { ref, get, runTransaction } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

const COMMANDS = new Set(['!参加', '!辞退', '!順番', '!人数']);
const settingsRef = ref(db, 'streamQueue/settings');
const queueRef = ref(db, 'streamQueue/participants');

let running = false;
let generation = 0;
let timer = null;
let pageToken = null;
let currentChatId = null;
let firstPage = true;
let lastMessageTime = null;
let pollInterval = 10000;
let apiKey = '';

const sleep = ms => new Promise(resolve => {
  timer = setTimeout(resolve, ms);
});

function log(message) {
  const output = document.getElementById('ytMonitorLog');
  if (!output) return;
  const time = new Date().toLocaleTimeString('ja-JP');
  output.textContent = `[${time}] ${message}\n` + output.textContent;
  output.textContent = output.textContent.slice(0, 8000);
}

function setStatus(message) {
  const el = document.getElementById('ytMonitorStatus');
  if (el) el.textContent = message;
}

function updateButtons() {
  const start = document.getElementById('ytMonitorStart');
  const stop = document.getElementById('ytMonitorStop');
  if (start) start.disabled = running;
  if (stop) stop.disabled = !running;
}

function extractVideoId(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();

  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') return url.searchParams.get('v');
    if (url.pathname.startsWith('/live/')) return url.pathname.split('/')[2];
  }
  if (host === 'youtu.be') return url.pathname.split('/')[1];

  throw new Error('YouTubeの動画URLを入力してください');
}

async function youtubeRequest(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.set('key', apiKey);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    const reason = data.error?.message || `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return data;
}

async function getChatId(videoId) {
  const data = await youtubeRequest('videos', {
    part: 'liveStreamingDetails',
    id: videoId
  });

  const chatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!chatId) throw new Error('ライブチャットが見つかりません。配信中か確認してください');
  return chatId;
}

function normalizeQueue(current) {
  if (Array.isArray(current)) return current.filter(p => p && typeof p === 'object');

  if (current && typeof current === 'object') {
    return Object.keys(current)
      .sort((a, b) => Number(a) - Number(b))
      .map(key => current[key])
      .filter(p => p && typeof p === 'object');
  }
  return [];
}

async function processCommand(command, channelId, name) {
  const userId = `youtube:${channelId}`;

  if (command === '!順番' || command === '!人数') {
    const queue = normalizeQueue((await get(queueRef)).val());
    const index = queue.findIndex(p => p.id === userId);

    log(command === '!人数'
      ? `待機人数：${queue.length}人`
      : `${name}：${index < 0 ? '未登録' : `${index + 1}番目`}`);
    return;
  }

  if (command === '!参加') {
    const settings = (await get(settingsRef)).val() || {};
    if (!settings.accepting) {
      log(`${name}：受付終了中`);
      return;
    }
  }

  const result = await runTransaction(queueRef, current => {
    const queue = normalizeQueue(current);
    const index = queue.findIndex(p => p.id === userId);

    if (command === '!参加') {
      if (index >= 0) return;

      // 既存管理画面の同名登録ルールに合わせる
      if (queue.some(p =>
        String(p.name || '').toLocaleLowerCase() === name.toLocaleLowerCase()
      )) return;

      queue.push({
        id: userId,
        name,
        platform: 'youtube',
        createdAt: Date.now()
      });
      return queue;
    }

    if (command === '!辞退') {
      if (index < 0) return;
      queue.splice(index, 1);
      return queue;
    }
  }, { applyLocally: false });

  log(result.committed
    ? `${command === '!参加' ? '参加登録' : '参加辞退'}：${name}`
    : `${name}：変更なし（登録済み・未登録・同名など）`);
}

async function startMonitor() {
  if (running) return;

  apiKey = document.getElementById('ytMonitorKey').value.trim();
  if (!apiKey) {
    log('YouTube APIキーを入力してください');
    return;
  }

  const settings = (await get(settingsRef)).val() || {};
  const liveUrl = settings.youtubeUrl;

  if (!liveUrl) {
    log('先に管理画面でYouTubeライブURLを保存してください');
    return;
  }

  let videoId;
  try {
    videoId = extractVideoId(liveUrl);
    if (!videoId) throw new Error('動画IDを取得できません');
  } catch (error) {
    log(error.message);
    return;
  }

  running = true;
  const myGeneration = ++generation;
  pageToken = null;
  firstPage = true;
  lastMessageTime = null;
  updateButtons();
  setStatus('接続中...');
  log('YouTubeへの接続を開始します');

  try {
    currentChatId = await getChatId(videoId);
    if (!running || myGeneration !== generation) return;

    setStatus('監視中');
    log('ライブチャットに接続しました');

    while (running && myGeneration === generation) {
      const params = {
        liveChatId: currentChatId,
        part: 'snippet,authorDetails',
        maxResults: 200
      };
      if (pageToken) params.pageToken = pageToken;

      const data = await youtubeRequest('liveChat/messages', params);
      if (!running || myGeneration !== generation) break;

      const items = data.items || [];

      // 起動直後に取得した過去コメントは処理しない
      if (!firstPage) {
        for (const item of items) {
          if (!running || myGeneration !== generation) break;
          if (item.snippet?.type !== 'textMessageEvent') continue;

          const publishedAt = Date.parse(item.snippet.publishedAt || '');
          if (Number.isFinite(publishedAt) && lastMessageTime !== null &&
              publishedAt < lastMessageTime) continue;

          const command = item.snippet.displayMessage?.trim();
          if (!COMMANDS.has(command)) continue;

          const channelId = item.authorDetails?.channelId;
          const name = item.authorDetails?.displayName || 'Unknown';
          if (!channelId) continue;

          try {
            await processCommand(command, channelId, name);
          } catch (error) {
            log(`コマンド処理エラー：${error.message}`);
          }
        }
      }

      firstPage = false;
      pageToken = data.nextPageToken || null;

      const validTimes = items
        .map(item => Date.parse(item.snippet?.publishedAt || ''))
        .filter(Number.isFinite);

      if (validTimes.length) {
        lastMessageTime = Math.max(lastMessageTime || 0, ...validTimes);
      }

      pollInterval = Math.max(5000, data.pollingIntervalMillis || 10000);
      await sleep(pollInterval);
    }
  } catch (error) {
    log(`監視エラー：${error.message}`);
    setStatus('エラーで停止');
  } finally {
    if (myGeneration === generation) {
      running = false;
      updateButtons();
      if (document.getElementById('ytMonitorStatus')?.textContent === '監視中') {
        setStatus('停止中');
      }
    }
  }
}

function stopMonitor() {
  running = false;
  generation++;
  if (timer) clearTimeout(timer);
  timer = null;
  updateButtons();
  setStatus('停止中');
  log('監視を停止しました');
}

function createPanel() {
  if (document.getElementById('ytMonitorPanel')) return;

  const adminPanel = document.getElementById('adminPanel');
  if (!adminPanel) {
    console.error('adminPanelが見つかりません');
    return;
  }

  const panel = document.createElement('section');
  panel.id = 'ytMonitorPanel';
  panel.style.cssText = `
    margin:24px 0;padding:20px;border-radius:14px;
    background:#171923;color:#fff;
    border:1px solid #3b3f51;
  `;

  panel.innerHTML = `
    <h2 style="margin-top:0">▶ YouTubeコメント監視</h2>
    <p style="opacity:.75;font-size:14px">
      管理画面に保存したYouTubeライブURLを監視します。
      監視中はこのタブを開いたままにしてください。
    </p>
    <label for="ytMonitorKey">YouTube Data APIキー</label>
    <input id="ytMonitorKey" type="password"
      placeholder="APIキーを入力"
      autocomplete="off"
      style="display:block;width:100%;box-sizing:border-box;
      padding:12px;margin:10px 0 16px;
      background:#0f1119;color:white;border:1px solid #555;
      border-radius:8px">
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button type="button" id="ytMonitorStart">監視開始</button>
      <button type="button" id="ytMonitorStop" disabled>監視停止</button>
    </div>
    <p>状態：<strong id="ytMonitorStatus">停止中</strong></p>
    <pre id="ytMonitorLog" style="
      white-space:pre-wrap;overflow-wrap:anywhere;
      background:#0b0d14;color:#b9fbc0;
      padding:14px;border-radius:8px;
      max-height:250px;overflow:auto;font-size:12px"></pre>
  `;

  adminPanel.appendChild(panel);
  document.getElementById('ytMonitorStart').addEventListener('click', startMonitor);
  document.getElementById('ytMonitorStop').addEventListener('click', stopMonitor);
}

onAuthStateChanged(auth, user => {
  if (user) {
    // 管理者チェックは既存admin.jsとFirebase Rulesが担当
    createPanel();
  } else {
    stopMonitor();
    document.getElementById('ytMonitorPanel')?.remove();
  }
});
