/**
 * The standalone local dashboard server — an independent implementation of
 * the reference project's dashboard: binds 127.0.0.1, requires a token
 * (timing-safe) for every request, and serves a deep-linkable single-page
 * panel over the `.wolf/` brain data (tokens, context health, anatomy,
 * handoff, bugs). Zero dependencies: node:http + node:crypto.
 *
 * @module dsh-openwolf/dashboard
 */

import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { WolfBrain } from './brain.ts'
import { scanCodebase } from './scanner.ts'
import { currentGitHead, anatomyStaleReason } from './digest.ts'
import type { CodeMap, ScanOptions } from './types.ts'

/** Dashboard server options. */
export interface DashboardOptions {
  brain: WolfBrain
  /** Shared-secret token; every request must send it as `?token=` or `Authorization: Bearer`. */
  token: string
  /** Bind host (default 127.0.0.1). */
  host?: string
  /** Bind port (default 3310). */
  port?: number
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** The single-page dashboard HTML (self-contained, no external assets). */
export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>dsh-openwolf dashboard</title>
<style>
  :root { --bg:#0e1116; --panel:#171c24; --line:#232a35; --fg:#dbe4f0; --muted:#8b97a8; --accent:#4d6bfe; --ok:#35c07a; --warn:#e6a23c; --bad:#e55b5b; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; background:var(--bg); color:var(--fg); }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:baseline; }
  header h1 { font-size:15px; margin:0; color:var(--accent); }
  header a { color:var(--muted); text-decoration:none; font-size:12px; }
  header a.active { color:var(--fg); }
  main { padding:20px; display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); }
  section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  section h2 { margin:0 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .muted { color:var(--muted); } .ok { color:var(--ok); } .warn { color:var(--warn); } .bad { color:var(--bad); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:normal; }
  code { background:#0b0e13; padding:1px 4px; border-radius:4px; }
  pre { white-space:pre-wrap; font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>dsh-openwolf</h1>
  <a href="#overview" id="nav-overview">overview</a>
  <a href="#tokens" id="nav-tokens">tokens</a>
  <a href="#health" id="nav-health">context health</a>
  <a href="#anatomy" id="nav-anatomy">anatomy</a>
  <a href="#handoff" id="nav-handoff">handoff</a>
  <a href="#activity" id="nav-activity">activity</a>
  <a href="#cron" id="nav-cron">cron</a>
  <a href="#bugs" id="nav-bugs">bugs</a>
</header>
<main id="main"><section><h2>loading…</h2></section></main>
<script>
const TOKEN = new URLSearchParams(location.search).get('token') || localStorage.getItem('wolf-token') || '';
if (!TOKEN && location.search.includes('token=')) localStorage.setItem('wolf-token', TOKEN);
const H = { 'Authorization': 'Bearer ' + TOKEN };
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
async function get(path) {
  const r = await fetch('/api' + path, { headers: H });
  if (r.status === 401) throw new Error('unauthorized — start with --token and pass ?token=' + TOKEN);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function section(title, body) { const s = document.createElement('section'); s.appendChild(el('h2', title)); s.appendChild(body); return s; }
function kv(list) { const t = document.createElement('table'); for (const [k, v] of list) { const tr = document.createElement('tr'); tr.appendChild(el('td', k)); tr.appendChild(el('td', String(v))); t.appendChild(tr); } return t; }
async function renderTokens() {
  const d = await get('/report');
  main.innerHTML = '';
  main.appendChild(section('Tokens', kv([
    ['sessions', d.totalSessions], ['measured', d.measuredTokens + ' tok'],
    ['estimated', d.estimatedTokens + ' tok'],
    ...(d.sessions || []).slice(-5).map(s => ['session ' + String(s.session_id).slice(0, 8), (s.measured_tokens ?? 0) + ' tok · ' + (s.agent ?? '')]),
  ])));
}
async function renderHealth() {
  const d = await get('/status');
  main.innerHTML = '';
  main.appendChild(section('Context health', kv([
    ['scan', d.lastScanned || 'never'], ['files', d.totalFiles], ['lines', d.totalLines],
    ['git HEAD', (d.gitHead || '').slice(0, 8)], ['head moved', d.gitHeadMoved ? '⚠ yes' : 'no'],
    ['staleness', d.staleReason || 'fresh'],
    ['digest budget', d.digestBudget + ' tok'],
  ])));
}
async function renderAnatomy() {
  const d = await get('/anatomy');
  main.innerHTML = '';
  const pre = el('pre'); pre.textContent = d.markdown; main.appendChild(section('Anatomy', pre));
}
async function renderHandoff() {
  const d = await get('/status');
  main.innerHTML = '';
  const pre = el('pre'); pre.textContent = d.statusMarkdown || '(empty)';
  main.appendChild(section('STATUS.md handoff', pre));
}
async function renderOverview() {
  const d = await get('/status');
  main.innerHTML = '';
  main.appendChild(section('Overview', kv([
    ['workspace', d.root || '—'], ['files', d.totalFiles], ['lines', d.totalLines],
    ['last scan', d.lastScanned || 'never'], ['git HEAD', (d.gitHead || '—').slice(0, 12)],
  ])));
}
async function renderActivity() {
  const d = await get('/memory');
  main.innerHTML = '';
  const list = document.createElement('div');
  // Parse memory.md table rows without backticks: | time | action | files | outcome | tokens |
  for (const row of (d.markdown || '').split('\n')) {
    const parts = row.split('|').map((s) => s.trim());
    if (parts.length >= 6 && /^\d{4}-\d{2}-\d{2}/.test(parts[1] || '')) {
      list.appendChild(el('div', parts[1] + '  ' + parts[2] + '  ' + parts[3] + '  (' + parts[4] + ')', 'muted'));
    }
  }
  if (!list.childNodes.length) list.appendChild(el('div', '(no activity logged yet)', 'muted'));
  main.appendChild(section('Activity timeline', list));
}
async function renderCron() {
  const d = await get('/cron');
  main.innerHTML = '';
  const list = document.createElement('div');
  for (const t of (d.tasks || [])) {
    list.appendChild(el('div', '⏱ ' + t.id + ' ' + t.name + '  "' + t.expr + '" → ' + t.action + ' ' + (t.enabled ? '' : '(disabled)')));
    if (t.last_run) list.appendChild(el('div', '   last ' + t.last_run.slice(0, 16) + ' ' + (t.last_status || ''), 'muted'));
  }
  if (!(d.tasks || []).length) list.appendChild(el('div', '(no cron tasks)', 'muted'));
  main.appendChild(section('Cron tasks', list));
}
async function renderBugs() {
  const d = await get('/bugs');
  main.innerHTML = '';
  const list = document.createElement('div');
  for (const b of (d.bugs || []).slice().reverse()) {
    list.appendChild(el('div', '❌ ' + b.error_message + '  →  ' + b.fix));
    if (b.file) list.appendChild(el('div', '   ' + b.file, 'muted'));
  }
  main.appendChild(section('Buglog (' + (d.bugs || []).length + ')', list));
}
async function boot() {
  const hash = location.hash;
  const run = { '#overview': renderOverview, '#tokens': renderTokens, '#health': renderHealth, '#anatomy': renderAnatomy, '#handoff': renderHandoff, '#activity': renderActivity, '#cron': renderCron, '#bugs': renderBugs }[hash] || renderOverview;
  try { await run(); } catch (e) {
    main.innerHTML = '';
    main.appendChild(section('error', el('pre', String(e && e.message || e))));
  }
}
window.addEventListener('hashchange', boot);
boot();
</script>
</body>
</html>
`
}

/** Options for one scan (dashboard reads a fresh snapshot). */
function scanOptions(): ScanOptions {
  return {
    maxFiles: 4000,
    maxFileBytes: 65536,
    symbols: true,
    symbolBackend: 'auto',
    hidden: false,
    extraIgnore: ['node_modules', '.git', 'dist', 'build', 'coverage', '.venv', '__pycache__', '.next', '.cache', '.turbo', '.idea', '.vscode', 'target', 'out', '*.log', 'AGENTS.md', '.wolf'],
    useGitignore: true,
    sortBy: 'path',
  }
}

/** The dashboard server handle. */
export interface DashboardServer {
  port: number
  url: string
  close: () => Promise<void>
}

/** Start the dashboard server. Resolves once listening. */
export async function startDashboard(options: DashboardOptions): Promise<DashboardServer> {
  const { brain, token, host = '127.0.0.1', port = 3310 } = options
  const server: Server = createServer(async (req, res) => {
    const respond = (code: number, body: unknown, contentType = 'application/json') => {
      res.writeHead(code, { 'content-type': contentType, 'cache-control': 'no-store' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    const authed = () => {
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? ''
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
      return timingSafeEqualStr(token, q) || timingSafeEqualStr(token, bearer)
    }
    try {
      if (!authed()) return respond(401, { error: 'unauthorized' })
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      if (pathname === '/' || pathname === '/index.html') {
        return respond(200, dashboardHtml(), 'text/html; charset=utf-8')
      }
      if (pathname === '/api/report') {
        const ledger = await brain.readLedger()
        return respond(200, {
          totalSessions: ledger.lifetime.total_sessions,
          measuredTokens: ledger.sessions.reduce((s, x) => s + (x.measured_tokens ?? 0), 0),
          estimatedTokens: ledger.sessions.reduce((s, x) => s + (x.estimated_tokens ?? 0), 0),
          sessions: ledger.sessions.slice(-10),
        })
      }
      if (pathname === '/api/status') {
        const state = await brain.readScanState()
        const config = await brain.readConfig()
        const head = await currentGitHead(brain.root)
        const statusMarkdown = await brain.readStatus()
        const stale = await anatomyStaleReason(brain, config.openwolf.anatomy.rescanIntervalHours)
        return respond(200, {
          root: brain.root,
          lastScanned: state.last_scanned ?? null,
          totalFiles: state.total_files ?? 0,
          totalLines: state.total_lines ?? 0,
          gitHead: state.git_head ?? null,
          gitHeadMoved: state.git_head !== undefined && head !== null && state.git_head !== head,
          staleReason: stale,
          digestBudget: config.openwolf.context.sessionDigestBudgetTokens,
          statusMarkdown,
        })
      }
      if (pathname === '/api/anatomy') {
        const map: CodeMap = await scanCodebase(brain.root, scanOptions())
        return respond(200, { markdown: brain.renderAnatomy(map) })
      }
      if (pathname === '/api/bugs') {
        const log = await brain.readBuglog()
        return respond(200, { bugs: log.bugs.slice(-50) })
      }
      if (pathname === '/api/memory') {
        return respond(200, { markdown: await brain.readText(`${brain.dir}/memory.md`) })
      }
      if (pathname === '/api/cron') {
        return respond(200, { tasks: await brain.readCronTasks() })
      }
      return respond(404, { error: 'not found' })
    } catch (err) {
      respond(500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  const addr = server.address() as AddressInfo
  return {
    port: addr.port,
    url: `http://${host}:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
