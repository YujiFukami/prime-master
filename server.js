'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const Database = require('better-sqlite3');

// ===================================================
// DB 初期化
// ===================================================
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rankings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    score       INTEGER NOT NULL,
    difficulty  INTEGER NOT NULL,
    created_at  DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rankings_diff_created
    ON rankings (difficulty, created_at);
`);

// ===================================================
// 定期クリーンアップ: 30日超のデータを削除
// ===================================================
function cleanup() {
  const info = db.prepare(`
    DELETE FROM rankings
    WHERE created_at < datetime('now', '-30 days')
  `).run();
  if (info.changes > 0) {
    console.log(`[cleanup] ${info.changes} 件の古いランキングを削除しました`);
  }
}
cleanup();
// 1時間ごとに自動クリーンアップ
setInterval(cleanup, 60 * 60 * 1000);

// ===================================================
// Express 設定
// ===================================================
const app = express();
app.use(cors());
app.use(express.json());
// 静的ファイル（index.html / style.css / app.js）を配信
app.use(express.static(path.join(__dirname)));

// ===================================================
// 期間フィルタのヘルパー
// ===================================================
const PERIOD_SQL = {
  today : `datetime('now', '-1 days')`,   // 今日（直近24時間）
  week  : `datetime('now', '-7 days')`,
  month : `datetime('now', '-30 days')`,
};

// ===================================================
// GET /api/rankings/:difficulty/:period
// difficulty: 2 | 3 | 4
// period    : today | week | month
// ===================================================
app.get('/api/rankings/:difficulty/:period', (req, res) => {
  const diff   = parseInt(req.params.difficulty, 10);
  const period = req.params.period;

  if (![2, 3, 4].includes(diff)) {
    return res.status(400).json({ error: 'difficulty は 2, 3, 4 のいずれかです' });
  }
  if (!PERIOD_SQL[period]) {
    return res.status(400).json({ error: 'period は today, week, month のいずれかです' });
  }

  const rows = db.prepare(`
    SELECT
      name,
      score,
      strftime('%m/%d %H:%M', created_at) AS date
    FROM rankings
    WHERE difficulty = ?
      AND created_at >= ${PERIOD_SQL[period]}
    ORDER BY score DESC, created_at ASC
    LIMIT 10
  `).all(diff);

  res.json(rows);
});

// ===================================================
// POST /api/rankings
// Body: { name, score, difficulty }
// Returns: { rank, entry, list }
// ===================================================
app.post('/api/rankings', (req, res) => {
  const { name, score, difficulty } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: '名前は必須です' });
  }
  if (typeof score !== 'number' || score <= 0) {
    return res.status(400).json({ error: 'スコアは1以上が必要です' });
  }
  if (![2, 3, 4].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty は 2, 3, 4 のいずれかです' });
  }

  const safeName = name.trim().slice(0, 10);

  db.prepare(`
    INSERT INTO rankings (name, score, difficulty)
    VALUES (?, ?, ?)
  `).run(safeName, score, difficulty);

  // 登録後の今週ランキングを返す（登録したスコアの順位付きで）
  const list = db.prepare(`
    SELECT
      name,
      score,
      strftime('%m/%d %H:%M', created_at) AS date
    FROM rankings
    WHERE difficulty = ?
      AND created_at >= ${PERIOD_SQL.week}
    ORDER BY score DESC, created_at ASC
    LIMIT 10
  `).all(difficulty);

  const rank = list.findIndex(e => e.name === safeName && e.score === score);

  res.json({ rank, list });
});

// ===================================================
// ヘルスチェック
// ===================================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===================================================
// SPAフォールバック（その他のルートは index.html を返す）
// ===================================================
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===================================================
// サーバー起動
// ===================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 素数マスター サーバー起動: http://localhost:${PORT}`);
  console.log(`📦 DB: ${DB_PATH}`);
  console.log(`⚠️  注意: Renderの無料プランではサービス再起動時にDBが初期化されます`);
});
