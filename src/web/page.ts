/** The single-page web UI (stdlib + vanilla JS): multi-turn chat with sessions. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Caduceus</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0d1117; color: #c9d1d9; display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #21262d; }
  header .brand { font-weight: 600; color: #58a6ff; margin-right: auto; }
  select, header button { background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
          border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; }
  #log { flex: 1; overflow-y: auto; padding: 16px; }
  .line { white-space: pre-wrap; word-break: break-word; margin: 2px 0; }
  .user { color: #e6edf3; border-left: 2px solid #58a6ff; padding-left: 8px; margin: 14px 0 6px; }
  .step { color: #58a6ff; font-weight: 600; margin-top: 8px; }
  .tool { color: #8b949e; }
  .ok { color: #3fb950; }
  .err { color: #f85149; }
  .dim { color: #6e7681; }
  .answer { color: #e6edf3; margin-top: 6px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #21262d; }
  input { flex: 1; background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
          border-radius: 6px; padding: 8px 10px; font: inherit; }
  form button { background: #238636; border: 0; color: #fff; border-radius: 6px; padding: 8px 16px;
           font: inherit; cursor: pointer; }
  form button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<header>
  <span class="brand">Caduceus</span>
  <select id="sessions" title="Resume a session"><option value="">— sessions —</option></select>
  <button id="new">New chat</button>
</header>
<div id="log"></div>
<form id="f">
  <input id="t" placeholder="Ask the agent…" autocomplete="off" autofocus />
  <button id="b">Run</button>
</form>
<script>
  const log = document.getElementById("log");
  const form = document.getElementById("f");
  const input = document.getElementById("t");
  const button = document.getElementById("b");
  const sessions = document.getElementById("sessions");
  let current = "";
  let es;

  function line(cls, text) {
    const el = document.createElement("div");
    el.className = "line " + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function refreshSessions() {
    const list = await (await fetch("/api/sessions")).json();
    sessions.innerHTML = '<option value="">— sessions —</option>' +
      list.map((s) => '<option value="' + s.id + '">' + s.title.replace(/</g, "&lt;") + "</option>").join("");
    sessions.value = current;
  }

  async function resume(id) {
    const data = await (await fetch("/api/session/" + id)).json();
    log.innerHTML = "";
    current = id;
    for (const m of data.messages) line(m.role === "user" ? "user" : "answer", (m.role === "user" ? "❯ " : "") + m.content);
  }

  document.getElementById("new").onclick = () => { current = ""; log.innerHTML = ""; sessions.value = ""; input.focus(); };
  sessions.onchange = () => { if (sessions.value) resume(sessions.value); };

  form.onsubmit = (e) => {
    e.preventDefault();
    const task = input.value.trim();
    if (!task) return;
    input.value = "";
    button.disabled = true;
    line("user", "❯ " + task);
    if (es) es.close();
    let answer = null;
    es = new EventSource("/api/run?session=" + encodeURIComponent(current) + "&task=" + encodeURIComponent(task));
    es.addEventListener("session", (ev) => { current = ev.data; });
    es.addEventListener("step", (ev) => line("step", "▸ step " + JSON.parse(ev.data).n));
    es.addEventListener("tool_call", (ev) => {
      const s = JSON.parse(ev.data);
      line("tool", "→ " + s.call.name + "(" + JSON.stringify(s.call.arguments) + ")");
    });
    es.addEventListener("tool_result", (ev) => {
      const s = JSON.parse(ev.data);
      line(s.isError ? "err" : "ok", (s.isError ? "✗ " : "✓ ") + s.name);
    });
    es.addEventListener("token", (ev) => {
      if (!answer) answer = line("answer", "");
      answer.textContent += ev.data;
      log.scrollTop = log.scrollHeight;
    });
    es.addEventListener("done", (ev) => {
      const s = JSON.parse(ev.data);
      if (!answer && s.finalText) line("answer", s.finalText);
      line("dim", "(" + s.stopReason + ", " + s.steps + " steps)");
      es.close();
      button.disabled = false;
      refreshSessions();
    });
    es.addEventListener("error", (ev) => {
      line("err", "error: " + (ev.data || "stream closed"));
      es.close();
      button.disabled = false;
    });
  };

  refreshSessions();
</script>
</body>
</html>`;
