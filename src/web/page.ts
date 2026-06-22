/** The single-page web UI (stdlib + vanilla JS, served by the Hono server). */
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
  header { padding: 12px 16px; border-bottom: 1px solid #21262d; font-weight: 600; color: #58a6ff; }
  #log { flex: 1; overflow-y: auto; padding: 16px; }
  .line { white-space: pre-wrap; word-break: break-word; margin: 2px 0; }
  .user { color: #e6edf3; border-left: 2px solid #58a6ff; padding-left: 8px; margin: 12px 0 6px; }
  .step { color: #58a6ff; font-weight: 600; margin-top: 8px; }
  .tool { color: #8b949e; }
  .ok { color: #3fb950; }
  .err { color: #f85149; }
  .dim { color: #6e7681; }
  .answer { color: #e6edf3; margin-top: 6px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #21262d; }
  input { flex: 1; background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
          border-radius: 6px; padding: 8px 10px; font: inherit; }
  button { background: #238636; border: 0; color: #fff; border-radius: 6px; padding: 8px 16px;
           font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<header>Caduceus</header>
<div id="log"></div>
<form id="f">
  <input id="t" placeholder="Ask the agent to do something…" autocomplete="off" autofocus />
  <button id="b">Run</button>
</form>
<script>
  const log = document.getElementById("log");
  const form = document.getElementById("f");
  const input = document.getElementById("t");
  const button = document.getElementById("b");
  let es;

  function line(cls, text) {
    const el = document.createElement("div");
    el.className = "line " + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const task = input.value.trim();
    if (!task) return;
    input.value = "";
    button.disabled = true;
    line("user", task);
    if (es) es.close();
    let answer = null;
    es = new EventSource("/api/run?task=" + encodeURIComponent(task));
    es.addEventListener("step", (ev) => line("step", "▸ step " + JSON.parse(ev.data).n));
    es.addEventListener("tool_call", (ev) => {
      const s = JSON.parse(ev.data);
      line("tool", "→ " + s.call.name + "(" + JSON.stringify(s.call.arguments) + ")");
    });
    es.addEventListener("tool_result", (ev) => {
      const s = JSON.parse(ev.data);
      line(s.isError ? "err" : "ok", (s.isError ? "✗ " : "✓ ") + s.name);
    });
    es.addEventListener("compress", (ev) => line("dim", "~ compressed " + JSON.parse(ev.data).tool));
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
    });
    es.addEventListener("error", (ev) => {
      line("err", "error: " + (ev.data || "stream closed"));
      es.close();
      button.disabled = false;
    });
  };
</script>
</body>
</html>`;
