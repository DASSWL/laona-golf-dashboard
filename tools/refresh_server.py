#!/usr/bin/env python3
"""Local refresh service for the 老那高尔夫 dashboard.

Run:  python3 tools/refresh_server.py
It listens on http://127.0.0.1:8765 (this computer only). The site's 「刷新数据」 button opens /run here,
which pulls fresh data from YouTube, pushes it to GitHub, waits until GitHub Pages serves it, then
sends the browser back to the site.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST, PORT = "127.0.0.1", 8765
SITE = "https://dasswl.github.io/laona-golf-dashboard/"
COOLDOWN = 60  # seconds between two refreshes
DATA_FILES = ["data/channel.json", "data/videos.json", "data/comments.json"]
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
SITE_ORIGIN = "https://dasswl.github.io"
SITE_PATHS = {"/laona-golf-dashboard/", "/laona-golf-dashboard/index.html"}

state = {"running": False, "step": "", "error": None, "fetchedAt": None, "finished": 0.0}
lock = threading.Lock()


def api_key():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("YOUTUBE_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return None


def redact(text):
    for key in (api_key(), os.environ.get("YOUTUBE_API_KEY")):
        if key:
            text = text.replace(key, "***")
    return text


GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}


def sh(*cmd, timeout=600):
    # stdin closed and prompts disabled, so a missing credential fails fast instead of hanging.
    return subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True, timeout=timeout,
                          stdin=subprocess.DEVNULL, env=GIT_ENV)


def live_fetched_at():
    with urllib.request.urlopen(f"{SITE}data/channel.json?v={time.time()}", timeout=15) as r:
        return json.load(r)[0]["fetchedAt"]


def refresh():
    try:
        state["step"] = "从 YouTube 拉取最新数据"
        sh(sys.executable, "tools/fetch_channel.py")
        state["step"] = "整理仪表盘数据"
        sh(sys.executable, "tools/build_site_data.py")
        fetched = json.loads((ROOT / "data" / "channel.json").read_text())[0]["fetchedAt"]
        state["step"] = "推送到 GitHub"
        # Only the three data files are ever committed, whatever else is staged.
        sh("git", "add", "--", *DATA_FILES)
        if subprocess.run(["git", "diff", "--cached", "--quiet", "--", *DATA_FILES], cwd=ROOT).returncode:
            sh("git", "commit", "-m", f"Refresh data {fetched}", "--", *DATA_FILES)
        sh("git", "pull", "--rebase", "--autostash", "origin", "main", timeout=120)
        sh("git", "push", "origin", "HEAD:main", timeout=120)
        state["step"] = "等待网站更新（通常一两分钟）"
        deadline, last = time.time() + 240, None
        while True:
            try:
                if live_fetched_at() == fetched:
                    break
            except Exception as e:  # noqa: BLE001 — keep the last reason for the message below
                last = e
            if time.time() > deadline:
                raise RuntimeError("数据已经推送，但 GitHub Pages 4 分钟内还没更新，稍后再打开网站即可。"
                                   + (f"（最后一次检查：{last}）" if last else ""))
            time.sleep(5)
        state.update(step="完成", fetchedAt=fetched)
        state["finished"] = time.time()  # the cooldown only follows a successful refresh
    except subprocess.CalledProcessError as e:
        state["error"] = redact(((e.stderr or "") + (e.stdout or "")).strip() or str(e))[-600:]
    except subprocess.TimeoutExpired as e:
        state["error"] = f"命令超时：{' '.join(map(str, e.cmd))}"
    except Exception as e:  # noqa: BLE001
        state["error"] = redact(str(e))[-600:]
    finally:
        with lock:
            state["running"] = False


def safe_next(url):
    """Only ever send the browser back to the dashboard itself (or a local preview of it)."""
    if any(c in url for c in "\\@<>\"'`") or any(ord(c) < 33 for c in url):
        return False
    u = urllib.parse.urlsplit(url)
    if u.query or u.fragment:
        return False
    if u.scheme == "https" and u.netloc == "dasswl.github.io":
        return u.path in SITE_PATHS
    return u.scheme == "http" and bool(re.fullmatch(r"(127\.0\.0\.1|localhost)(:\d{1,5})?", u.netloc)) and u.path in ("/", "/index.html")


def from_dashboard(referer):
    """True when the browser arrived from the dashboard's own button (it sends its URL as the referrer)."""
    if not referer:
        return False
    u = urllib.parse.urlsplit(referer)
    origin = f"{u.scheme}://{u.netloc}"
    if origin == SITE_ORIGIN:
        return u.path in SITE_PATHS
    return u.scheme == "http" and bool(re.fullmatch(r"(127\.0\.0\.1|localhost)(:\d{1,5})?", u.netloc)) and u.netloc not in ALLOWED_HOSTS


PAGE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>刷新老那高尔夫数据</title>
<style>
:root { color-scheme: light; --bg: #f5f7f3; --panel: #fff; --fg: #1b211c; --muted: #5b655d; --line: #e1e6df; --ok: #1d7533; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --bg: #111411; --panel: #191d1a; --fg: #e6eae4; --muted: #9aa49b; --line: #2b312c; --ok: #63c681; --bad: #f2806f; } }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif; padding: 16px; box-sizing: border-box; }
.card { width: min(440px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 28px; display: grid; gap: 14px; }
h1 { margin: 0; font-size: 20px; font-weight: 600; }
.step { display: flex; align-items: center; gap: 10px; }
.spin { width: 16px; height: 16px; border: 2px solid var(--ok); border-right-color: transparent; border-radius: 50%; animation: s 0.8s linear infinite; flex: none; }
@keyframes s { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.muted { color: var(--muted); font-size: 13px; }
.err { color: var(--bad); white-space: pre-wrap; font-size: 13px; }
a, button { color: var(--ok); font: inherit; }
button { background: none; border: 1px solid var(--ok); border-radius: 999px; padding: 4px 14px; cursor: pointer; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
</style></head>
<body><main class="card">
<h1>正在刷新老那高尔夫的数据</h1>
<div class="step"><span class="spin" id="spin"></span><span id="step">准备中</span></div>
<p class="muted" id="time">已用时 0 秒 · 完成后会自动回到仪表盘</p>
<div class="row" id="confirm" hidden><button type="button" id="go">开始刷新</button><span class="muted">这个页面不是从仪表盘打开的，确认后再刷新。</span></div>
<p class="err" id="err" hidden></p>
<div class="row" id="actions" hidden><button type="button" id="retry">再试一次</button><a id="back" href="#">返回仪表盘</a></div>
</main>
<script>
const next = __NEXT__;
const auto = __AUTO__;
const $ = (s) => document.querySelector(s);
$('#back').href = next;
const t0 = Date.now();
const tick = setInterval(() => { $('#time').textContent = `已用时 ${Math.round((Date.now() - t0) / 1000)} 秒 · 完成后会自动回到仪表盘`; }, 1000);
const fail = (msg) => {
  clearInterval(tick);
  $('#spin').hidden = true;
  $('#step').textContent = '没有刷新成功';
  $('#err').textContent = msg;
  $('#err').hidden = false;
  $('#actions').hidden = false;
};
async function poll() {
  try {
    const s = await (await fetch('/status', { cache: 'no-store' })).json();
    $('#step').textContent = s.step || '准备中';
    if (s.error) return fail(s.error);
    if (!s.running && s.step === '完成' && s.fetchedAt) {
      clearInterval(tick);
      return back(s.fetchedAt);
    }
  } catch (e) { return fail('连不上本机的刷新服务：' + e.message); }
  setTimeout(poll, 1500);
}
const back = (fetchedAt) => location.replace(next + (next.includes('?') ? '&' : '?') + 'refreshed=' + encodeURIComponent(fetchedAt));
async function start() {
  const r = await fetch('/start', { method: 'POST', headers: { 'X-Laona-Refresh': '1' } });
  if (r.status === 429) {
    const s = await (await fetch('/status', { cache: 'no-store' })).json();
    if (s.fetchedAt && !s.error) return back(s.fetchedAt);  // just refreshed: show that data
  }
  if (!r.ok && r.status !== 202) { const j = await r.json().catch(() => ({})); return fail(j.error || `刷新服务返回 ${r.status}`); }
  poll();
}
$('#retry').addEventListener('click', () => { $('#err').hidden = true; $('#actions').hidden = true; $('#spin').hidden = false; start().catch((e) => fail(e.message)); });
if (auto) {
  start().catch((e) => fail(e.message));
} else {
  clearInterval(tick);
  $('#spin').hidden = true;
  $('#step').textContent = '等待确认';
  $('#time').hidden = true;
  $('#confirm').hidden = false;
  $('#go').addEventListener('click', () => { $('#confirm').hidden = true; $('#time').hidden = false; $('#spin').hidden = false; start().catch((e) => fail(e.message)); }, { once: true });
}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if self.path.startswith("/status") or self.path == "/favicon.ico":
            return  # the progress page polls every 1.5 s; keep the terminal readable
        sys.stderr.write("[refresh] " + (fmt % args) + "\n")

    def send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def host_ok(self):
        # Rejects DNS-rebinding requests that reach this port under another host name.
        if self.headers.get("Host") in ALLOWED_HOSTS:
            return True
        self.send(403, json.dumps({"error": "forbidden host"}))
        return False

    def do_GET(self):
        if not self.host_ok():
            return
        u = urllib.parse.urlsplit(self.path)
        if u.path == "/":
            return self.send(302, "", extra={"Location": "/run"})
        if u.path == "/run":
            nxt = urllib.parse.parse_qs(u.query).get("next", [SITE])[0]
            nxt = nxt if safe_next(nxt) else SITE
            js_next = json.dumps(nxt).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
            auto = "true" if from_dashboard(self.headers.get("Referer")) else "false"
            page = PAGE.replace("__NEXT__", js_next).replace("__AUTO__", auto)
            return self.send(200, page, "text/html; charset=utf-8")
        if u.path == "/status":
            with lock:
                body = json.dumps(state, ensure_ascii=False)
            return self.send(200, body)
        self.send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if not self.host_ok():
            return
        if urllib.parse.urlsplit(self.path).path != "/start":
            return self.send(404, json.dumps({"error": "not found"}))
        # Only the /run page served from this port may start a refresh: browsers will not send this
        # custom header cross-origin without a CORS preflight, which this server never approves.
        origin = self.headers.get("Origin")
        if self.headers.get("X-Laona-Refresh") != "1" or (origin and urllib.parse.urlsplit(origin).netloc not in ALLOWED_HOSTS):
            return self.send(403, json.dumps({"error": "forbidden"}))
        with lock:
            if state["running"]:
                return self.send(202, json.dumps({"ok": True, "already": True}))
            wait = COOLDOWN - (time.time() - state["finished"])
            if state["finished"] and wait > 0:
                return self.send(429, json.dumps({"ok": False, "error": f"刚刷新过，{int(wait) + 1} 秒后再试。"}, ensure_ascii=False))
            state.update(running=True, step="准备中", error=None)
            threading.Thread(target=refresh, daemon=True).start()
        self.send(202, json.dumps({"ok": True}))


if __name__ == "__main__":
    if not api_key():
        sys.exit("缺少 YOUTUBE_API_KEY：在仓库根目录的 .env 里写一行 YOUTUBE_API_KEY=...")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"刷新服务已启动：http://{HOST}:{PORT}  （只接受本机访问，Ctrl+C 停止）")
    print(f"第一次请用这个链接打开网站，浏览器会记住你是频道主并显示刷新按钮：\n  {SITE}?owner=1")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
