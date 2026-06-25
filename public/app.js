const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const STORAGE_PREFIX = "idea-shelf-board:";
const RECENT_KEY = "idea-shelf-recent";

const state = {
  route: null,
  board: null,
  selectedFolderId: null,
  editingIdeaId: null,
  editorDraft: null,
  editorTab: "write",
  sort: "updated",
  sidebarOpen: false,
  unsavedIdeaId: null,
};

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const now = () => new Date().toISOString();

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripMarkdown(value = "") {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>|-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownToHtml(markdown = "") {
  let html = escapeHtml(markdown);
  html = html
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>");
  return html.replace(/(<li>.*?<\/li>)(?:<br>)?/g, "<ul>$1</ul>").replace(/<\/ul><ul>/g, "");
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function parseRoute() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get("board");
  const key = params.get("key");
  const mode = params.get("mode") === "view" ? "view" : "edit";
  return boardId && key ? { page: "board", boardId, key, mode } : { page: "home" };
}

async function saveBoard() {
  try {
    const response = await fetch(`/api/boards/${state.board.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editKey: state.board.editKey, data: state.board })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Save failed with status ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error("保存に失敗しました", error);
    showToast(error.message.includes("too large")
      ? "保存データが大きすぎます。管理者に連絡してください。"
      : "エラー：保存に失敗しました");
    return false;
  }
}

async function loadBoard(id) {
  try {
    const key = state.route.key;
    const mode = state.route.mode;
    const query = new URLSearchParams({ key, mode });
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}?${query}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("ボードの読み込みに失敗しました", error);
    return null;
  }
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch {
    return [];
  }
}

function rememberBoard(board, key, mode = "edit") {
  const recent = getRecent().filter(
    (item) => !(item.id === board.id && (item.mode || "edit") === mode),
  );
  recent.unshift({ id: board.id, name: board.name, key, mode, visitedAt: now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 8)));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function parseSharedBoardUrl(value) {
  const trimmed = value.trim();
  const urlText = trimmed.match(/https?:\/\/[^\s]+/)?.[0] || trimmed;

  try {
    const url = new URL(urlText, location.origin);
    const boardId = url.searchParams.get("board");
    const key = url.searchParams.get("key");
    const mode = url.searchParams.get("mode") === "view" ? "view" : "edit";

    if (url.origin !== location.origin || !boardId || !key) return null;
    return { boardId, key, mode };
  } catch {
    return null;
  }
}

function updateAppTitle(name = "Idea Shelf") {
  document.title = name;
  document
    .querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", name);
}

async function createBoard() {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Create failed with status ${response.status}`);
    }
    const newBoard = await response.json();
    
    // バックエンドから返ってきた初期データを状態にセットして画面遷移
    state.board = newBoard.data; 
    rememberBoard(state.board, newBoard.editKey, "edit");
    navigateToBoard(newBoard.id, newBoard.editKey, "edit");
  } catch (error) {
    console.error("ボードの作成に失敗しました", error);
    showToast("エラー：ボードの作成に失敗しました");
  }
}

function navigateToBoard(id, key, mode) {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ board: id, key, mode }).toString();
  history.pushState({}, "", url);
  initialize();
}

function navigateHome() {
  history.pushState({}, "", location.pathname);
  initialize();
}

function isEditor() {
  return state.route?.mode === "edit";
}

function rootFolder() {
  return state.board.folders.find((folder) => folder.parentId === null);
}

function selectedFolder() {
  const selected = state.board.folders.find(
    (folder) => folder.id === state.selectedFolderId,
  );
  if (selected && folderVisible(selected)) return selected;
  return visibleFolders()[0] || null;
}

function folderVisible(folder) {
  if (isEditor()) return true;
  let current = folder;
  while (current) {
    if (!current.isPublic) return false;
    current = state.board.folders.find((item) => item.id === current.parentId);
  }
  return true;
}

function visibleFolders() {
  return state.board.folders.filter(folderVisible);
}

function folderPath(folder) {
  const path = [];
  let current = folder;
  while (current) {
    path.unshift(current.name);
    current = state.board.folders.find((item) => item.id === current.parentId);
  }
  return path;
}

function buildFolderTree(parentId = null, depth = 0) {
  return visibleFolders()
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map(
      (folder) => `
        <div
          class="tree-item ${folder.id === state.selectedFolderId ? "active" : ""}"
          style="padding-left: ${7 + depth * 17}px"
          data-action="select-folder"
          data-id="${folder.id}"
        >
          <span class="folder-icon">${folder.parentId === null ? "◆" : "◇"}</span>
          <span class="tree-name">${escapeHtml(folder.name)}</span>
          ${
            isEditor()
              ? `<span class="visibility-dot ${folder.isPublic ? "" : "private"}" title="${
                  folder.isPublic ? "公開" : "非公開"
                }"></span>`
              : ""
          }
        </div>
        ${buildFolderTree(folder.id, depth + 1)}
      `,
    )
    .join("");
}

function renderHome() {
  const recent = getRecent();
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar(false)}
      <main class="home">
        <section class="hero">
          <div>
            <p class="eyebrow">Your ideas, in one quiet place.</p>
            <h1>思いつきを、<br>育てられる場所へ。</h1>
            <p class="hero-copy">
              書き留めて、整理して、必要な人にだけ見せる。<br>
              アカウントなしですぐに使える、あなたのアイデア貯蔵庫です。
            </p>
            <div class="hero-actions">
              <button class="button primary" data-action="create-board">新しいボードをつくる</button>
              <span>または</span>
              <button class="button" data-action="focus-import">共有URLを追加</button>
            </div>
          </div>
          <div class="hero-note" aria-hidden="true">
            <span class="sketch-tag">PROJECT NOTE</span>
            <h3>週末に試したいこと</h3>
            <div class="sketch-line"></div>
            <div class="sketch-line"></div>
            <div class="sketch-line short"></div>
            <div class="sketch-line"></div>
          </div>
        </section>
        <section class="import-section" id="import-board">
          <div class="import-copy">
            <p class="eyebrow">Open shared board</p>
            <h2>共有されたボードを追加</h2>
            <p>編集用または閲覧用URLを貼り付けると、このアプリの「最近のボード」に保存されます。</p>
          </div>
          <form class="import-form" data-action="import-board">
            <label for="shared-board-url">共有URL</label>
            <div class="import-field">
              <input
                id="shared-board-url"
                name="sharedUrl"
                type="text"
                inputmode="url"
                autocomplete="off"
                placeholder="https://.../?board=...&key=...&mode=view"
                required
              >
              <button class="button primary" type="submit">ボードを追加</button>
            </div>
            <p class="form-error" data-import-error aria-live="polite"></p>
          </form>
        </section>
        <section class="recent-section">
          <div class="section-heading">
            <div>
              <h2>最近のボード</h2>
              <p>この端末で開いた編集用・閲覧用ボード</p>
            </div>
          </div>
          ${
            recent.length
              ? `<div class="recent-grid">${recent
                  .map(
                    (item) => `
                      <article class="recent-card" data-action="open-recent" data-id="${
                        item.id
                      }" data-key="${item.key}" data-mode="${item.mode || "edit"}">
                        <span class="card-number">${
                          item.mode === "view" ? "SHARED BOARD" : "BOARD"
                        }</span>
                        <h3>${escapeHtml(item.name)}</h3>
                        <p>${item.mode === "view" ? "閲覧用" : "編集用"}・最終アクセス ${formatDate(
                          item.visitedAt,
                        )}</p>
                      </article>
                    `,
                  )
                  .join("")}</div>`
              : `<div class="empty-state">まだボードはありません。最初のアイデア置き場をつくりましょう。</div>`
          }
        </section>
      </main>
    </div>
  `;
}

function renderTopbar(showBoardActions = true) {
  return `
    <header class="topbar">
      <button class="brand" data-action="home">
        <span class="brand-mark">I</span>
        <span>Idea Shelf</span>
      </button>
      ${
        showBoardActions
          ? `<div class="topbar-actions">
              <button class="icon-button mobile-menu" data-action="toggle-sidebar" aria-label="メニュー">☰</button>
              ${
                isEditor()
                  ? `<button class="button share-button edit-share" data-action="copy-share-url" data-mode="edit" title="編集用URLをコピー">
                       <span class="share-button-icon">✎</span>
                       <span>編集用URL</span>
                     </button>
                     <button class="button share-button view-share" data-action="copy-share-url" data-mode="view" title="閲覧用URLをコピー">
                       <span class="share-button-icon">○</span>
                       <span>閲覧用URL</span>
                     </button>
                     <button class="icon-button share-details" data-action="share" title="共有URLの詳細" aria-label="共有URLの詳細">⋯</button>`
                  : `<span class="access-badge view">閲覧専用</span>`
              }
              <button class="button primary" data-action="new-idea" ${
                isEditor() ? "" : "hidden"
              }>＋ アイデア</button>
            </div>`
          : ""
      }
    </header>
  `;
}

function renderBoard() {
  const folder = selectedFolder();
  const ideas = folder
    ? state.board.ideas.filter((idea) => idea.folderId === folder.id)
    : [];
  const sortedIdeas = [...ideas].sort((a, b) => {
    if (state.sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
    if (state.sort === "manual") return a.order - b.order;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar(true)}
      <div class="board-layout">
        <aside class="sidebar ${state.sidebarOpen ? "open" : ""}">
          <div class="sidebar-head">
            <input
              class="board-name"
              value="${escapeHtml(state.board.name)}"
              aria-label="ボード名"
              data-action="rename-board"
              ${isEditor() ? "" : "disabled"}
            >
            <span class="access-badge ${isEditor() ? "" : "view"}">
              ${isEditor() ? "● 編集モード" : "○ 閲覧モード"}
            </span>
          </div>
          ${
            isEditor()
              ? `<div class="sidebar-tools">
                  <button class="button" data-action="new-folder">＋ フォルダ</button>
                  <button class="button" data-action="new-subfolder">＋ 子フォルダ</button>
                </div>`
              : ""
          }
          <p class="tree-label">Folders</p>
          <nav>${buildFolderTree()}</nav>
        </aside>
        <main class="main-panel">
          ${
            state.editingIdeaId
              ? renderEditor()
              : folder
                ? renderFolderContent(folder, sortedIdeas)
                : renderNoPublicContent()
          }
        </main>
      </div>
    </div>
  `;
}

function renderNoPublicContent() {
  return `
    <div class="content-wrap">
      <div class="content-toolbar">
        <div>
          <div class="breadcrumb">Shared board</div>
          <h1>${escapeHtml(state.board.name)}</h1>
        </div>
      </div>
      <div class="empty-state">
        このボードには、現在公開されているフォルダがありません。
      </div>
    </div>
  `;
}

function renderFolderContent(folder, ideas) {
  const path = folderPath(folder);
  return `
    <div class="content-wrap">
      <div class="content-toolbar">
        <div>
          <div class="breadcrumb">${path.map(escapeHtml).join(" / ")}</div>
          <h1>${escapeHtml(folder.name)}</h1>
        </div>
        <div class="toolbar-actions">
          ${
            isEditor()
              ? `
                <button class="button" data-action="toggle-public">
                  ${folder.isPublic ? "● 公開中" : "○ 非公開"}
                </button>
                ${
                  folder.parentId
                    ? `<button class="icon-button" data-action="rename-folder" title="名前を変更">✎</button>
                       <button class="icon-button" data-action="delete-folder" title="削除">×</button>`
                    : ""
                }
              `
              : ""
          }
          <select class="select" data-action="change-sort" aria-label="並び順">
            <option value="updated" ${state.sort === "updated" ? "selected" : ""}>更新が新しい順</option>
            <option value="created" ${state.sort === "created" ? "selected" : ""}>作成が新しい順</option>
            <option value="manual" ${state.sort === "manual" ? "selected" : ""}>手動並び替え</option>
          </select>
        </div>
      </div>
      ${
        ideas.length
          ? `<div class="cards-grid">${ideas
              .map(
                (idea, index) => `
                  <article
                    class="idea-card"
                    data-action="open-idea"
                    data-id="${idea.id}"
                    draggable="${isEditor() && state.sort === "manual"}"
                  >
                    <span class="card-number">${String(index + 1).padStart(2, "0")}</span>
                    <h3>${escapeHtml(idea.title || "無題のアイデア")}</h3>
                    <div class="excerpt">${escapeHtml(
                      stripMarkdown(idea.body) || "本文はまだありません",
                    )}</div>
                    <div class="card-meta">
                      <span>${formatDate(idea.updatedAt)} 更新</span>
                      ${
                        idea.comments?.length
                          ? `<span class="comment-count">コメント ${idea.comments.length}</span>`
                          : ""
                      }
                      <span>→</span>
                    </div>
                  </article>
                `,
              )
              .join("")}</div>`
          : `<div class="empty-state">
              ${
                isEditor()
                  ? "このフォルダはまだ空です。最初のアイデアを書いてみましょう。"
                  : "公開されているアイデアはまだありません。"
              }
            </div>`
      }
    </div>
  `;
}

function renderEditor() {
  const draft = state.editorDraft;
  const idea = state.board.ideas.find((item) => item.id === state.editingIdeaId);
  const dirty =
    isEditor() &&
    idea &&
    (draft.title !== idea.title || draft.body !== idea.body);

  return `
    <div class="content-wrap editor">
      <div class="editor-header">
        <button class="back-link" data-action="close-editor">← 一覧に戻る</button>
        <div class="editor-actions">
          <span class="save-state ${dirty ? "dirty" : ""}">
            ${dirty ? "未保存の変更があります" : "保存済み"}
          </span>
          ${
            isEditor()
              ? `<button class="button danger" data-action="delete-idea">削除</button>
                 <button class="button primary" data-action="save-idea">保存する</button>`
              : ""
          }
        </div>
      </div>
      <input
        class="title-input"
        value="${escapeHtml(draft.title)}"
        placeholder="アイデアのタイトル"
        data-editor-field="title"
        ${isEditor() ? "" : "disabled"}
      >
      <div class="editor-tabs">
        ${
          isEditor()
            ? `<button class="tab ${state.editorTab === "write" ? "active" : ""}" data-action="editor-tab" data-tab="write">Markdown</button>`
            : ""
        }
        <button class="tab ${state.editorTab === "preview" ? "active" : ""}" data-action="editor-tab" data-tab="preview">プレビュー</button>
      </div>
      ${
        state.editorTab === "write" && isEditor()
          ? `<textarea
              class="body-input"
              placeholder="# 見出し&#10;&#10;アイデアの背景や、試したいことを書きましょう。"
              data-editor-field="body"
            >${escapeHtml(draft.body)}</textarea>`
          : `<article class="markdown-preview">${
              draft.body ? markdownToHtml(draft.body) : "<p>本文はまだありません。</p>"
            }</article>`
      }
      ${renderComments(idea)}
    </div>
  `;
}

function renderComments(idea) {
  const comments = Array.isArray(idea.comments) ? idea.comments : [];
  const isUnsaved = idea.id === state.unsavedIdeaId;

  return `
    <section class="comments-section">
      <div class="comments-heading">
        <div>
          <p class="eyebrow">Anonymous feedback</p>
          <h2>コメント <span>${comments.length}</span></h2>
        </div>
        <p>名前やアカウントなしで投稿できます</p>
      </div>
      ${
        isUnsaved
          ? `<div class="comment-save-notice">コメントを受け付けるには、先にアイデアを保存してください。</div>`
          : `<form class="comment-form" data-action="submit-comment">
              <textarea
                class="comment-input"
                name="comment"
                maxlength="1000"
                placeholder="このアイデアへの感想や提案を書く..."
                required
              ></textarea>
              <div class="comment-form-footer">
                <span>匿名で公開されます</span>
                <button class="button primary" type="submit">コメントする</button>
              </div>
            </form>`
      }
      <div class="comments-list">
        ${
          comments.length
            ? [...comments]
                .reverse()
                .map(
                  (comment) => `
                    <article class="comment-item">
                      <div class="comment-meta">
                        <span class="anonymous-avatar">A</span>
                        <strong>匿名</strong>
                        <time datetime="${escapeHtml(comment.createdAt)}">${formatDateTime(
                          comment.createdAt,
                        )}</time>
                      </div>
                      <p>${escapeHtml(comment.content).replaceAll("\n", "<br>")}</p>
                    </article>
                  `,
                )
                .join("")
            : `<div class="comments-empty">まだコメントはありません。最初のフィードバックを届けてみましょう。</div>`
        }
      </div>
    </section>
  `;
}

async function submitComment(form) {
  const input = form.elements.comment;
  const content = input.value.trim();
  if (!content) return;

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "送信中...";

  try {
    const response = await fetch(
      `/api/boards/${encodeURIComponent(state.board.id)}/ideas/${encodeURIComponent(
        state.editingIdeaId,
      )}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.route.key, content }),
      },
    );

    if (!response.ok) throw new Error(`Comment failed with status ${response.status}`);

    const comment = await response.json();
    const idea = state.board.ideas.find((item) => item.id === state.editingIdeaId);
    if (!Array.isArray(idea.comments)) idea.comments = [];
    idea.comments.push(comment);
    renderBoard();
    showToast("コメントを投稿しました");
  } catch (error) {
    console.error("コメントの投稿に失敗しました", error);
    button.disabled = false;
    button.textContent = "コメントする";
    showToast("コメントを投稿できませんでした");
  }
}

function renderShareModal() {
  const editUrl = buildShareUrl("edit");
  const viewUrl = buildShareUrl("view");

  document.querySelector(".modal-backdrop")?.remove();
  app.insertAdjacentHTML(
    "beforeend",
    `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal" role="dialog" aria-modal="true">
          <h2>ボードを共有</h2>
          <p>閲覧用URLでは、公開設定されたフォルダとアイデアだけが表示されます。</p>
          <div class="share-row">
            <label>編集用URL</label>
            <div class="copy-field">
              <input value="${escapeHtml(editUrl.href)}" readonly>
              <button class="button" data-action="copy-url" data-url="${escapeHtml(
                editUrl.href,
              )}">コピー</button>
            </div>
          </div>
          <div class="share-row">
            <label>閲覧専用URL</label>
            <div class="copy-field">
              <input value="${escapeHtml(viewUrl.href)}" readonly>
              <button class="button" data-action="copy-url" data-url="${escapeHtml(
                viewUrl.href,
              )}">コピー</button>
            </div>
          </div>
          <div class="modal-actions">
            <button class="button primary" data-action="close-modal">閉じる</button>
          </div>
        </section>
      </div>
    `,
  );
}

function buildShareUrl(mode) {
  const url = new URL(location.href);
  const key = mode === "view" ? state.board.viewKey : state.board.editKey;
  url.search = new URLSearchParams({
    board: state.board.id,
    key,
    mode,
  }).toString();
  return url;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function createFolder(parentId) {
  const name = prompt("フォルダ名を入力してください");
  if (!name?.trim()) return;
  const siblings = state.board.folders.filter((folder) => folder.parentId === parentId);
  const folder = {
    id: uid(),
    parentId,
    name: name.trim(),
    isPublic: true,
    createdAt: now(),
    updatedAt: now(),
    order: siblings.length,
  };
  state.board.folders.push(folder);
  state.board.updatedAt = now();
  state.selectedFolderId = folder.id;
  saveBoard();
  renderBoard();
}

function newIdea() {
  const ideas = state.board.ideas.filter(
    (idea) => idea.folderId === state.selectedFolderId,
  );
  const idea = {
    id: uid(),
    folderId: state.selectedFolderId,
    title: "",
    body: "",
    createdAt: now(),
    updatedAt: now(),
    order: ideas.length,
    comments: [],
  };
  state.board.ideas.push(idea);
  state.editingIdeaId = idea.id;
  state.unsavedIdeaId = idea.id;
  state.editorDraft = { title: "", body: "" };
  state.editorTab = "write";
  renderBoard();
  document.querySelector(".title-input")?.focus();
}

function openIdea(id) {
  const idea = state.board.ideas.find((item) => item.id === id);
  if (!idea) return;
  state.editingIdeaId = id;
  state.editorDraft = { title: idea.title, body: idea.body };
  state.editorTab = isEditor() ? "write" : "preview";
  state.sidebarOpen = false;
  renderBoard();
}

async function saveIdea() {
  const idea = state.board.ideas.find((item) => item.id === state.editingIdeaId);
  if (!idea) return;
  const firstLine = stripMarkdown(state.editorDraft.body.split("\n")[0]);
  idea.title = state.editorDraft.title.trim() || firstLine.slice(0, 60) || "無題のアイデア";
  idea.body = state.editorDraft.body;
  idea.updatedAt = now();
  state.editorDraft.title = idea.title;
  state.board.updatedAt = now();
  const saved = await saveBoard();
  if (!saved) return;
  state.unsavedIdeaId = null;
  renderBoard();
  showToast("アイデアを保存しました");
}

function deleteFolderAndContents(folderId) {
  const childIds = state.board.folders
    .filter((folder) => folder.parentId === folderId)
    .map((folder) => folder.id);
  childIds.forEach(deleteFolderAndContents);
  state.board.ideas = state.board.ideas.filter((idea) => idea.folderId !== folderId);
  state.board.folders = state.board.folders.filter((folder) => folder.id !== folderId);
}

async function initialize() {
  state.route = parseRoute();
  state.editingIdeaId = null;
  state.editorDraft = null;
  state.sidebarOpen = false;
  state.unsavedIdeaId = null;

  if (state.route.page === "home") {
    state.board = null;
    updateAppTitle();
    renderHome();
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar(false)}
      <main class="home">
        <div class="empty-state">ボードを読み込んでいます...</div>
      </main>
    </div>
  `;

  const board = await loadBoard(state.route.boardId);
  if (!board) {
    app.innerHTML = `
      <div class="app-shell">
        ${renderTopbar(false)}
        <main class="home">
          <div class="empty-state">
            <h2>ボードを開けませんでした</h2>
            <p>URLが正しいか、このブラウザにボードのデータがあるか確認してください。</p>
            <button class="button primary" data-action="home">トップへ戻る</button>
          </div>
        </main>
      </div>
    `;
    return;
  }

  state.board = board;
  updateAppTitle(board.name);
  const root = board.folders.find((folder) => folder.parentId === null);
  state.selectedFolderId = root?.id || board.folders[0]?.id || null;
  rememberBoard(board, state.route.key, state.route.mode);
  renderBoard();
}

app.addEventListener("input", (event) => {
  const field = event.target.dataset.editorField;
  if (field && state.editorDraft) {
    state.editorDraft[field] = event.target.value;
    const status = document.querySelector(".save-state");
    if (status) {
      status.textContent = "未保存の変更があります";
      status.classList.add("dirty");
    }
  }
});

app.addEventListener("change", (event) => {
  if (event.target.dataset.action === "change-sort") {
    state.sort = event.target.value;
    renderBoard();
  }
  if (event.target.dataset.action === "rename-board" && isEditor()) {
    const name = event.target.value.trim();
    if (!name) return;
    state.board.name = name;
    state.board.updatedAt = now();
    saveBoard();
    rememberBoard(state.board, state.board.editKey, "edit");
    showToast("ボード名を変更しました");
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "home") navigateHome();
  if (action === "create-board") createBoard();
  if (action === "focus-import") {
    document.querySelector("#import-board")?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => document.querySelector("#shared-board-url")?.focus(), 350);
  }
  if (action === "open-recent")
    navigateToBoard(target.dataset.id, target.dataset.key, target.dataset.mode || "edit");
  if (action === "toggle-sidebar") {
    state.sidebarOpen = !state.sidebarOpen;
    renderBoard();
  }
  if (action === "select-folder") {
    state.selectedFolderId = target.dataset.id;
    state.editingIdeaId = null;
    state.sidebarOpen = false;
    renderBoard();
  }
  if (action === "new-folder" && isEditor()) createFolder(rootFolder().id);
  if (action === "new-subfolder" && isEditor()) createFolder(state.selectedFolderId);
  if (action === "new-idea" && isEditor()) newIdea();
  if (action === "open-idea") openIdea(target.dataset.id);
  if (action === "close-editor") {
    state.editingIdeaId = null;
    state.editorDraft = null;
    renderBoard();
  }
  if (action === "editor-tab") {
    state.editorTab = target.dataset.tab;
    renderBoard();
  }
  if (action === "save-idea" && isEditor()) await saveIdea();
  if (action === "delete-idea" && isEditor()) {
    if (!confirm("このアイデアを削除しますか？")) return;
    state.board.ideas = state.board.ideas.filter(
      (idea) => idea.id !== state.editingIdeaId,
    );
    state.unsavedIdeaId = null;
    saveBoard();
    state.editingIdeaId = null;
    state.editorDraft = null;
    renderBoard();
    showToast("アイデアを削除しました");
  }
  if (action === "toggle-public" && isEditor()) {
    const folder = selectedFolder();
    folder.isPublic = !folder.isPublic;
    folder.updatedAt = now();
    saveBoard();
    renderBoard();
    showToast(folder.isPublic ? "フォルダを公開しました" : "フォルダを非公開にしました");
  }
  if (action === "rename-folder" && isEditor()) {
    const folder = selectedFolder();
    const name = prompt("新しいフォルダ名", folder.name);
    if (!name?.trim()) return;
    folder.name = name.trim();
    folder.updatedAt = now();
    saveBoard();
    renderBoard();
  }
  if (action === "delete-folder" && isEditor()) {
    if (!confirm("フォルダ内のアイデアと子フォルダも削除されます。続けますか？")) return;
    const parentId = selectedFolder().parentId;
    deleteFolderAndContents(state.selectedFolderId);
    state.selectedFolderId = parentId || rootFolder().id;
    saveBoard();
    renderBoard();
    showToast("フォルダを削除しました");
  }
  if (action === "share") renderShareModal();
  if (action === "copy-share-url" && isEditor()) {
    const mode = target.dataset.mode;
    await copyText(buildShareUrl(mode).href);
    showToast(mode === "view" ? "閲覧用URLをコピーしました" : "編集用URLをコピーしました");
  }
  if (action === "close-modal") {
    if (target.classList.contains("modal-backdrop") && event.target !== target) return;
    target.closest(".modal-backdrop")?.remove();
  }
  if (action === "copy-url") {
    await copyText(target.dataset.url);
    showToast("URLをコピーしました");
  }
});

app.addEventListener("submit", async (event) => {
  const importForm = event.target.closest('[data-action="import-board"]');
  if (importForm) {
    event.preventDefault();
    const route = parseSharedBoardUrl(importForm.elements.sharedUrl.value);
    const error = importForm.querySelector("[data-import-error]");

    if (!route) {
      error.textContent = "このアプリで発行された共有URLを入力してください。";
      return;
    }

    error.textContent = "";
    navigateToBoard(route.boardId, route.key, route.mode);
    return;
  }

  const form = event.target.closest('[data-action="submit-comment"]');
  if (!form) return;
  event.preventDefault();
  await submitComment(form);
});

let draggedIdeaId = null;

app.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".idea-card");
  if (!card || state.sort !== "manual") return;
  draggedIdeaId = card.dataset.id;
  card.classList.add("dragging");
});

app.addEventListener("dragover", (event) => {
  const card = event.target.closest(".idea-card");
  if (!card || !draggedIdeaId) return;
  event.preventDefault();
  card.classList.add("drag-over");
});

app.addEventListener("dragleave", (event) => {
  event.target.closest(".idea-card")?.classList.remove("drag-over");
});

app.addEventListener("drop", (event) => {
  const card = event.target.closest(".idea-card");
  if (!card || !draggedIdeaId || card.dataset.id === draggedIdeaId) return;
  event.preventDefault();
  const folderIdeas = state.board.ideas
    .filter((idea) => idea.folderId === state.selectedFolderId)
    .sort((a, b) => a.order - b.order);
  const from = folderIdeas.findIndex((idea) => idea.id === draggedIdeaId);
  const to = folderIdeas.findIndex((idea) => idea.id === card.dataset.id);
  const [moved] = folderIdeas.splice(from, 1);
  folderIdeas.splice(to, 0, moved);
  folderIdeas.forEach((idea, index) => {
    idea.order = index;
  });
  saveBoard();
  draggedIdeaId = null;
  renderBoard();
});

app.addEventListener("dragend", () => {
  draggedIdeaId = null;
  document.querySelectorAll(".dragging, .drag-over").forEach((element) => {
    element.classList.remove("dragging", "drag-over");
  });
});

window.addEventListener("popstate", initialize);
initialize();
