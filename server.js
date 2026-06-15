const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// publicフォルダの中身（HTML/CSS/JS）をそのまま配信する
app.use(express.static(path.join(__dirname, 'public')));

// データベースの初期化（環境変数があればそこを参照、なければローカルファイル）
const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, 'ideashelf.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
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

function parseBoardData(row) {
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function getVisibleFolderIds(boardData) {
  const foldersById = new Map(boardData.folders.map(folder => [folder.id, folder]));
  const isVisible = (folder) => {
    let current = folder;
    const visited = new Set();

    while (current) {
      if (visited.has(current.id) || !current.isPublic) return false;
      visited.add(current.id);
      current = current.parentId ? foldersById.get(current.parentId) : null;
    }

    return true;
  };

  return new Set(boardData.folders.filter(isVisible).map(folder => folder.id));
}

function getAccessMode(row, key) {
  if (key === row.edit_key) return 'edit';
  if (key === row.view_key) return 'view';
  return null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

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

  const boardData = parseBoardData(row);
  if (!boardData) {
    return res.status(500).json({ error: "Board data is invalid" });
  }

  if (mode === 'edit' && key === row.edit_key) {
    return res.json(boardData);
  } else if (mode === 'view' && key === row.view_key) {
    const publicFolderIds = getVisibleFolderIds(boardData);
    boardData.folders = boardData.folders.filter(folder => publicFolderIds.has(folder.id));
    boardData.ideas = boardData.ideas.filter(idea => publicFolderIds.has(idea.folderId));
    delete boardData.editKey;
    delete boardData.viewKey;
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

  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!row || row.edit_key !== editKey) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!data || typeof data !== 'object' || !Array.isArray(data.folders) || !Array.isArray(data.ideas)) {
    return res.status(400).json({ error: "Invalid board data" });
  }

  data.id = id;
  data.editKey = row.edit_key;
  data.viewKey = row.view_key;
  data.updatedAt = now;

  const storedData = parseBoardData(row);
  if (storedData) {
    const storedIdeas = new Map(storedData.ideas.map(idea => [idea.id, idea]));
    for (const idea of data.ideas) {
      const storedComments = storedIdeas.get(idea.id)?.comments || [];
      const incomingComments = Array.isArray(idea.comments) ? idea.comments : [];
      const commentsById = new Map(
        [...storedComments, ...incomingComments].map(comment => [comment.id, comment])
      );
      idea.comments = [...commentsById.values()].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
    }
  }

  const stmt = db.prepare('UPDATE boards SET data = ?, updated_at = ? WHERE id = ?');
  stmt.run(JSON.stringify(data), now, id);

  res.json({ success: true });
});

// 4. アイデアへの匿名コメント投稿
app.post('/api/boards/:id/ideas/:ideaId/comments', (req, res) => {
  const { id, ideaId } = req.params;
  const { key, content } = req.body;
  const normalizedContent = typeof content === 'string' ? content.trim() : '';

  if (!normalizedContent || normalizedContent.length > 1000) {
    return res.status(400).json({ error: "Comment must be between 1 and 1000 characters" });
  }

  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: "Board not found" });

  const accessMode = getAccessMode(row, key);
  if (!accessMode) return res.status(403).json({ error: "Unauthorized" });

  const boardData = parseBoardData(row);
  if (!boardData) return res.status(500).json({ error: "Board data is invalid" });

  const idea = boardData.ideas.find(item => item.id === ideaId);
  if (!idea) return res.status(404).json({ error: "Idea not found" });

  if (accessMode === 'view') {
    const publicFolderIds = getVisibleFolderIds(boardData);
    if (!publicFolderIds.has(idea.folderId)) {
      return res.status(404).json({ error: "Idea not found" });
    }
  }

  const comment = {
    id: generateId(),
    content: normalizedContent,
    createdAt: new Date().toISOString()
  };

  if (!Array.isArray(idea.comments)) idea.comments = [];
  idea.comments.push(comment);

  const now = new Date().toISOString();
  db.prepare('UPDATE boards SET data = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(boardData), now, id);

  res.status(201).json(comment);
});

// サーバー起動 (Fly.ioの仕様に合わせて0.0.0.0でリッスン)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Idea Shelf Backend running at http://localhost:${PORT}`);
});
