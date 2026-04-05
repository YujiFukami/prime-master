/**
 * 素数マスター — app.js
 * フェーズ2〜4: コアロジック・画面管理・ランキング（サーバーAPI版）
 */

'use strict';

// ===================================================
// 定数
// ===================================================
const GAME_DURATION = 60;
const COUNTDOWN_SEC = 3;
const RANKING_MAX   = 10;
// APIのベースURL（本番はサーバー自身、開発時はlocalhost:3000）
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : '';  // 本番では同一オリジン

const DIFFICULTY_CONFIG = {
  2: { label: '2桁', min: 10,   max: 99,   badge: 'EASY'   },
  3: { label: '3桁', min: 100,  max: 999,  badge: 'NORMAL' },
  4: { label: '4桁', min: 1000, max: 9999, badge: 'HARD'   },
};

// ===================================================
// 素数ロジック
// ===================================================
function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i <= Math.sqrt(n); i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

// 難易度に応じた範囲の素数・非素数リストを事前生成
function buildNumberPool(diff) {
  const { min, max } = DIFFICULTY_CONFIG[diff];
  const primes     = [];
  const nonPrimes  = [];
  for (let n = min; n <= max; n++) {
    (isPrime(n) ? primes : nonPrimes).push(n);
  }
  return { primes, nonPrimes };
}

// ===================================================
// Fisher-Yates シャッフル（偏りなし）
// ===================================================
function fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 配列 arr から n 個をランダムに繰り返し取得（足りなければ循環）
function pickN(arr, n) {
  const result = [];
  let pool = fisherYates(arr);
  while (result.length < n) {
    if (pool.length === 0) pool = fisherYates(arr);
    result.push(pool.pop());
  }
  return result;
}

// 50:50 になるよう素数・非素数を 1つずつ交互に並べ、
// その後 Fisher-Yates でシャッフルしつつ「同種が3連続しない」ように整列
function buildQueue(pool, size = 200) {
  const { primes, nonPrimes } = pool;
  const half = Math.floor(size / 2);

  // 均等に取得
  const pList  = pickN(primes,    half);
  const npList = pickN(nonPrimes, size - half);

  // 交互にインターリーブ（P, NP, P, NP …）してからシャッフル
  const interleaved = [];
  for (let i = 0; i < size; i++) {
    interleaved.push(i % 2 === 0 ? pList[Math.floor(i/2)] : npList[Math.floor(i/2)]);
  }
  const shuffled = fisherYates(interleaved);

  // 連続同種3回以上を防ぐ後処理
  const MAX_STREAK = 2;
  const q = [...shuffled];
  for (let i = MAX_STREAK; i < q.length; i++) {
    const curType = isPrime(q[i]);
    let streak = 1;
    for (let k = i - 1; k >= Math.max(0, i - MAX_STREAK); k--) {
      if (isPrime(q[k]) === curType) streak++;
      else break;
    }
    if (streak > MAX_STREAK) {
      // 反対種の要素をこれ以降から探してスワップ
      let swapped = false;
      for (let j = i + 1; j < q.length; j++) {
        if (isPrime(q[j]) !== curType) {
          [q[i], q[j]] = [q[j], q[i]];
          swapped = true;
          break;
        }
      }
      // スワップできなかった場合は後ろに回す
      if (!swapped && i + 1 < q.length) {
        q.push(q.splice(i, 1)[0]);
        i--; // 再チェック
      }
    }
  }
  return q;
}

// ===================================================
// サウンドエンジン (Web Audio API)
// ===================================================
const SFX = (() => {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 基本的なビープ生成
  function beep({ freq = 440, type = 'sine', gain = 0.4, duration = 0.12,
                  attack = 0.005, decay = 0.08, freqEnd = null } = {}) {
    if (muted) return;
    const ac  = getCtx();
    const osc = ac.createOscillator();
    const gn  = ac.createGain();
    osc.connect(gn);
    gn.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freqEnd) osc.frequency.linearRampToValueAtTime(freqEnd, ac.currentTime + duration);
    gn.gain.setValueAtTime(0, ac.currentTime);
    gn.gain.linearRampToValueAtTime(gain, ac.currentTime + attack);
    gn.gain.linearRampToValueAtTime(0, ac.currentTime + duration - decay);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  }

  // 和音を同時再生
  function chord(freqs, opts = {}) {
    freqs.forEach(f => beep({ ...opts, freq: f }));
  }

  return {
    toggleMute() { muted = !muted; return muted; },
    isMuted()    { return muted; },

    // カウントダウンビープ（3, 2, 1）
    countdown() {
      beep({ freq: 660, type: 'sine', gain: 0.35, duration: 0.15 });
    },
    // GO!
    go() {
      chord([523, 659, 784], { type: 'sine', gain: 0.25, duration: 0.25, attack: 0.01 });
    },
    // 正解
    correct() {
      beep({ freq: 523, type: 'sine', gain: 0.3, duration: 0.1, attack: 0.005 });
      setTimeout(() => beep({ freq: 659, type: 'sine', gain: 0.3, duration: 0.1 }), 80);
      setTimeout(() => beep({ freq: 784, type: 'sine', gain: 0.35, duration: 0.18 }), 160);
    },
    // 不正解
    wrong() {
      beep({ freq: 200, type: 'sawtooth', gain: 0.25, duration: 0.22,
             freqEnd: 120, attack: 0.01, decay: 0.18 });
    },
    // タイムアップ
    timeup() {
      beep({ freq: 440, type: 'sine', gain: 0.3, duration: 0.15 });
      setTimeout(() => beep({ freq: 330, type: 'sine', gain: 0.3, duration: 0.15 }), 180);
      setTimeout(() => beep({ freq: 220, type: 'sine', gain: 0.35, duration: 0.35 }), 360);
    },
    // 残り10秒ビープ（毎秒）
    tick() {
      beep({ freq: 880, type: 'sine', gain: 0.2, duration: 0.08, attack: 0.002 });
    },
    // ボタンUI操作音
    click() {
      beep({ freq: 400, type: 'sine', gain: 0.12, duration: 0.06, attack: 0.002 });
    },
    // ランキング登録成功
    register() {
      chord([523, 659, 784, 1047], { type: 'sine', gain: 0.2, duration: 0.3, attack: 0.01 });
    },
  };
})();

// ===================================================
// ゲーム状態
// ===================================================
const state = {
  screen:       'home',   // home | countdown | game | result | ranking
  difficulty:   null,     // 2 | 3 | 4
  score:        0,
  wrong:        0,
  timeLeft:     GAME_DURATION,
  timerInterval: null,
  queue:        [],
  queueIndex:   0,
  currentNum:   null,
  lastNum:      null,
  pool:         null,
  isAnswering:  false,    // 連打防止
  myScoreIndex: -1,       // 結果画面→ランキング時のハイライト
  penaltyScore: 0,        // ランキング登録スコア（正解数−不正解数）
  rankPeriod:   'week',   // today | week | month
};

// ===================================================
// 画面切り替え
// ===================================================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
  state.screen = name;
}

// ===================================================
// 星背景
// ===================================================
function initStars() {
  const container = document.getElementById('stars-container');
  const count = 120;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2.5 + 0.5;
    star.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%; top:${Math.random()*100}%;
      --dur:${(Math.random()*4+2).toFixed(1)}s;
      --max-op:${(Math.random()*0.7+0.2).toFixed(2)};
      animation-delay:${(Math.random()*5).toFixed(1)}s;
    `;
    container.appendChild(star);
  }
}

// ===================================================
// ミュートボタン（全画面共通）を動的追加
// ===================================================
function initMuteButton() {
  const btn = document.createElement('button');
  btn.id = 'btn-mute';
  btn.setAttribute('aria-label', 'ミュート切り替え');
  btn.textContent = '🔊';
  btn.style.cssText = `
    position:fixed; top:14px; right:16px; z-index:999;
    background:rgba(255,255,255,0.08); border:1.5px solid rgba(255,255,255,0.18);
    border-radius:50%; width:40px; height:40px; font-size:18px;
    cursor:pointer; color:#e0e8ff; transition:all 0.2s ease;
    display:flex; align-items:center; justify-content:center;
  `;
  btn.addEventListener('click', () => {
    const muted = SFX.toggleMute();
    btn.textContent = muted ? '🔇' : '🔊';
    if (!muted) SFX.click();
  });
  document.body.appendChild(btn);
}

// ===================================================
// トップ画面
// ===================================================
function initHome() {
  const cards   = document.querySelectorAll('.diff-card');
  const btnStart = document.getElementById('btn-start');

  cards.forEach(card => {
    card.addEventListener('click', () => {
      cards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.difficulty = parseInt(card.dataset.diff, 10);
      btnStart.disabled = false;
      SFX.click();
    });
  });

  btnStart.addEventListener('click', () => {
    if (!state.difficulty) return;
    SFX.click();
    startCountdown();
  });

  document.getElementById('btn-ranking-home').addEventListener('click', async () => {
    SFX.click();
    showScreen('ranking');
    await renderRankingScreen(state.difficulty || 2, state.rankPeriod);
  });

  document.getElementById('btn-primelist-home').addEventListener('click', () => {
    SFX.click();
    // 全桁数件数を一括初期化
    [2, 3, 4].forEach(d => {
      const { min, max } = DIFFICULTY_CONFIG[d];
      let cnt = 0;
      for (let n = min; n <= max; n++) if (isPrime(n)) cnt++;
      const el = document.getElementById(`pcount-${d}`);
      if (el) el.textContent = `(${cnt})`;
    });
    renderPrimeList(2);
    showScreen('primelist');
  });
}

// ===================================================
// カウントダウン
// ===================================================
function startCountdown() {
  showScreen('countdown');
  const numEl  = document.getElementById('countdown-number');
  const diffEl = document.getElementById('countdown-diff-display');
  const diff   = state.difficulty;
  diffEl.textContent = `難易度：${DIFFICULTY_CONFIG[diff].label} (${DIFFICULTY_CONFIG[diff].badge})`;

  let count = COUNTDOWN_SEC;
  numEl.textContent = count;
  numEl.style.animation = 'none';
  void numEl.offsetWidth;
  numEl.style.animation = '';

  SFX.countdown(); // 最初の「3」

  const interval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(interval);
      SFX.go();
      numEl.textContent = 'GO!';
      numEl.style.animation = 'none';
      void numEl.offsetWidth;
      numEl.style.animation = 'countPulse 0.7s ease-out';
      setTimeout(() => startGame(), 700);
    } else {
      SFX.countdown();
      numEl.textContent = count;
      numEl.style.animation = 'none';
      void numEl.offsetWidth;
      numEl.style.animation = 'countPulse 0.9s ease-in-out';
    }
  }, 1000);
}

// ===================================================
// ゲーム開始
// ===================================================
function startGame() {
  // 状態リセット
  state.score        = 0;
  state.wrong        = 0;
  state.timeLeft     = GAME_DURATION;
  state.isAnswering  = false;
  state.pool         = buildNumberPool(state.difficulty);
  state.queue        = buildQueue(state.pool, 300);
  state.queueIndex   = 0;
  state.currentNum   = null;
  state.lastNum      = null;

  // HUD初期化
  document.getElementById('hud-correct').textContent = 0;
  document.getElementById('hud-wrong').textContent   = 0;
  document.getElementById('hud-time').textContent    = GAME_DURATION;
  document.getElementById('hud-time').classList.remove('danger');
  document.getElementById('timer-bar').style.width   = '100%';
  document.getElementById('timer-bar').classList.remove('danger');
  document.getElementById('game-diff-badge').textContent =
    `難易度：${DIFFICULTY_CONFIG[state.difficulty].label}`;

  showScreen('game');
  nextQuestion();
  startTimer();
}

// ===================================================
// タイマー
// ===================================================
function startTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  const bar     = document.getElementById('timer-bar');
  const timeEl  = document.getElementById('hud-time');

  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    timeEl.textContent = state.timeLeft;
    bar.style.width    = `${(state.timeLeft / GAME_DURATION) * 100}%`;

    if (state.timeLeft <= 10 && state.timeLeft > 0) {
      timeEl.classList.add('danger');
      bar.classList.add('danger');
      SFX.tick(); // 残り10秒ビープ
    }
    if (state.timeLeft <= 0) {
      clearInterval(state.timerInterval);
      SFX.timeup();
      endGame();
    }
  }, 1000);
}

// ===================================================
// 出題
// ===================================================
function nextQuestion() {
  // キューが尽きたら補充
  if (state.queueIndex >= state.queue.length - 10) {
    const extra = buildQueue(state.pool, 200);
    state.queue = [...state.queue.slice(state.queueIndex), ...extra];
    state.queueIndex = 0;
  }

  let num = state.queue[state.queueIndex++];
  // 連続同一数字を回避
  if (num === state.lastNum) {
    num = state.queue[state.queueIndex++] ?? num;
  }
  state.currentNum = num;
  state.lastNum    = num;

  const el = document.getElementById('question-number');
  el.textContent = num;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ===================================================
// 回答処理
// ===================================================
function handleAnswer(userSaysPrime) {
  if (state.isAnswering || state.timeLeft <= 0) return;
  state.isAnswering = true;

  const correct = isPrime(state.currentNum);
  const isRight = (userSaysPrime === correct);

  const area    = document.getElementById('question-area');
  const overlay = document.getElementById('feedback-overlay');

  if (isRight) {
    state.score++;
    document.getElementById('hud-correct').textContent = state.score;
    area.classList.add('correct-flash');
    overlay.className  = 'feedback-overlay show-correct';
    overlay.textContent = '✓';
    spawnParticles(true);
    SFX.correct();
  } else {
    state.wrong++;
    document.getElementById('hud-wrong').textContent = state.wrong;
    area.classList.add('wrong-shake');
    overlay.className  = 'feedback-overlay show-wrong';
    overlay.textContent = '✕';
    SFX.wrong();
  }

  setTimeout(() => {
    area.classList.remove('correct-flash', 'wrong-shake');
    overlay.className  = 'feedback-overlay';
    overlay.textContent = '';
    state.isAnswering   = false;
    if (state.timeLeft > 0) nextQuestion();
  }, 350);
}

// ===================================================
// パーティクル（正解時）
// ===================================================
function spawnParticles(isCorrect) {
  const container = document.getElementById('particles-container');
  const colors = isCorrect
    ? ['#00e676','#69ff47','#00e5ff','#80ff72']
    : ['#ff1744','#ff6d00'];

  const area = document.getElementById('question-area');
  const rect = area.getBoundingClientRect();
  const cx   = rect.left + rect.width / 2;
  const cy   = rect.top  + rect.height / 2;

  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size  = Math.random() * 8 + 4;
    const angle = Math.random() * 360;
    const dist  = Math.random() * 60 + 20;
    const tx    = Math.cos(angle * Math.PI / 180) * dist;
    const ty    = Math.sin(angle * Math.PI / 180) * dist - 60;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${cx - size/2}px; top:${cy - size/2}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      animation: floatUp 0.9s ease-out forwards;
      transform: translate(${tx}px, ${ty}px);
    `;
    container.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}

// ===================================================
// ゲーム終了
// ===================================================
function endGame() {
  state.isAnswering = false;

  // ペナルティスコア計算（正解数−不正解数）
  const penaltyScore  = state.score - state.wrong;
  state.penaltyScore  = penaltyScore;

  // 結果画面更新
  const total = state.score + state.wrong;
  const rate  = total > 0 ? Math.round(state.score / total * 100) : 0;
  document.getElementById('result-correct').textContent = state.score;
  document.getElementById('result-wrong').textContent   = state.wrong;
  document.getElementById('result-rate').textContent    = `${rate}%`;
  document.getElementById('result-diff-label').textContent =
    `${DIFFICULTY_CONFIG[state.difficulty].label}（${DIFFICULTY_CONFIG[state.difficulty].badge}）`;

  // ペナルティスコア表示
  const psEl = document.getElementById('result-penalty-score');
  psEl.textContent = penaltyScore;
  psEl.style.color = penaltyScore > 0 ? 'var(--accent-cyan)' : 'var(--wrong-red)';

  // 登録可否制御（スコア1以上が必須）
  const alertEl    = document.getElementById('score-alert');
  const regSection = document.querySelector('.ranking-register');
  if (penaltyScore <= 0) {
    alertEl.style.display       = 'block';
    regSection.style.opacity       = '0.4';
    regSection.style.pointerEvents = 'none';
  } else {
    alertEl.style.display       = 'none';
    regSection.style.opacity       = '1';
    regSection.style.pointerEvents = '';
  }

  document.getElementById('input-name').value = '';
  state.myScoreIndex = -1;

  showScreen('result');
}

// ===================================================
// ランキング — APIクライアント
// ===================================================

/**
 * サーバーからランキングを取得
 * @param {number} diff - 難易度 (2|3|4)
 * @param {string} period - 'today'|'week'|'month'
 * @returns {Promise<Array>} ランキングエントリ配列
 */
async function fetchRanking(diff, period) {
  const res = await fetch(`${API_BASE}/api/rankings/${diff}/${period}`);
  if (!res.ok) throw new Error(`fetch error: ${res.status}`);
  return res.json();
}

/**
 * ランキングにエントリを登録
 * @param {string} name
 * @param {number} score
 * @param {number} diff
 * @returns {Promise<{rank:number, list:Array}>}
 */
async function postRanking(name, score, diff) {
  const res = await fetch(`${API_BASE}/api/rankings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score, difficulty: diff }),
  });
  if (!res.ok) throw new Error(`post error: ${res.status}`);
  return res.json();
}

// ===================================================
// ランキング描画（非同期API版）
// ===================================================

/** ローディング表示をランキングリストにセット */
function showRankingLoading() {
  const listEl = document.getElementById('ranking-list');
  listEl.innerHTML = `
    <div class="ranking-loading">
      <div class="spinner"></div>
      <span>読み込み中...</span>
    </div>
  `;
}

/**
 * ランキング画面を非同期で描画
 * @param {number} diff
 * @param {string} period
 * @param {number} highlightIndex
 */
async function renderRankingScreen(diff, period = state.rankPeriod, highlightIndex = -1) {
  // 難易度タブ更新
  document.querySelectorAll('.rank-tab:not(.plist-tab)').forEach(tab => {
    const isActive = parseInt(tab.dataset.tab, 10) === diff;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // 期間タブ更新
  document.querySelectorAll('.period-tab').forEach(tab => {
    const isActive = tab.dataset.period === period;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  state.rankPeriod = period;

  // ローディング表示
  showRankingLoading();

  let list;
  try {
    list = await fetchRanking(diff, period);
  } catch (e) {
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = `
      <div class="ranking-error">
        ⚠️ データの取得に失敗しました<br>
        <small>サーバーへの接続を確認してください</small>
      </div>
    `;
    return;
  }

  const listEl = document.getElementById('ranking-list');
  listEl.innerHTML = '';

  // 期間ラベル
  const periodLabels = { today: '直近24時間', week: '過去7日間', month: '過去30日間' };
  const label = document.createElement('div');
  label.className = 'rank-period-label';
  label.textContent = periodLabels[period] ?? '';
  listEl.appendChild(label);

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'rank-empty';
    empty.textContent = 'この期間の記録はありません';
    listEl.appendChild(empty);
    return;
  }

  const medals = ['🥇','🥈','🥉'];
  list.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = 'rank-item';
    if (i === 0) item.classList.add('top1');
    else if (i === 1) item.classList.add('top2');
    else if (i === 2) item.classList.add('top3');
    if (i === highlightIndex) item.classList.add('my-score');
    item.setAttribute('role', 'listitem');

    item.innerHTML = `
      <div class="rank-pos">${medals[i] ?? `${i+1}`}</div>
      <div class="rank-name">${escapeHtml(entry.name)}</div>
      <div class="rank-score">${entry.score}<span> pt</span></div>
      <div class="rank-date">${entry.date}</div>
    `;
    listEl.appendChild(item);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===================================================
// 結果画面イベント
// ===================================================
function initResult() {
  document.getElementById('btn-register').addEventListener('click', async () => {
    if (state.penaltyScore <= 0) return;
    const name = document.getElementById('input-name').value.trim();
    if (!name) {
      document.getElementById('input-name').focus();
      document.getElementById('input-name').style.borderColor = 'var(--wrong-red)';
      SFX.wrong();
      setTimeout(() => {
        document.getElementById('input-name').style.borderColor = '';
      }, 1200);
      return;
    }

    // 登録ボタンを一時的に無効化（二重送信防止）
    const btn = document.getElementById('btn-register');
    btn.disabled = true;
    btn.textContent = '登録中...';

    try {
      const { rank } = await postRanking(name, state.penaltyScore, state.difficulty);
      state.myScoreIndex = rank;
      SFX.register();
      showScreen('ranking');
      await renderRankingScreen(state.difficulty, 'week', rank);
    } catch (e) {
      // 通信エラー時はフォールバックメッセージ
      btn.disabled = false;
      btn.textContent = '登録';
      const alertEl = document.getElementById('score-alert');
      alertEl.textContent = '⚠️ 登録に失敗しました。もう一度お試しください。';
      alertEl.style.display = 'block';
      SFX.wrong();
      setTimeout(() => {
        alertEl.style.display = 'none';
      }, 3000);
    }
  });

  document.getElementById('btn-retry').addEventListener('click', () => {
    SFX.click();
    startCountdown();
  });

  document.getElementById('btn-home-result').addEventListener('click', () => {
    SFX.click();
    showScreen('home');
  });
}

// ===================================================
// ランキング画面イベント
// ===================================================
function initRanking() {
  // 難易度タブ（plist-tabは除外）
  document.querySelectorAll('.rank-tab:not(.plist-tab)').forEach(tab => {
    tab.addEventListener('click', () => {
      SFX.click();
      const diff = parseInt(tab.dataset.tab, 10);
      renderRankingScreen(diff, state.rankPeriod);
    });
  });

  // 期間タブ
  document.querySelectorAll('.period-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      SFX.click();
      const period = tab.dataset.period;
      // 現在選択中の難易度を取得
      const activeDiffTab = document.querySelector('.rank-tab.active:not(.plist-tab)');
      const diff = activeDiffTab ? parseInt(activeDiffTab.dataset.tab, 10) : (state.difficulty || 2);
      renderRankingScreen(diff, period);
    });
  });

  document.getElementById('btn-home-ranking').addEventListener('click', () => {
    SFX.click();
    showScreen('home');
  });
}

// ===================================================
// 素数一覧
// ===================================================
function renderPrimeList(diff) {
  document.querySelectorAll('.plist-tab').forEach(tab => {
    const isActive = parseInt(tab.dataset.plist, 10) === diff;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const { min, max } = DIFFICULTY_CONFIG[diff];
  const primes = [];
  for (let n = min; n <= max; n++) {
    if (isPrime(n)) primes.push(n);
  }

  // 件数バッジ更新
  const countEl = document.getElementById(`pcount-${diff}`);
  if (countEl) countEl.textContent = `(${primes.length})`;

  const grid = document.getElementById('primelist-grid');
  grid.innerHTML = '';
  primes.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'prime-chip';
    chip.setAttribute('role', 'listitem');
    chip.textContent = p;
    grid.appendChild(chip);
  });
}

function initPrimeList() {
  document.querySelectorAll('.plist-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      SFX.click();
      renderPrimeList(parseInt(tab.dataset.plist, 10));
    });
  });

  document.getElementById('btn-home-primelist').addEventListener('click', () => {
    SFX.click();
    showScreen('home');
  });
}

// ===================================================
// ゲームボタン
// ===================================================
function initGameButtons() {
  document.getElementById('btn-prime').addEventListener('click', () => handleAnswer(true));
  document.getElementById('btn-not-prime').addEventListener('click', () => handleAnswer(false));

  // キーボードショートカット（PC向け）
  document.addEventListener('keydown', (e) => {
    if (state.screen !== 'game') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') handleAnswer(true);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') handleAnswer(false);
  });
}

// ===================================================
// エントリーポイント
// ===================================================
document.addEventListener('DOMContentLoaded', () => {
  initStars();
  initMuteButton();
  initHome();
  initResult();
  initRanking();
  initGameButtons();
  initPrimeList();
  showScreen('home');
});
