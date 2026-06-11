const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ★ publicフォルダの中身（HTML/CSS/JS）をそのまま配信する
app.use(express.static('public'));

// データベースの初期化（環境変数があればそこを参照、なければローカルファイル）
const dbPath = process.env.DB_PATH || 'ideashelf.db';
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    edit_key TEXT,
    view_key TEXT,
    data TEXT,
    created_at TEXT,
    updated_at TEXT
  )
`);

const generateId = () => crypto.randomBytes(8).toString('hex');

// 1. ボード新規作成
app.post('/api/boards', (req, res) => {
  const boardId = generateId();
  const editKey = generateId();
  const viewKey = generateId();
  const now = new Date().toISOString();

  const initialData = {
    id: boardId,
    editKey: editKey,
    viewKey: viewKey,
    name: "新しいアイデアボード",
    createdAt: now,
    updatedAt: now,
    folders: [{ id: generateId(), parentId: null, name: "すべてのアイデア", isPublic: true, createdAt: now, updatedAt: now, order: 0 }],
    ideas: []
  };

  const stmt = db.prepare('INSERT INTO boards (id, edit_key, view_key, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(boardId, editKey, viewKey, JSON.stringify(initialData), now, now);

  res.json({ id: boardId, editKey, viewKey, data: initialData });
});

// 2. ボード取得
app.get('/api/boards/:id', (req, res) => {
  const { id } = req.params;
  const { key, mode } = req.query;

  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: "Board not found" });

  let boardData = JSON.parse(row.data);

  if (mode === 'edit' && key === row.edit_key) {
    return res.json(boardData);
  } else if (mode === 'view' && key === row.view_key) {
    boardData.folders = boardData.folders.filter(f => f.isPublic);
    const publicFolderIds = new Set(boardData.folders.map(f => f.id));
    boardData.ideas = boardData.ideas.filter(idea => publicFolderIds.has(idea.folderId));
    return res.json(boardData);
  } else {
    return res.status(403).json({ error: "Unauthorized" });
  }
});

// 3. ボード更新（保存）
app.put('/api/boards/:id', (req, res) => {
  const { id } = req.params;
  const { editKey, data } = req.body;
  const now = new Date().toISOString();

  const row = db.prepare('SELECT edit_key FROM boards WHERE id = ?').get(id);
  if (!row || row.edit_key !== editKey) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const stmt = db.prepare('UPDATE boards SET data = ?, updated_at = ? WHERE id = ?');
  stmt.run(JSON.stringify(data), now, id);

  res.json({ success: true });
});

// サーバー起動 (Fly.ioの仕様に合わせて0.0.0.0でリッスン)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Idea Shelf Backend running at http://localhost:${PORT}`);
});