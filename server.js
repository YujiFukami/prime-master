'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const sqlite3  = require('sqlite3').verbose();

// ===================================================
// Promise ラッパー（sqlite3はコールバック型のため）
// ===================================================
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ===================================================
// DB 初期化
// ===================================================
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('DB接続エラー:', err.message);
  } else {
    console.log(`📦 DB接続: ${DB_PATH}`);
  }
});

// WALモードとテーブル作成
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS rankings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      score       INTEGER NOT NULL,
      difficulty  INTEGER NOT NULL,
      created_at  DATETIME DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_rankings_diff_created
      ON rankings (difficulty, created_at)
  `);
  console.log('✅ テーブル初期化完了');
});

// ===================================================
// 定期クリーンアップ: 30日超のデータを削除
// ===================================================
async function cleanup() {
  try {
    const result = await dbRun(db,
      `DELETE FROM rankings WHERE created_at < datetime('now', '-30 days')`
    );
    if (result.changes > 0) {
      console.log(`[cleanup] ${result.changes} 件の古いランキングを削除しました`);
    }
  } catch (e) {
    console.error('[cleanup] エラー:', e.message);
  }
}
cleanup();
setInterval(cleanup, 60 * 60 * 1000);

// ===================================================
// Express 設定
// ===================================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===================================================
// 期間フィルタのヘルパー
// ===================================================
const PERIOD_SQL = {
  today : `datetime('now', '-1 days')`,
  week  : `datetime('now', '-7 days')`,
  month : `datetime('now', '-30 days')`,
};

// ===================================================
// GET /api/rankings/:difficulty/:period
// ===================================================
app.get('/api/rankings/:difficulty/:period', async (req, res) => {
  const diff   = parseInt(req.params.difficulty, 10);
  const period = req.params.period;

  if (![2, 3, 4].includes(diff)) {
    return res.status(400).json({ error: 'difficulty は 2, 3, 4 のいずれかです' });
  }
  if (!PERIOD_SQL[period]) {
    return res.status(400).json({ error: 'period は today, week, month のいずれかです' });
  }

  try {
    const rows = await dbAll(db, `
      SELECT
        name,
        score,
        strftime('%m/%d %H:%M', created_at) AS date
      FROM rankings
      WHERE difficulty = ?
        AND created_at >= ${PERIOD_SQL[period]}
      ORDER BY score DESC, created_at ASC
      LIMIT 10
    `, [diff]);

    res.json(rows);
  } catch (e) {
    console.error('GET /api/rankings エラー:', e.message);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ===================================================
// POST /api/rankings
// ===================================================
app.post('/api/rankings', async (req, res) => {
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

  try {
    await dbRun(db,
      `INSERT INTO rankings (name, score, difficulty) VALUES (?, ?, ?)`,
      [safeName, score, difficulty]
    );

    // 今週のランキングを返す
    const list = await dbAll(db, `
      SELECT
        name,
        score,
        strftime('%m/%d %H:%M', created_at) AS date
      FROM rankings
      WHERE difficulty = ?
        AND created_at >= ${PERIOD_SQL.week}
      ORDER BY score DESC, created_at ASC
      LIMIT 10
    `, [difficulty]);

    const rank = list.findIndex(e => e.name === safeName && e.score === score);
    res.json({ rank, list });
  } catch (e) {
    console.error('POST /api/rankings エラー:', e.message);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ===================================================
// ヘルスチェック
// ===================================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===================================================
// SPAフォールバック
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
  console.log(`⚠️  注意: Renderの無料プランではサービス再起動時にDBが初期化されます`);
});
