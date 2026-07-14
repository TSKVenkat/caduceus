/** Single-page web UI: multi-turn chat with sessions, stats dashboard, and real-time streaming. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Caduceus</title>
<style>
:root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --text2: #8b949e;
  --blue: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff; }
* { box-sizing: border-box; margin: 0; }
body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background: var(--bg); color: var(--text); display: flex; height: 100vh; }
aside { width: 260px; background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden; }
aside header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
aside header .brand { font-weight: 700; font-size: 16px; color: var(--blue); }
aside header button { background: var(--blue); border: 0; color: #fff; border-radius: 6px; padding: 4px 10px;
  font: inherit; cursor: pointer; font-size: 12px; }
.stats-bar { padding: 8px 16px; border-bottom: 1px solid var(--border); display: grid;
  grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; color: var(--text2); }
.stats-bar span { color: var(--text); font-weight: 600; }
#session-list { flex: 1; overflow-y: auto; }
#session-list .item { padding: 10px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
#session-list .item:hover { background: #1c2128; }
#session-list .item.active { background: #1c2128; border-left: 3px solid var(--blue); }
#session-list .item .title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#session-list .item .meta { font-size: 11px; color: var(--text2); margin-top: 2px; }
main { flex: 1; display: flex; flex-direction: column; }
main > header { padding: 10px 16px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px; }
main > header .model { font-size: 12px; color: var(--text2); background: var(--surface);
  padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); }
#log { flex: 1; overflow-y: auto; padding: 16px; }
.line { white-space: pre-wrap; word-break: break-word; margin: 4px 0; font-family: inherit; }
.user { color: #e6edf3; border-left: 3px solid var(--blue); padding-left: 10px; margin: 16px 0 8px; }
.step { color: var(--blue); font-weight: 600; margin-top: 10px; }
.tool { color: var(--text2); }
.ok { color: var(--green); }
.err { color: var(--red); }
.dim { color: var(--text2); }
.answer { color: #e6edf3; margin-top: 8px; }
.answer code, .line code { background: var(--surface); padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.answer pre { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin: 8px 0; overflow-x: auto; }
.answer pre code { background: none; padding: 0; }
form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
input { flex: 1; background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 10px 12px; font: inherit; }
input:focus { outline: none; border-color: var(--blue); }
form button { background: #238636; border: 0; color: #fff; border-radius: 6px; padding: 10px 20px;
  font: inherit; cursor: pointer; font-weight: 600; }
form button:disabled { opacity: .5; cursor: default; }
.empty { text-align: center; color: var(--text2); margin-top: 40vh; }
</style>
</head>
<body>
<aside>
  <header>
    <span class="brand">Caduceus</span>
    <button id="new">+ New</button>
  </header>
  <div class="stats-bar">
    <div>Requests: <span id="stat-req">0</span></div>
    <div>Active: <span id="stat-active">0</span></div>
    <div>Sessions: <span id="stat-sessions">0</span></div>
    <div>Uptime: <span id="stat-uptime">—</span></div>
  </div>
  <div id="session-list"></div>
</aside>
<main>
  <header>
    <div style="flex:1"></div>
    <span class="model" id="model-badge"></span>
  </header>
  <div id="log">
    <div class="empty">Send a message to start a conversation</div>
  </div>
  <form id="f">
    <input id="t" placeholder="Ask the agent..." autocomplete="off" autofocus />
    <button id="b">Run</button>
  </form>
</main>
<script>
const log = document.getElementById("log");
const form = document.getElementById("f");
const input = document.getElementById("t");
const button = document.getElementById("b");
const sessionList = document.getElementById("session-list");
let current = "";
let es;

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function renderMd(text) {
  let h = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  h = h.replace(/\x60\x60\x60([\\s\\S]*?)\x60\x60\x60/g,"<pre><code>$1</code></pre>");
  h = h.replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>");
  h = h.replace(/\n/g,"<br>");
  return h;
}

function line(cls, text) {
  const el = document.createElement("div");
  el.className = "line " + cls;
  if (cls === "answer") el.innerHTML = renderMd(text);
  else el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function refreshSessions() {
  const list = await (await fetch("/api/sessions")).json();
  sessionList.innerHTML = list.map(s =>
    '<div class="item' + (s.id === current ? ' active' : '') + '" data-id="' + s.id + '">' +
    '<div class="title">' + esc(s.title) + '</div>' +
    '<div class="meta">' + s.messages + ' msgs \u00B7 ' + new Date(s.updated).toLocaleTimeString() + '</div>' +
    '</div>'
  ).join("");
  sessionList.querySelectorAll(".item").forEach(el => {
    el.onclick = () => resume(el.dataset.id);
  });
  document.getElementById("stat-sessions").textContent = list.length;
}

async function resume(id) {
  const data = await (await fetch("/api/session/" + id)).json();
  log.innerHTML = "";
  current = id;
  for (const m of data.messages) {
    line(m.role === "user" ? "user" : "answer", m.role === "user" ? m.content : m.content);
  }
  await refreshSessions();
}

document.getElementById("new").onclick = () => { current = ""; log.innerHTML = '<div class="empty">Send a message to start a conversation</div>'; refreshSessions(); input.focus(); };

async function loadStats() {
  try {
    const s = await (await fetch("/api/stats")).json();
    document.getElementById("stat-req").textContent = s.totalRequests;
    document.getElementById("stat-active").textContent = s.activeConversations;
    const mins = Math.floor(s.uptime / 60000);
    document.getElementById("stat-uptime").textContent = mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h " + (mins % 60) + "m";
  } catch {}
}

async function loadModel() {
  try {
    const models = await (await fetch("/api/models")).json();
    document.getElementById("model-badge").textContent = models[0]?.id || "?";
  } catch {}
}

form.onsubmit = (e) => {
  e.preventDefault();
  const task = input.value.trim();
  if (!task) return;
  input.value = "";
  button.disabled = true;
  log.innerHTML = "";
  line("user", task);
  if (es) es.close();
  let answer = null;
  es = new EventSource("/api/run?session=" + encodeURIComponent(current) + "&task=" + encodeURIComponent(task));
  es.addEventListener("session", (ev) => { current = ev.data; });
  es.addEventListener("step", (ev) => line("step", "\u25B8 step " + JSON.parse(ev.data).n));
  es.addEventListener("tool_call", (ev) => {
    const s = JSON.parse(ev.data);
    line("tool", "\u2192 " + s.call.name + "(" + JSON.stringify(s.call.arguments).slice(0, 120) + ")");
  });
  es.addEventListener("tool_result", (ev) => {
    const s = JSON.parse(ev.data);
    line(s.isError ? "err" : "ok", (s.isError ? "\u2717 " : "\u2713 ") + s.name);
  });
  es.addEventListener("token", (ev) => {
    if (!answer) answer = line("answer", "");
    answer.innerHTML = renderMd(answer.textContent + ev.data);
    log.scrollTop = log.scrollHeight;
  });
  es.addEventListener("done", (ev) => {
    const s = JSON.parse(ev.data);
    if (!answer && s.finalText) line("answer", s.finalText);
    line("dim", "(" + s.stopReason + ", " + s.steps + " steps)");
    es.close();
    button.disabled = false;
    refreshSessions();
    loadStats();
  });
  es.addEventListener("error", (ev) => {
    line("err", "error: " + (ev.data || "stream closed"));
    es.close();
    button.disabled = false;
  });
};

loadModel();
refreshSessions();
loadStats();
setInterval(loadStats, 30000);
</script>
</body>
</html>`;