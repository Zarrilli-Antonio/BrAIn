const treeEl = document.getElementById("tree");
const contentEl = document.getElementById("content");
const searchEl = document.getElementById("search");
const menuToggle = document.getElementById("menuToggle");
const scrimEl = document.getElementById("scrim");
let mode = "files";
let docsCache = [];
let graphRAF = null;
let currentDoc = null;
let currentProfile = "dev"; // set for real in init(), before anything else runs
let tabEls = []; // populated in init(), once profile-only tabs are shown/hidden

const ICON_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
menuToggle.innerHTML = ICON_MENU;

function openDrawer() {
  document.getElementById("tree").classList.add("open");
  scrimEl.classList.add("open");
  menuToggle.innerHTML = ICON_CLOSE;
  menuToggle.setAttribute("aria-expanded", "true");
}
function closeDrawer() {
  document.getElementById("tree").classList.remove("open");
  scrimEl.classList.remove("open");
  menuToggle.innerHTML = ICON_MENU;
  menuToggle.setAttribute("aria-expanded", "false");
}
menuToggle.onclick = () => {
  document.getElementById("tree").classList.contains("open") ? closeDrawer() : openDrawer();
};
scrimEl.onclick = closeDrawer;

function stopGraph() {
  if (graphRAF) cancelAnimationFrame(graphRAF);
  graphRAF = null;
}

function pulseContent() {
  contentEl.classList.remove("content-in");
  void contentEl.offsetWidth;
  contentEl.classList.add("content-in");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderCreateBar() {
  const bar = document.createElement("div");
  bar.className = "toolbar";
  const fileBtn = document.createElement("button");
  fileBtn.textContent = "+ File";
  fileBtn.onclick = () => openCreateModal("file");
  const folderBtn = document.createElement("button");
  folderBtn.textContent = "+ Folder";
  folderBtn.onclick = () => openCreateModal("folder");
  bar.append(fileBtn, folderBtn);
  return bar;
}

let lastTree = null;

async function loadTree() {
  contentEl.className = "code";
  const res = await fetch("/api/files");
  lastTree = await res.json();
  treeEl.innerHTML = "";
  treeEl.appendChild(renderCreateBar());
  treeEl.appendChild(renderNode(lastTree, 0));
}

/** Opens a project file for viewing/editing, switching to the Files tab first if a click
 *  originated elsewhere (a search hit, an Index row) — reused by all three entry points so
 *  "open this file" behaves identically no matter where it was clicked from. */
async function openFile(relPath) {
  closeDrawer();
  if (mode !== "files") {
    mode = "files";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "files"));
    searchEl.placeholder = currentProfile === "notes" ? "Search..." : "Search code...";
    await loadTree();
  }
  const r = await fetch("/api/file?path=" + encodeURIComponent(relPath));
  if (!r.ok) {
    contentEl.className = "code";
    contentEl.innerHTML = `<p>File not found: ${escapeHtml(relPath)}</p>`;
    pulseContent();
    return;
  }
  const text = await r.text();
  renderEditable(text, (newText) =>
    fetch("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content: newText }),
    }),
    "code"
  );
}

/** Every directory path in the tree, root first, for the create-modal's "Location" picker. */
function flattenDirs(node, out = []) {
  if (node.type === "dir") {
    out.push(node.path);
    for (const c of node.children || []) flattenDirs(c, out);
  }
  return out;
}

const createOverlay = document.getElementById("createModalOverlay");
const createTitle = document.getElementById("createModalTitle");
const createLocation = document.getElementById("createLocation");
const createNameInput = document.getElementById("createName");
const createConfirmBtn = document.getElementById("createConfirm");
const createCancelBtn = document.getElementById("createCancel");
let createKind = "file";

function openCreateModal(kind) {
  createKind = kind;
  createTitle.textContent = kind === "file" ? "New File" : "New Folder";
  createNameInput.placeholder = kind === "file" ? "filename.js" : "folder-name";
  createLocation.innerHTML = "";
  for (const dir of flattenDirs(lastTree || { type: "dir", path: ".", children: [] })) {
    const opt = document.createElement("option");
    opt.value = dir;
    opt.textContent = dir === "." ? "/ (project root)" : dir;
    createLocation.appendChild(opt);
  }
  createNameInput.value = "";
  createOverlay.hidden = false;
  createNameInput.focus();
}

function closeCreateModal() {
  createOverlay.hidden = true;
}

createCancelBtn.onclick = closeCreateModal;
createOverlay.addEventListener("click", (e) => {
  if (e.target === createOverlay) closeCreateModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !createOverlay.hidden) closeCreateModal();
});

createConfirmBtn.onclick = async () => {
  const name = createNameInput.value.trim();
  if (!name) return;
  const location = createLocation.value;
  const relPath = location === "." ? name : location + "/" + name;
  const url = createKind === "file" ? "/api/file/create" : "/api/folder";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, content: "" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not create " + relPath);
    return;
  }
  closeCreateModal();
  loadTree();
};
createNameInput.onkeydown = (e) => {
  if (e.key === "Enter") createConfirmBtn.click();
};

function pathParent(relPath) {
  const i = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  return i === -1 ? "." : relPath.slice(0, i);
}

async function renameEntry(node) {
  const newName = prompt("Rename to:", node.name);
  if (!newName || newName === node.name) return;
  const parent = pathParent(node.path);
  const newPath = parent === "." ? newName : parent + "/" + newName;
  const res = await fetch("/api/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPath: node.path, newPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Rename failed.");
    return;
  }
  loadTree();
}

async function deleteEntry(node) {
  if (!confirm(`Delete "${node.path}"? This cannot be undone.`)) return;
  const res = await fetch("/api/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: node.path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Delete failed.");
    return;
  }
  loadTree();
}

// ponytail: 4 chars/token is the standard rough estimate, not a real tokenizer — good enough for
// "roughly how much context does this project cost", not exact billing.
const CHARS_PER_TOKEN = 4;
const COST_PER_1M_TOKENS = 3; // USD — ballpark input-token rate; adjust for your model of choice.

async function loadIndex() {
  contentEl.className = "code";
  treeEl.innerHTML = "";
  const res = await fetch("/api/index");
  const files = await res.json();
  let totalChars = 0;
  const rows = files
    .map((f) => {
      totalChars += f.chars;
      const tokens = Math.ceil(f.chars / CHARS_PER_TOKEN);
      return `<tr class="node file" data-path="${escapeHtml(f.path)}"><td>${escapeHtml(f.path)}</td><td class="num">${f.lines.toLocaleString()}</td><td class="num">${tokens.toLocaleString()}</td><td class="muted">${new Date(f.mtimeMs).toLocaleString()}</td></tr>`;
    })
    .join("");
  const totalTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  const totalCost = (totalTokens / 1_000_000) * COST_PER_1M_TOKENS;
  contentEl.innerHTML =
    `<table class="index-table"><thead><tr><th>Path</th><th class="num">Lines</th><th class="num">Tokens (est.)</th><th>Indexed</th></tr></thead>` +
    `<tbody>${rows || '<tr><td colspan="4">Nothing indexed yet.</td></tr>'}</tbody>` +
    (files.length
      ? `<tfoot><tr><td>${files.length.toLocaleString()} file${files.length === 1 ? "" : "s"}</td><td></td>` +
        `<td class="num">${totalTokens.toLocaleString()}</td><td class="muted">≈ $${totalCost.toFixed(2)} @ $${COST_PER_1M_TOKENS}/1M</td></tr></tfoot>`
      : "") +
    `</table>`;
  pulseContent();
}

let mcpLogTimer = null;

function stopMcpLogPoll() {
  if (mcpLogTimer) clearInterval(mcpLogTimer);
  mcpLogTimer = null;
}

/** `animate` is false on the periodic auto-refresh so the content-fade only plays once, on first
 *  view of the tab — a live-updating log re-fading every 3s would be scattered motion, not one
 *  authored moment. */
async function loadMcpLog(animate = true) {
  contentEl.className = "code";
  treeEl.innerHTML = "";
  const res = await fetch("/api/mcp-log");
  const entries = await res.json();
  const rows = entries
    .map((e) => {
      const statusClass = e.ok ? "log-status-ok" : "log-status-error";
      const statusText = e.ok ? "ok" : "error" + (e.error ? `: ${escapeHtml(e.error)}` : "");
      return (
        `<tr><td class="muted">${new Date(e.ts).toLocaleTimeString()}</td><td class="muted">${escapeHtml(e.tool)}</td>` +
        `<td class="log-args" title="${escapeHtml(e.args)}">${escapeHtml(e.args)}</td>` +
        `<td class="${statusClass}">${statusText}</td><td class="num">${e.durationMs}ms</td></tr>`
      );
    })
    .join("");
  contentEl.innerHTML =
    `<table class="index-table"><thead><tr><th>Time</th><th>Tool</th><th>Args</th><th>Status</th><th class="num">Duration</th></tr></thead>` +
    `<tbody>${rows || '<tr><td colspan="5">No MCP calls recorded yet — the AI hasn’t used this project through MCP.</td></tr>'}</tbody></table>`;
  if (animate) pulseContent();
}

/** Minimal markdown -> HTML: headings, bold/italic, code, lists, links, [[wikilinks]]. */
function mdToHtml(md) {
  let html = escapeHtml(md);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
  html = html.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) =>
    `<a href="#" class="wikilink" data-doc="${target.trim()}">${(label || target).trim()}</a>`);
  html = html
    .replace(/^######\s+(.*)$/gm, "<h6>$1</h6>")
    .replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>")
    .replace(/^####\s+(.*)$/gm, "<h4>$1</h4>")
    .replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.*)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(?:^|\n)((?:[-*]\s+.*(?:\n|$))+)/g, (block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("");
    return `\n<ul>${items}</ul>\n`;
  });
  html = html.split(/\n{2,}/).map((block) => {
    if (/^\s*<(h\d|ul|pre)/.test(block)) return block;
    return block.trim() ? `<p>${block.trim().replace(/\n/g, "<br>")}</p>` : "";
  }).join("\n");
  return html;
}

/** Renders `rawText` read-only with an Edit button; Edit swaps in a textarea with Save/Cancel that calls `onSave`. */
function renderEditable(rawText, onSave, className, emptyPlaceholder) {
  contentEl.className = className;
  contentEl.innerHTML = "";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const view = document.createElement("div");
  view.className = "view";
  contentEl.appendChild(toolbar);
  contentEl.appendChild(view);

  function showView(text) {
    view.innerHTML = "";
    if (!text && emptyPlaceholder) {
      const p = document.createElement("p");
      p.style.color = "var(--muted)";
      p.textContent = emptyPlaceholder;
      view.appendChild(p);
    } else if (className === "doc") {
      view.innerHTML = mdToHtml(text);
    } else {
      const div = document.createElement("div");
      div.textContent = text;
      view.appendChild(div);
    }
  }

  function showReadButtons() {
    toolbar.innerHTML = "";
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.onclick = showEditor;
    toolbar.appendChild(editBtn);
  }

  function showEditor() {
    toolbar.innerHTML = "";
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    toolbar.appendChild(saveBtn);
    toolbar.appendChild(cancelBtn);
    view.innerHTML = "";
    const textarea = document.createElement("textarea");
    textarea.className = "editor";
    textarea.value = rawText;
    view.appendChild(textarea);
    textarea.focus();
    saveBtn.onclick = async () => {
      rawText = textarea.value;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      await onSave(rawText);
      showReadButtons();
      showView(rawText);
      view.classList.remove("saved-flash");
      void view.offsetWidth;
      view.classList.add("saved-flash");
    };
    cancelBtn.onclick = () => {
      showReadButtons();
      showView(rawText);
    };
  }

  showReadButtons();
  showView(rawText);
  pulseContent();
}

function resolveDocName(name) {
  const key = name.trim().toLowerCase();
  const hit = docsCache.find((d) => d.replace(/\.md$/i, "").toLowerCase() === key || d.toLowerCase() === key);
  return hit || (name.endsWith(".md") ? name : name + ".md");
}

async function openDoc(relPath) {
  if (mode !== "docs") {
    mode = "docs";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "docs"));
    await loadDocsList();
  }
  currentDoc = relPath;
  const r = await fetch("/api/doc?path=" + encodeURIComponent(relPath));
  if (!r.ok) {
    contentEl.className = "doc";
    contentEl.innerHTML = `<p>Doc not found: ${relPath}</p>`;
    pulseContent();
    return;
  }
  const text = await r.text();
  renderEditable(text, (newText) =>
    fetch("/api/doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content: newText }),
    }),
    "doc"
  );
}

function renderCreateDocBar() {
  const bar = document.createElement("div");
  bar.className = "toolbar";
  const docBtn = document.createElement("button");
  docBtn.textContent = "+ Doc";
  docBtn.onclick = createDoc;
  bar.appendChild(docBtn);
  return bar;
}

async function createDoc() {
  const name = prompt("New doc path (e.g. notes.md, or folder/notes.md):");
  if (!name) return;
  const path = name.trim().endsWith(".md") ? name.trim() : name.trim() + ".md";
  const res = await fetch("/api/doc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content: "" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Could not create " + path);
    return;
  }
  await loadDocsList();
  openDoc(path);
}

async function deleteDocEntry(path) {
  if (!confirm(`Delete "${path}"? This cannot be undone.`)) return;
  const res = await fetch("/api/doc?path=" + encodeURIComponent(path), { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Delete failed.");
    return;
  }
  if (currentDoc === path) currentDoc = null;
  await loadDocsList();
}

async function renameDocEntry(path) {
  const newPath = prompt("Rename to:", path);
  if (!newPath || newPath === path) return;
  const res = await fetch("/api/doc/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPath: path, newPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Rename failed.");
    return;
  }
  if (currentDoc === path) currentDoc = newPath;
  await loadDocsList();
}

async function loadDocsList() {
  contentEl.className = "doc";
  currentDoc = null;
  const res = await fetch("/api/docs");
  docsCache = await res.json();
  treeEl.innerHTML = "";
  treeEl.appendChild(renderCreateDocBar());
  const ul = document.createElement("ul");
  for (const d of docsCache) {
    const li = document.createElement("li");
    li.className = "node file";
    const label = document.createElement("span");
    label.className = "node-label";
    label.textContent = d;
    li.appendChild(label);
    const actions = document.createElement("span");
    actions.className = "node-actions";
    const renameBtn = document.createElement("button");
    renameBtn.textContent = "Ren";
    renameBtn.setAttribute("aria-label", "Rename " + d);
    renameBtn.onclick = (e) => { e.stopPropagation(); renameDocEntry(d); };
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Del";
    deleteBtn.setAttribute("aria-label", "Delete " + d);
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteDocEntry(d); };
    actions.append(renameBtn, deleteBtn);
    li.appendChild(actions);
    makeRowInteractive(label, () => { closeDrawer(); openDoc(d); });
    ul.appendChild(li);
  }
  treeEl.appendChild(ul);
}

const FIXED_DOCS = {
  memory: { path: "memory.md", placeholder: "Empty. Click Edit to write notes the AI should always keep in mind for this project." },
  style: { path: "style-guide.md", placeholder: "Empty. Click Edit to write the design/style reference the AI should follow when producing graphics or UI." },
};

async function loadFixedDoc(key) {
  const { path: relPath, placeholder } = FIXED_DOCS[key];
  treeEl.innerHTML = "";
  const r = await fetch("/api/doc?path=" + encodeURIComponent(relPath));
  const text = r.ok ? await r.text() : "";
  renderEditable(text, (newText) =>
    fetch("/api/doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content: newText }),
    }),
    "doc",
    placeholder
  );
}

contentEl.addEventListener("click", (e) => {
  const wikilink = e.target.closest(".wikilink");
  if (wikilink) {
    e.preventDefault();
    openDoc(resolveDocName(wikilink.dataset.doc));
    return;
  }
  const hit = e.target.closest("[data-path]");
  if (hit) {
    e.preventDefault();
    openFile(hit.dataset.path);
  }
});

function makeRowInteractive(row, onActivate) {
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.onclick = onActivate;
  row.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  };
}

function renderNode(node, depth) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "node " + node.type;
  row.style.paddingLeft = depth * 14 + "px";

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = node.name;
  row.appendChild(label);

  if (node.path !== ".") {
    const actions = document.createElement("span");
    actions.className = "node-actions";
    const renameBtn = document.createElement("button");
    renameBtn.textContent = "Ren";
    renameBtn.setAttribute("aria-label", "Rename " + node.name);
    renameBtn.onclick = (e) => { e.stopPropagation(); renameEntry(node); };
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Del";
    deleteBtn.setAttribute("aria-label", "Delete " + node.name);
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteEntry(node); };
    actions.append(renameBtn, deleteBtn);
    row.appendChild(actions);
  }
  wrap.appendChild(row);

  if (node.type === "file") {
    makeRowInteractive(label, () => openFile(node.path));
  } else {
    let open = false;
    const childBox = document.createElement("div");
    childBox.className = "children";
    const inner = document.createElement("div");
    inner.className = "children-inner";
    childBox.appendChild(inner);
    label.setAttribute("aria-expanded", "false");
    makeRowInteractive(label, () => {
      open = !open;
      childBox.classList.toggle("open", open);
      label.setAttribute("aria-expanded", String(open));
      if (open && inner.childElementCount === 0 && node.children) {
        for (const c of node.children) inner.appendChild(renderNode(c, depth + 1));
      }
    });
    wrap.appendChild(childBox);
  }
  return wrap;
}

// ponytail: hand-rolled force layout (repulsion + spring edges), no graph lib — swap for d3-force if graphs get large
function initGraph(canvas, data) {
  const W = (canvas.width = canvas.clientWidth);
  const H = (canvas.height = canvas.clientHeight);
  const nodes = data.nodes.map((n) => ({ ...n, x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0 }));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = data.edges
    .map((e) => ({ a: idx.get(e.source), b: idx.get(e.target) }))
    .filter((e) => e.a !== undefined && e.b !== undefined);
  return { canvas, W, H, nodes, edges, dragging: null };
}

function stepGraph(g) {
  const { nodes, edges, W, H } = g;
  for (const n of nodes) {
    n.vx *= 0.9;
    n.vy *= 0.9;
    for (const m of nodes) {
      if (m === n) continue;
      const dx = n.x - m.x, dy = n.y - m.y;
      const d2 = dx * dx + dy * dy || 0.01;
      const f = 900 / d2;
      n.vx += (dx * f) / Math.sqrt(d2);
      n.vy += (dy * f) / Math.sqrt(d2);
    }
    n.vx += (W / 2 - n.x) * 0.001;
    n.vy += (H / 2 - n.y) * 0.001;
  }
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - 110) * 0.02;
    a.vx += (dx / d) * f;
    a.vy += (dy / d) * f;
    b.vx -= (dx / d) * f;
    b.vy -= (dy / d) * f;
  }
  for (const n of nodes) {
    if (n === g.dragging) continue;
    n.x = Math.max(20, Math.min(W - 20, n.x + n.vx));
    n.y = Math.max(20, Math.min(H - 20, n.y + n.vy));
  }
}

function drawGraph(g) {
  const ctx = g.canvas.getContext("2d");
  ctx.clearRect(0, 0, g.W, g.H);
  ctx.strokeStyle = "#1f4d2b";
  for (const e of g.edges) {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const n of g.nodes) {
    const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 14);
    glow.addColorStop(0, "rgba(140,255,107,0.35)");
    glow.addColorStop(1, "rgba(140,255,107,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 14, 0, Math.PI * 2);
    ctx.fill();

    const sphere = ctx.createRadialGradient(n.x - 2.5, n.y - 2.5, 0.5, n.x, n.y, 8);
    sphere.addColorStop(0, "#e3ffd9");
    sphere.addColorStop(0.5, "#8cff6b");
    sphere.addColorStop(1, "#2f8f3f");
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#eafbe9";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(n.title, n.x + 13, n.y + 4);
  }
}

function nodeAt(g, mx, my) {
  return g.nodes.find((n) => Math.hypot(n.x - mx, n.y - my) < 9);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadGraph() {
  contentEl.className = "graph";
  treeEl.innerHTML = "";
  contentEl.innerHTML =
    '<div class="toolbar" style="position:absolute;right:20px;top:20px;z-index:1;">' +
    '<button id="exportGraphPng">Export PNG</button>' +
    '<button id="exportGraphJson">Export JSON</button>' +
    '</div><canvas id="graphCanvas" style="width:100%;height:100%;"></canvas>';
  const canvas = document.getElementById("graphCanvas");
  const res = await fetch("/api/docs/graph");
  const data = await res.json();
  if (data.nodes.length === 0) {
    contentEl.innerHTML = "<p style='padding:16px'>No documentation yet. The AI writes it with write_doc.</p>";
    pulseContent();
    return;
  }
  document.getElementById("exportGraphPng").onclick = () =>
    canvas.toBlob((blob) => downloadBlob("docs-graph.png", blob));
  document.getElementById("exportGraphJson").onclick = () =>
    downloadBlob("docs-graph.json", new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  pulseContent();
  const g = initGraph(canvas, data);
  let dragMoved = false;
  canvas.onpointerdown = (e) => {
    const r = canvas.getBoundingClientRect();
    g.dragging = nodeAt(g, e.clientX - r.left, e.clientY - r.top) || null;
    dragMoved = false;
    if (g.dragging) canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!g.dragging) return;
    const r = canvas.getBoundingClientRect();
    g.dragging.x = e.clientX - r.left;
    g.dragging.y = e.clientY - r.top;
    dragMoved = true;
  };
  const releaseDrag = () => { g.dragging = null; };
  canvas.onpointerup = releaseDrag;
  canvas.onpointercancel = releaseDrag;
  canvas.onclick = (e) => {
    if (dragMoved) return;
    const r = canvas.getBoundingClientRect();
    const hit = nodeAt(g, e.clientX - r.left, e.clientY - r.top);
    if (hit) openDoc(hit.id);
  };
  stopGraph();
  (function tick() {
    stepGraph(g);
    drawGraph(g);
    graphRAF = requestAnimationFrame(tick);
  })();
}

function activateTab(tab, { focus = false } = {}) {
  tabEls.forEach((t) => {
    const active = t === tab;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
  });
  if (focus) tab.focus();
  mode = tab.dataset.tab;
  searchEl.placeholder = mode === "docs" || mode === "memory" || mode === "style" ? "Search docs..." : currentProfile === "notes" ? "Search..." : "Search code...";
  stopGraph();
  stopMcpLogPoll();
  contentEl.innerHTML = "";
  if (mode === "files") loadTree();
  else if (mode === "docs") loadDocsList();
  else if (mode === "memory") loadFixedDoc("memory");
  else if (mode === "style") loadFixedDoc("style");
  else if (mode === "index") loadIndex();
  else if (mode === "mcp") {
    loadMcpLog();
    mcpLogTimer = setInterval(() => loadMcpLog(false), 3000);
  } else loadGraph();
}

function wireTabs() {
  tabEls = Array.from(document.querySelectorAll(".tab"));
  tabEls.forEach((tab, i) => {
    tab.onclick = () => activateTab(tab);
    tab.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateTab(tab);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = tabEls[(i + (e.key === "ArrowRight" ? 1 : -1) + tabEls.length) % tabEls.length];
        activateTab(next, { focus: true });
      }
    };
  });
}

searchEl.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" || !searchEl.value.trim()) return;
  if (mode === "docs" || mode === "memory" || mode === "style") {
    const res = await fetch("/api/docs/search?q=" + encodeURIComponent(searchEl.value));
    const hits = await res.json();
    mode = "docs";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "docs"));
    treeEl.innerHTML = "";
    contentEl.className = "doc";
    contentEl.innerHTML = hits.length
      ? hits.map((h) => `<p><a href="#" class="wikilink" data-doc="${h.doc}">${h.doc}:${h.line}</a> — ${h.text.replace(/</g, "&lt;")}</p>`).join("")
      : "<p>No results.</p>";
    pulseContent();
    return;
  }
  const res = await fetch("/api/search?q=" + encodeURIComponent(searchEl.value));
  const hits = await res.json();
  contentEl.className = "code";
  contentEl.innerHTML = hits.length
    ? hits.map((h) => `<p><a href="#" data-path="${escapeHtml(h.path)}">${escapeHtml(h.path)}:${h.line}</a>: ${escapeHtml(h.text)}</p>`).join("")
    : "<p>No results.</p>";
  pulseContent();
});

const events = new EventSource("/api/events");
events.onmessage = async () => {
  if (mode === "docs") {
    const openPath = currentDoc;
    await loadDocsList();
    if (openPath) await openDoc(openPath);
  } else if (mode === "memory") {
    loadFixedDoc("memory");
  } else if (mode === "style") {
    loadFixedDoc("style");
  } else if (mode === "graph") {
    loadGraph();
  }
};

// Sets the accent/light-blob recolor (CSS, see body[data-profile="notes"]), the icon (favicon +
// header brand mark), the "<Type> - <project>" label, which dev-only tabs are even shown, and
// which tab opens by default — everything that tells apart the "dev" and "notes" profiles, and
// which project a given BrAIn is actually pointed at. Tabs are built (wireTabs) only after this
// profile-driven DOM trimming, so a hidden tab is never in tabEls to begin with.
async function init() {
  let profile = "dev";
  let projectName = "";
  try {
    ({ profile, projectName } = await (await fetch("/api/profile")).json());
  } catch {
    // API not reachable yet at first paint — stays on the default ("dev") look, unlabeled
  }
  currentProfile = profile;

  const typeLabel = profile === "notes" ? "Notes" : "Dev";
  if (profile === "notes") {
    document.body.dataset.profile = profile;
    document.getElementById("favicon").href = "favicon-notes.svg";
    document.getElementById("brandMark").src = "favicon-notes.svg";
    // Index (search-index internals) and MCP (AI tool-call log) are debugging views for a
    // codebase — noise on a notes project. Still reachable by switching back to dev if wanted:
    // `brain --mode http --profile dev`.
    document.querySelector('.tab[data-tab="index"]')?.remove();
    document.querySelector('.tab[data-tab="mcp"]')?.remove();
  }
  document.title = `BrAIn ${typeLabel}${projectName ? " - " + projectName : ""}`;
  document.getElementById("brandLabel").textContent = projectName ? `${typeLabel} - ${projectName}` : typeLabel;

  wireTabs();
  if (profile === "notes") {
    // Docs is where a notes project's actual content lives — a better landing tab than Files.
    activateTab(document.querySelector('.tab[data-tab="docs"]'));
  } else {
    loadTree();
  }
}
init();
