// portable-core.js - bundled local API for ABUZ8 OS.
// This is the clean-machine safety net: chat, memory, MCP import, status, and
// common UI endpoints work without private developer paths, Python, Docker, ComfyUI, or a server.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.QADIR_PORT || process.env.ABUZ8_PORT || 8900);
const LFM_PORT = Number(process.env.ABUZ8_LFM_PORT || 8902);

let server = null;
let dataRoot = null;
let logFn = (m) => console.log('[portable-core] ' + m);
const jobs = [];
let lfmProcess = null;
let lfmStarting = false;
let lastLfmError = '';
let activeBrain = null;
let hostExecutable = null;
let actionConsentGranted = false;

const EMBEDDED_BRAIN_CATALOG = [
  {
    id: 'lfm2.5-350m-lite',
    name: 'LFM2.5 350M Lite',
    file: 'LFM2.5-350M-Q4_K_M.gguf',
    tier: 'lite',
    role: 'fast offline helper for weak laptops and USB-first installs',
    min_ram_gb: 4,
    context: 1536
  },
  {
    id: 'lfm2-1.2b-tool',
    name: 'LFM2 1.2B Tool',
    file: 'LFM2-1.2B-Tool-Q4_K_M.gguf',
    tier: 'standard',
    role: 'balanced tool planner for everyday agent work',
    min_ram_gb: 8,
    context: 2048
  },
  {
    id: 'lfm2-2.6b-pro',
    name: 'LFM2 2.6B Pro',
    file: 'LFM2-2.6B-Exp-Q4_K_M.gguf',
    tier: 'pro',
    role: 'strongest bundled reasoning brain for business and creator tasks',
    min_ram_gb: 12,
    context: 2048
  }
];

function safeMkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isWritable(dir) {
  try {
    safeMkdir(dir);
    const probe = path.join(dir, `.write-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolveDataRoot(app) {
  const explicit = process.env.ABUZ8_DATA_DIR || process.env.QADIR_DATA_DIR;
  if (explicit) return safeMkdir(explicit);

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && isWritable(portableDir)) {
    return safeMkdir(path.join(portableDir, 'ABUZ8_OS_Data'));
  }

  const appData = app && typeof app.getPath === 'function'
    ? app.getPath('userData')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'ABUZ8 OS');
  return safeMkdir(appData);
}

function initFolders() {
  for (const name of ['memory', 'mcp', 'skills', 'logs', 'models', 'workspaces', 'cache', 'exports', 'config', 'mission']) {
    safeMkdir(path.join(dataRoot, name));
  }
  const cfg = path.join(dataRoot, 'config', 'runtime.json');
  if (!fs.existsSync(cfg)) {
    writeJson(cfg, {
      product: 'ABUZ8 OS',
      mode: process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installed',
      backend_port: PORT,
      data_root: dataRoot,
      local_brain: {
        default: 'auto',
        tiers: EMBEDDED_BRAIN_CATALOG.map((b) => ({ id: b.id, name: b.name, tier: b.tier, file: b.file })),
        status: 'embedded-offline'
      },
      created_at: new Date().toISOString()
    });
  }
}

function missionFile() {
  return path.join(dataRoot, 'mission', 'board.json');
}

function toolsFile() {
  return path.join(dataRoot, 'config', 'local_tools.json');
}

function runtimeConfigFile() {
  return path.join(dataRoot, 'config', 'runtime.json');
}

function readRuntimeConfig() {
  return readJson(runtimeConfigFile(), {});
}

function writeRuntimeConfigPatch(patch = {}) {
  const cfg = readRuntimeConfig();
  const next = { ...cfg, ...patch, updated_at: new Date().toISOString() };
  writeJson(runtimeConfigFile(), next);
  return next;
}

function defaultMissionBoard() {
  const now = new Date().toISOString();
  return {
    ok: true,
    mission: {
      title: 'ABUZ8 OS Production Launch',
      objective: 'Ship a local-first agent OS that works offline, bridges Claude Desktop through MCP, and can be verified by a buyer on a clean Windows machine.',
      updated_at: now
    },
    columns: [
      { id: 'backlog', title: 'Backlog', limit: 12 },
      { id: 'ready', title: 'Ready', limit: 8 },
      { id: 'doing', title: 'Doing', limit: 3 },
      { id: 'verify', title: 'Verify', limit: 6 },
      { id: 'done', title: 'Done', limit: 20 }
    ],
    tasks: [
      { id: 'task-brain-tiers', title: 'Three offline LFM brain variants', column: 'done', priority: 'high', owner: 'ABUZ8', details: 'Lite, Standard, and Pro packaged with llama.cpp runtime and verified fallback:false.', created_at: now, updated_at: now },
      { id: 'task-claude-mcp', title: 'Claude Desktop MCP symbiote', column: 'verify', priority: 'high', owner: 'ABUZ8', details: 'Install abuz8_os into Claude Desktop config and expose native tools over stdio.', created_at: now, updated_at: now },
      { id: 'task-clean-vm', title: 'Clean Windows VM installer pass', column: 'ready', priority: 'high', owner: 'human', details: 'Requires a fresh Windows machine and code-signing decision.', created_at: now, updated_at: now },
      { id: 'task-code-sign', title: 'Code signing certificate', column: 'backlog', priority: 'high', owner: 'human', details: 'Needed before distribution to executives or customers.', created_at: now, updated_at: now }
    ]
  };
}

function readMissionBoard() {
  const file = missionFile();
  if (!fs.existsSync(file)) writeJson(file, defaultMissionBoard());
  const board = readJson(file, defaultMissionBoard());
  board.ok = true;
  board.columns = Array.isArray(board.columns) && board.columns.length ? board.columns : defaultMissionBoard().columns;
  board.tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return board;
}

function writeMissionBoard(board) {
  board.ok = true;
  board.mission = board.mission || {};
  board.mission.updated_at = new Date().toISOString();
  writeJson(missionFile(), board);
  return board;
}

function missionSummary(board = readMissionBoard()) {
  const counts = {};
  for (const col of board.columns) counts[col.id] = 0;
  for (const task of board.tasks) counts[task.column] = (counts[task.column] || 0) + 1;
  return {
    total: board.tasks.length,
    counts,
    blockers: board.tasks.filter((t) => t.priority === 'blocker' || t.blocked).length,
    human_required: board.tasks.filter((t) => String(t.owner || '').toLowerCase() === 'human').length,
    next: board.tasks.filter((t) => !['done'].includes(t.column)).slice(0, 5).map((t) => ({ id: t.id, title: t.title, column: t.column, priority: t.priority, owner: t.owner }))
  };
}

function upsertMissionTask(input = {}) {
  const board = readMissionBoard();
  const now = new Date().toISOString();
  const title = String(input.title || input.task || '').trim();
  if (!title) throw new Error('Mission task title is required.');
  const allowed = new Set(board.columns.map((c) => c.id));
  const id = slug(input.id || title || `task-${Date.now()}`);
  const existing = board.tasks.find((t) => t.id === id);
  const task = {
    id,
    title,
    column: allowed.has(input.column) ? input.column : (existing?.column || 'backlog'),
    priority: input.priority || existing?.priority || 'medium',
    owner: input.owner || existing?.owner || 'ABUZ8',
    details: input.details || input.description || existing?.details || '',
    blocked: Boolean(input.blocked ?? existing?.blocked ?? false),
    created_at: existing?.created_at || now,
    updated_at: now
  };
  if (existing) Object.assign(existing, task);
  else board.tasks.unshift(task);
  writeMissionBoard(board);
  return task;
}

function moveMissionTask(id, column) {
  const board = readMissionBoard();
  const allowed = new Set(board.columns.map((c) => c.id));
  if (!allowed.has(column)) throw new Error(`Unknown mission column: ${column}`);
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Mission task not found: ${id}`);
  task.column = column;
  task.updated_at = new Date().toISOString();
  writeMissionBoard(board);
  return task;
}

function localToolsList() {
  const brain = activeBrain || selectEmbeddedBrain();
  const builtIns = [
    { name: 'abuz8_chat', type: 'mcp', status: 'ready', description: 'Claude Desktop can ask the embedded ABUZ8 brain through MCP.' },
    { name: 'abuz8_device_probe', type: 'mcp', status: 'ready', description: 'Hardware and local capability probe.' },
    { name: 'abuz8_brains_list', type: 'mcp', status: 'ready', description: 'List bundled and downloaded local model files.' },
    { name: 'abuz8_brain_select', type: 'mcp', status: 'ready', description: 'Switch the active embedded brain tier for future local chat calls.' },
    { name: 'abuz8_memory_write', type: 'mcp', status: 'ready', description: 'Write a note to local ABUZ8 memory.' },
    { name: 'abuz8_tools_list', type: 'mcp', status: 'ready', description: 'List local tools, MCP tools, model shelf, and permission-gated bridges.' },
    { name: 'abuz8_tool_create', type: 'mcp', status: 'ready', description: 'Create a local ABUZ8 tool definition.' },
    { name: 'abuz8_tool_call', type: 'mcp', status: 'ready', description: 'Execute a local ABUZ8 built-in or registered tool by name.' },
    { name: 'abuz8_mission_board', type: 'mcp', status: 'ready', description: 'Read the local mission/Kanban board.' },
    { name: 'abuz8_mission_task_create', type: 'mcp', status: 'ready', description: 'Create or update a mission task from Claude Desktop.' },
    { name: 'abuz8_mission_task_move', type: 'mcp', status: 'ready', description: 'Move a mission task between Kanban columns.' },
    { name: 'huggingface_model_download', type: 'local-api', status: 'permission-gated', description: 'Download model files to the local model shelf with allow_network_download.' },
    { name: 'model_download_hf', type: 'network-model', status: 'permission-gated', description: 'Alias for downloading a user-approved Hugging Face GGUF into the portable data model shelf.' },
    { name: 'cloud_brain_register', type: 'cloud-model', status: 'permission-gated', description: 'Register a user-owned cloud brain endpoint or provider key reference locally.' },
    { name: 'open_url', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Open an http/https URL in the default browser after Allow actions consent.' },
    { name: 'web_search', type: 'network', status: 'ready', description: 'Search the public web for current information and return a short sourced result.' },
    { name: 'open_app', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Open an allowlisted desktop app: notepad, mspaint, chrome, edge, browser, calc, or explorer.' },
    { name: 'draw_monkey_in_paint', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Create a simple monkey drawing in the portable sandbox and open it in Microsoft Paint.' },
    { name: 'draw_cartoon_rabbit_in_paint', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Create an original cartoon rabbit drawing in the portable sandbox and open it in Microsoft Paint.' },
    { name: 'screenshot', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Capture the primary screen to the portable data shots folder.' },
    { name: 'file_write', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Write a text file inside the portable data sandbox only.' },
    { name: 'shell_run', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Run only allowlisted shell probes: whoami, hostname, or dir. Default deny.' },
    { name: 'cli_probe', type: 'local-api', status: 'permission-gated', description: 'Probe local CLIs with allow_cli.' },
    { name: 'cli_register', type: 'local-api', status: 'permission-gated', description: 'Register a local CLI bridge with allow_cli.' },
    { name: 'oauth_exchange', type: 'local-api', status: 'permission-gated', description: 'Store user-authorized OAuth tokens locally with allow_oauth_store.' },
    { name: 'embedded_brain_runtime', type: 'local-runtime', status: brain?.embedded ? 'ready' : 'fallback', description: brain?.embedded ? `${brain.name} selected automatically.` : 'No embedded GGUF selected.' }
  ];
  return builtIns.concat(readCustomTools());
}

function modelRoots() {
  return [
    path.join(dataRoot, 'models'),
    path.join(dataRoot, 'brain'),
    path.join(__dirname, 'brain'),
    path.join(__dirname, 'models'),
    process.env.ABUZ8_MODELS_DIR,
    'E:\\ABU\\MODELS'
  ].filter(Boolean);
}

function listLocalModelAssets() {
  const rows = [];
  const wanted = /\.(gguf|onnx|pth|safetensors|bin|wav)$/i;
  const walk = (dir, depth = 0) => {
    if (depth > 3 || rows.length >= 160) return;
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!/node_modules|__pycache__|\.git|site-packages|venv/i.test(full)) walk(full, depth + 1);
      } else if (wanted.test(item.name)) {
        let stat = null;
        try { stat = fs.statSync(full); } catch {}
        rows.push({
          name: item.name,
          path: full,
          kind: /\.gguf$/i.test(item.name) ? 'reasoning' : /\.wav$/i.test(item.name) ? 'reference-voice' : /\.(onnx|pth)$/i.test(item.name) ? 'voice-or-vision' : 'model',
          mb: stat ? Math.round((stat.size / 1024 / 1024) * 10) / 10 : null
        });
      }
    }
  };
  modelRoots().forEach((r) => walk(r));
  const seen = new Set();
  return rows.filter((r) => {
    const key = r.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readCustomTools() {
  const cfg = readJson(toolsFile(), { tools: [] });
  return Array.isArray(cfg.tools) ? cfg.tools : [];
}

function createLocalTool(input = {}) {
  const name = slug(input.name || input.title || '');
  if (!name) throw new Error('Tool name is required.');
  const cfg = readJson(toolsFile(), { tools: [] });
  cfg.tools = Array.isArray(cfg.tools) ? cfg.tools : [];
  const now = new Date().toISOString();
  const tool = {
    name,
    label: input.label || input.title || name,
    type: input.type || 'manual',
    status: input.status || 'draft',
    description: input.description || input.purpose || '',
    command: input.command || '',
    args: Array.isArray(input.args) ? input.args : [],
    endpoint: input.endpoint || '',
    permission_required: input.permission_required || (input.command ? 'allow_cli' : ''),
    created_at: cfg.tools.find((t) => t.name === name)?.created_at || now,
    updated_at: now
  };
  const existing = cfg.tools.findIndex((t) => t.name === name);
  if (existing >= 0) cfg.tools[existing] = tool;
  else cfg.tools.unshift(tool);
  writeJson(toolsFile(), cfg);
  return tool;
}

function normalizeHttpUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('url is required');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https URLs are allowed.');
  return parsed.toString();
}

function requireActionConsent() {
  if (!actionConsentGranted) {
    throw new Error('Action tools are blocked until the user grants Allow actions consent for this session.');
  }
}

function normalizeAllowedApp(name) {
  const key = slug(name || '');
  const apps = {
    notepad: { file: 'notepad.exe', label: 'Notepad' },
    mspaint: { file: 'mspaint.exe', label: 'Paint' },
    paint: { file: 'mspaint.exe', label: 'Paint' },
    chrome: { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', 'chrome'], label: 'Google Chrome' },
    googlechrome: { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', 'chrome'], label: 'Google Chrome' },
    browser: { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'https://www.google.com'], label: 'Default browser' },
    defaultbrowser: { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'https://www.google.com'], label: 'Default browser' },
    edge: { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', 'msedge'], label: 'Microsoft Edge' },
    msedge: { file: 'cmd.exe', args: ['/d', '/c', 'start', '""', 'msedge'], label: 'Microsoft Edge' },
    calc: { file: 'calc.exe', label: 'Calculator' },
    calculator: { file: 'calc.exe', label: 'Calculator' },
    explorer: { file: 'explorer.exe', label: 'File Explorer' }
  };
  return apps[key] || null;
}

async function startProcessDetached(file, args = []) {
  const child = spawn(file, args.map(String), {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return { launched: true, pid: child.pid, file, args };
}

async function actionOpenApp(args = {}) {
  requireActionConsent();
  const app = normalizeAllowedApp(args.name || args.app || args.target || '');
  if (!app) throw new Error('Unsupported app. Allowed apps: notepad, mspaint, chrome, edge, browser, calc, explorer.');
  const result = await startProcessDetached(app.file, app.args || []);
  return { ...result, app: app.label };
}

async function actionDrawMonkeyInPaint(args = {}) {
  requireActionConsent();
  const artDir = safeMkdir(path.join(dataRoot, 'art'));
  const file = path.join(artDir, `paint-monkey-${Date.now()}.png`);
  const scriptFile = path.join(safeMkdir(path.join(dataRoot, 'cache')), `draw-monkey-${process.pid}-${Date.now()}.ps1`);
  const caption = String(args.caption || 'ABUZ8 OS drew this locally').replace(/'/g, "''").slice(0, 80);
  const script = [
    'param([string]$OutFile, [string]$Caption)',
    'Add-Type -AssemblyName System.Drawing',
    '$bmp = New-Object System.Drawing.Bitmap 900, 700',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '$bg = [System.Drawing.Brushes]::White',
    '$g.FillRectangle($bg, 0, 0, 900, 700)',
    '$fur = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(120, 78, 44))',
    '$fur2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(88, 53, 31))',
    '$skin = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(224, 174, 120))',
    '$ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(45, 31, 24), 7)',
    '$thin = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(45, 31, 24), 4)',
    '$smile = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(80, 42, 34), 5)',
    '$g.FillEllipse($fur2, 220, 95, 180, 180)',
    '$g.FillEllipse($fur2, 500, 95, 180, 180)',
    '$g.FillEllipse($fur, 250, 80, 400, 400)',
    '$g.FillEllipse($skin, 315, 180, 270, 255)',
    '$g.FillEllipse([System.Drawing.Brushes]::White, 365, 235, 55, 55)',
    '$g.FillEllipse([System.Drawing.Brushes]::White, 480, 235, 55, 55)',
    '$g.FillEllipse([System.Drawing.Brushes]::Black, 383, 252, 18, 18)',
    '$g.FillEllipse([System.Drawing.Brushes]::Black, 498, 252, 18, 18)',
    '$g.FillEllipse($fur2, 428, 290, 75, 58)',
    '$g.FillEllipse($skin, 365, 325, 170, 90)',
    '$g.DrawArc($smile, 400, 340, 100, 55, 15, 150)',
    '$g.DrawEllipse($ink, 250, 80, 400, 400)',
    '$g.DrawEllipse($thin, 220, 95, 180, 180)',
    '$g.DrawEllipse($thin, 500, 95, 180, 180)',
    '$g.DrawArc($thin, 180, 420, 190, 160, 190, 115)',
    '$g.DrawArc($thin, 530, 420, 190, 160, 345, 115)',
    '$font = New-Object System.Drawing.Font "Segoe UI", 24, ([System.Drawing.FontStyle]::Bold)',
    '$g.DrawString($Caption, $font, [System.Drawing.Brushes]::Black, 245, 575)',
    '$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose(); $bmp.Dispose(); $fur.Dispose(); $fur2.Dispose(); $skin.Dispose(); $ink.Dispose(); $thin.Dispose(); $smile.Dispose(); $font.Dispose()'
  ].join(os.EOL);
  fs.writeFileSync(scriptFile, script, 'utf8');
  const drawn = await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, file, caption], 20000);
  try { fs.unlinkSync(scriptFile); } catch {}
  if (!drawn.ok || !fs.existsSync(file)) throw new Error(drawn.stderr || drawn.stdout || 'Monkey drawing failed.');
  const opened = await startProcessDetached('mspaint.exe', [file]);
  return { ...opened, app: 'Paint', file, bytes: fs.statSync(file).size };
}

async function actionDrawCartoonRabbitInPaint(args = {}) {
  requireActionConsent();
  const artDir = safeMkdir(path.join(dataRoot, 'art'));
  const file = path.join(artDir, `paint-cartoon-rabbit-${Date.now()}.png`);
  const scriptFile = path.join(safeMkdir(path.join(dataRoot, 'cache')), `draw-rabbit-${process.pid}-${Date.now()}.ps1`);
  const caption = String(args.caption || 'Original cartoon rabbit drawn locally').replace(/'/g, "''").slice(0, 90);
  const script = [
    'param([string]$OutFile, [string]$Caption)',
    'Add-Type -AssemblyName System.Drawing',
    '$bmp = New-Object System.Drawing.Bitmap 900, 700',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '$g.FillRectangle([System.Drawing.Brushes]::White, 0, 0, 900, 700)',
    '$fur = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(205, 214, 210))',
    '$fur2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(152, 168, 160))',
    '$pink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 176, 196))',
    '$ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(35, 45, 42), 6)',
    '$thin = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(35, 45, 42), 3)',
    '$smile = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 70, 66), 4)',
    '$g.FillEllipse($fur, 285, 88, 105, 275)',
    '$g.FillEllipse($fur, 510, 88, 105, 275)',
    '$g.FillEllipse($pink, 318, 125, 42, 205)',
    '$g.FillEllipse($pink, 543, 125, 42, 205)',
    '$g.FillEllipse($fur, 250, 220, 400, 350)',
    '$g.FillEllipse($fur2, 330, 405, 240, 120)',
    '$g.FillEllipse([System.Drawing.Brushes]::White, 355, 330, 70, 85)',
    '$g.FillEllipse([System.Drawing.Brushes]::White, 475, 330, 70, 85)',
    '$g.FillEllipse([System.Drawing.Brushes]::Black, 383, 365, 22, 25)',
    '$g.FillEllipse([System.Drawing.Brushes]::Black, 503, 365, 22, 25)',
    '$g.FillEllipse($pink, 426, 422, 48, 35)',
    '$g.DrawArc($smile, 397, 438, 55, 45, 20, 130)',
    '$g.DrawArc($smile, 448, 438, 55, 45, 30, 130)',
    '$g.DrawLine($thin, 390, 430, 285, 395)',
    '$g.DrawLine($thin, 390, 452, 278, 455)',
    '$g.DrawLine($thin, 510, 430, 615, 395)',
    '$g.DrawLine($thin, 510, 452, 622, 455)',
    '$g.DrawEllipse($ink, 250, 220, 400, 350)',
    '$g.DrawEllipse($thin, 285, 88, 105, 275)',
    '$g.DrawEllipse($thin, 510, 88, 105, 275)',
    '$font = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Bold)',
    '$g.DrawString($Caption, $font, [System.Drawing.Brushes]::Black, 220, 610)',
    '$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose(); $bmp.Dispose(); $fur.Dispose(); $fur2.Dispose(); $pink.Dispose(); $ink.Dispose(); $thin.Dispose(); $smile.Dispose(); $font.Dispose()'
  ].join(os.EOL);
  fs.writeFileSync(scriptFile, script, 'utf8');
  const drawn = await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, file, caption], 20000);
  try { fs.unlinkSync(scriptFile); } catch {}
  if (!drawn.ok || !fs.existsSync(file)) throw new Error(drawn.stderr || drawn.stdout || 'Rabbit drawing failed.');
  const opened = await startProcessDetached('mspaint.exe', [file]);
  return { ...opened, app: 'Paint', file, bytes: fs.statSync(file).size };
}

async function actionOpenUrl(args = {}) {
  requireActionConsent();
  const url = normalizeHttpUrl(args.url || args.href || args.query);
  const result = await startProcessDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  return { ...result, browser: 'default', url };
}

function fetchJsonUrl(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'ABUZ8-OS-Agent/1.0' } }, (r) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { data += d; if (data.length > 1024 * 1024) req.destroy(new Error('response too large')); });
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`invalid JSON from web search: ${e.message}`)); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('web search timeout')));
    req.on('error', reject);
  });
}

function fetchTextUrl(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'ABUZ8-OS-Agent/1.0' } }, (r) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { data += d; if (data.length > 1024 * 1024) req.destroy(new Error('response too large')); });
      r.on('end', () => resolve(data));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('web fetch timeout')));
    req.on('error', reject);
  });
}

function decodeXmlText(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function parseRssItems(xml, limit = 5) {
  return [...String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, limit).map((m) => {
    const item = m[0];
    const title = decodeXmlText((item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const link = decodeXmlText((item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const pubDate = decodeXmlText((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    return { title, url: link, pubDate };
  }).filter((x) => x.title);
}

async function actionWebSearch(args = {}) {
  const query = String(args.query || args.q || args.prompt || '').trim();
  if (!query) throw new Error('web_search requires query.');
  if (/\b(news|latest|current|today|recent)\b/i.test(query)) {
    try {
      const rssUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
      const xml = await fetchTextUrl(rssUrl);
      const items = parseRssItems(xml, 5);
      if (items.length) {
        const result = {
          query,
          source: 'Bing News RSS',
          answer: `Top current results for "${query}":`,
          url: rssUrl,
          related: items.map((x) => ({ text: `${x.title}${x.pubDate ? ` (${x.pubDate})` : ''}`, url: x.url }))
        };
        if (args.open_browser && actionConsentGranted) {
          result.opened = await startProcessDetached('rundll32.exe', ['url.dll,FileProtocolHandler', rssUrl]).catch((e) => ({ ok: false, error: e.message }));
        }
        return result;
      }
    } catch {}
  }
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const data = await fetchJsonUrl(url);
  const related = Array.isArray(data.RelatedTopics)
    ? data.RelatedTopics.flatMap((t) => t.Topics || [t]).filter((t) => t && (t.Text || t.FirstURL)).slice(0, 5)
    : [];
  const result = {
    query,
    source: 'DuckDuckGo Instant Answer',
    answer: data.AbstractText || data.Answer || '',
    heading: data.Heading || '',
    url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    related: related.map((t) => ({ text: t.Text || '', url: t.FirstURL || '' }))
  };
  if (args.open_browser && actionConsentGranted) {
    result.opened = await startProcessDetached('rundll32.exe', ['url.dll,FileProtocolHandler', result.url]).catch((e) => ({ ok: false, error: e.message }));
  }
  return result;
}

function sandboxFilePath(relpath) {
  const rel = String(relpath || '').trim();
  if (!rel) throw new Error('relpath is required.');
  if (path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) throw new Error('file_write only accepts a relative path inside the portable data sandbox.');
  const root = path.resolve(dataRoot);
  const target = path.resolve(root, rel);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('file_write path escapes the portable data sandbox.');
  return target;
}

async function actionFileWrite(args = {}) {
  requireActionConsent();
  const target = sandboxFilePath(args.relpath || args.path || args.file);
  const content = String(args.content ?? '');
  safeMkdir(path.dirname(target));
  fs.writeFileSync(target, content, 'utf8');
  return { file: target, bytes: Buffer.byteLength(content, 'utf8') };
}

async function actionScreenshot() {
  requireActionConsent();
  const shotsDir = safeMkdir(path.join(dataRoot, 'shots'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(shotsDir, `${stamp}.png`);
  const scriptFile = path.join(safeMkdir(path.join(dataRoot, 'cache')), `capture-${process.pid}-${Date.now()}.ps1`);
  const script = [
    'param([string]$OutFile)',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
    '$gfx = [System.Drawing.Graphics]::FromImage($bmp)',
    '$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)',
    '$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$gfx.Dispose()',
    '$bmp.Dispose()'
  ].join(os.EOL);
  fs.writeFileSync(scriptFile, script, 'utf8');
  const out = await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, file], 20000);
  try { fs.unlinkSync(scriptFile); } catch {}
  if (!out.ok || !fs.existsSync(file)) throw new Error(out.stderr || out.stdout || 'Screenshot capture failed.');
  return { file, bytes: fs.statSync(file).size };
}

async function actionShellRun(args = {}) {
  requireActionConsent();
  const command = slug(args.cmd || args.command || '');
  if (!['whoami', 'hostname', 'dir'].includes(command)) {
    throw new Error('shell_run blocked. Allowed commands: whoami, hostname, dir.');
  }
  if (command === 'dir') return runCommand('cmd.exe', ['/d', '/c', 'dir'], Number(args.timeout || 15000));
  return runCommand(command, [], Number(args.timeout || 15000));
}

async function callLocalTool(name, args = {}) {
  const toolName = String(name || args.name || args.tool || '').trim();
  if (!toolName) throw new Error('tool name is required');
  const key = slug(toolName);
  const isTool = (...names) => names.map(slug).includes(key);
  const body = args || {};

  if (isTool('abuz8_chat', 'chat')) {
    const prompt = body.message || body.content || body.prompt || body.raw || '';
    const response = await embeddedReply(prompt) || localReply(prompt);
    return { ok: true, tool: toolName, result: { response, brain: embeddedBrainStatus(), fallback: !lfmProcess } };
  }
  if (isTool('abuz8_device_probe', 'device_probe', 'hardware_probe')) {
    return { ok: true, tool: toolName, result: await machineProbe() };
  }
  if (isTool('abuz8_brains_list', 'brains_list', 'models_list')) {
    return { ok: true, tool: toolName, result: { brains: embeddedBrainStatus(), models: listDownloadedModels() } };
  }
  if (isTool('abuz8_brain_select', 'brain_select', 'select_brain')) {
    return { ok: true, tool: toolName, result: setActiveBrain(body.brain || body.id || body.tier || body.name || 'auto') };
  }
  if (isTool('huggingface_model_download', 'model_download_hf')) {
    return { ok: true, tool: toolName, result: await downloadHuggingFaceModel(body) };
  }
  if (isTool('cloud_brain_register')) {
    return { ok: true, tool: toolName, result: registerCloudBrain(body) };
  }
  if (isTool('abuz8_memory_write', 'memory_write')) {
    const item = { id: crypto.randomUUID(), type: body.type || 'note', content: body.content || body.text || '', timestamp: new Date().toISOString() };
    appendJsonl(memoryFile(), item);
    return { ok: true, tool: toolName, result: item };
  }
  if (isTool('memory_search', 'abuz8_memory_search')) {
    const q = String(body.q || body.query || body.text || '');
    return { ok: true, tool: toolName, result: searchMemoryItems(q, 25) };
  }
  if (isTool('abuz8_tools_list', 'tools_list')) {
    return { ok: true, tool: toolName, result: localToolsList() };
  }
  if (isTool('abuz8_tool_create', 'tool_create')) {
    return { ok: true, tool: toolName, result: createLocalTool(body) };
  }
  if (isTool('abuz8_mission_board', 'mission_board')) {
    const board = readMissionBoard();
    return { ok: true, tool: toolName, result: { ...board, summary: missionSummary(board) } };
  }
  if (isTool('abuz8_mission_task_create', 'mission_task_create')) {
    const task = upsertMissionTask(body);
    return { ok: true, tool: toolName, result: { task, board: readMissionBoard() } };
  }
  if (isTool('abuz8_mission_task_move', 'mission_task_move')) {
    const task = moveMissionTask(body.id, body.column);
    return { ok: true, tool: toolName, result: { task, board: readMissionBoard() } };
  }
  if (isTool('open_url')) {
    return { ok: true, tool: toolName, result: await actionOpenUrl(body) };
  }
  if (isTool('web_search', 'search_web', 'internet_search')) {
    return { ok: true, tool: toolName, result: await actionWebSearch(body) };
  }
  if (isTool('open_app')) {
    return { ok: true, tool: toolName, result: await actionOpenApp(body) };
  }
  if (isTool('draw_monkey_in_paint', 'paint_monkey', 'draw_monkey')) {
    return { ok: true, tool: toolName, result: await actionDrawMonkeyInPaint(body) };
  }
  if (isTool('draw_cartoon_rabbit_in_paint', 'paint_rabbit', 'draw_rabbit')) {
    return { ok: true, tool: toolName, result: await actionDrawCartoonRabbitInPaint(body) };
  }
  if (isTool('screenshot')) {
    return { ok: true, tool: toolName, result: await actionScreenshot(body) };
  }
  if (isTool('file_write')) {
    return { ok: true, tool: toolName, result: await actionFileWrite(body) };
  }
  if (isTool('shell_run')) {
    return { ok: true, tool: toolName, result: await actionShellRun(body) };
  }
  if (isTool('cli_probe', 'abuz8_cli_probe')) {
    if (!body.allow_cli) throw new Error('allow_cli must be true before executing a local CLI command.');
    return { ok: true, tool: toolName, result: await runCommand(String(body.command || ''), Array.isArray(body.args) ? body.args.map(String) : ['--version'], Number(body.timeout || 15000)) };
  }

  const custom = readCustomTools().find((t) => slug(t.name || t.id) === key);
  if (custom) {
    if (custom.command) {
      if (!body.allow_cli) throw new Error('allow_cli must be true before executing a custom CLI tool.');
      const callArgs = Array.isArray(body.args) ? body.args.map(String) : (Array.isArray(custom.args) ? custom.args.map(String) : []);
      return { ok: true, tool: custom.name, custom: true, result: await runCommand(custom.command, callArgs, Number(body.timeout || 15000)) };
    }
    return { ok: true, tool: custom.name, custom: true, result: custom, note: 'Tool definition exists. Add command/endpoint to execute it.' };
  }

  throw new Error(`Unknown local tool: ${toolName}`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  safeMkdir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function appendJsonl(file, value) {
  safeMkdir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

function binary(res, status, body, type = 'application/octet-stream') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': body.length,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

function getBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > 10_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); }
    });
    req.on('error', () => resolve({}));
  });
}

function splitPath(reqUrl) {
  const u = new URL(reqUrl, `http://127.0.0.1:${PORT}`);
  return { pathname: u.pathname.replace(/\/+$/, '') || '/', searchParams: u.searchParams };
}

function voiceProfiles(voices = []) {
  const lower = (v) => String(v || '').toLowerCase();
  const male = voices.find((v) => /guy|david|mark|george|james|daniel|male/i.test(v)) || voices.find(Boolean) || '';
  const female = voices.find((v) => /zira|jenny|aria|susan|eva|hazel|samantha|female/i.test(v)) || voices.find(Boolean) || '';
  return [
    { id: 'auto', label: 'Auto', voice: '', rate: 0, pitch: 1, description: 'Use the system default voice.' },
    { id: 'male', label: 'Man', voice: male, rate: -1, pitch: 0.95, description: 'Lower, calmer local voice when available.' },
    { id: 'female', label: 'Woman', voice: female, rate: 0, pitch: 1.05, description: 'Clearer local voice when available.' },
    { id: 'cartoon', label: 'Cartoon', voice: female || male, rate: 3, pitch: 1.22, description: 'Playful cartoon-style voice profile; not an imitation of a real performer or protected character.' }
  ].map((p) => ({ ...p, voice_available: !p.voice || voices.some((v) => lower(v) === lower(p.voice)) }));
}

function resolveVoiceProfile(input, voices = []) {
  const wanted = String(input || '').trim();
  const profiles = voiceProfiles(voices);
  const profile = profiles.find((p) => p.id === slug(wanted) || p.label.toLowerCase() === wanted.toLowerCase());
  if (profile) return profile;
  return { id: 'custom', label: wanted || 'Auto', voice: wanted, rate: 0, pitch: 1, description: 'Custom installed Windows voice.' };
}

function synthesizeWindowsTts(textValue, voiceName = '', voiceProfile = '') {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Native TTS is only bundled for Windows in this build.'));
    const textClean = String(textValue || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!textClean) return reject(new Error('No text supplied.'));
    const ttsDir = safeMkdir(path.join(dataRoot, 'cache', 'tts'));
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const inputFile = path.join(ttsDir, `${id}.txt`);
    const outputFile = path.join(ttsDir, `${id}.wav`);
    const scriptFile = path.join(ttsDir, `${id}.ps1`);
    listWindowsTtsVoices().then((voices) => {
      const profile = resolveVoiceProfile(voiceProfile || voiceName || '', voices);
      const finalVoice = voiceName && !['auto', 'male', 'female', 'cartoon'].includes(slug(voiceName)) ? voiceName : profile.voice;
      const rate = Number.isFinite(profile.rate) ? profile.rate : 0;
      const textForVoice = profile.id === 'cartoon'
        ? textClean.replace(/\bhello\b/ig, 'well hello').replace(/[.]{1,}/g, '!')
        : textClean;
      fs.writeFileSync(inputFile, textForVoice, 'utf8');
      const scriptBody = [
        'param([string]$InputFile,[string]$OutputFile,[string]$VoiceName,[int]$Rate)',
        'Add-Type -AssemblyName System.Speech',
        '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        'if ($VoiceName) { try { $synth.SelectVoice($VoiceName) } catch {} }',
        '$synth.Rate = $Rate',
        '$synth.Volume = 100',
        '$synth.SetOutputToWaveFile($OutputFile)',
        '$synth.Speak([IO.File]::ReadAllText($InputFile))',
        '$synth.Dispose()'
      ].join(os.EOL);
      fs.writeFileSync(scriptFile, scriptBody, 'utf8');
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, inputFile, outputFile, String(finalVoice || ''), String(rate)], { windowsHide: true, timeout: 30000 }, (err) => {
        try { fs.unlinkSync(inputFile); } catch {}
        try { fs.unlinkSync(scriptFile); } catch {}
        if (err) return reject(err);
        try {
          const wav = fs.readFileSync(outputFile);
          try { fs.unlinkSync(outputFile); } catch {}
          resolve(wav);
        } catch (e) {
          reject(e);
        }
      });
    }).catch(reject);
  });
}

function listWindowsTtsVoices() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }',
      '$synth.Dispose()'
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(String(stdout || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean));
    });
  });
}

function listWindowsSttRecognizers() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Name }'
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(String(stdout || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean));
    });
  });
}

function transcribeWindowsStt(wavBase64) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Native STT is only bundled for Windows in this build.'));
    const b64 = String(wavBase64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
    if (!b64) return reject(new Error('No WAV audio supplied.'));
    const audio = Buffer.from(b64, 'base64');
    if (audio.length < 44 || audio.slice(0, 4).toString('ascii') !== 'RIFF' || audio.slice(8, 12).toString('ascii') !== 'WAVE') {
      return reject(new Error('Native STT expects 16-bit PCM WAV audio.'));
    }
    const sttDir = safeMkdir(path.join(dataRoot, 'cache', 'stt'));
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const inputFile = path.join(sttDir, `${id}.wav`);
    const outputFile = path.join(sttDir, `${id}.txt`);
    fs.writeFileSync(inputFile, audio);
    const scriptBody = [
      'param([string]$InputFile,[string]$OutputFile)',
      'Add-Type -AssemblyName System.Speech',
      '$infos = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()',
      'if (-not $infos -or $infos.Count -lt 1) { throw "No Windows speech recognizer is installed." }',
      '$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($infos[0])',
      '$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
      '$rec.SetInputToWaveFile($InputFile)',
      '$result = $rec.Recognize([TimeSpan]::FromSeconds(25))',
      '$text = if ($result) { $result.Text } else { "" }',
      '[IO.File]::WriteAllText($OutputFile, $text, [Text.Encoding]::UTF8)',
      '$rec.Dispose()'
    ].join('; ');
    const script = `& { ${scriptBody} }`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, inputFile, outputFile], { windowsHide: true, timeout: 35000 }, (err) => {
      try { fs.unlinkSync(inputFile); } catch {}
      if (err) return reject(err);
      try {
        const transcript = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8').trim() : '';
        try { fs.unlinkSync(outputFile); } catch {}
        resolve({ transcript, confidence: transcript ? 0.5 : 0, engine: 'Windows System.Speech DictationGrammar' });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function mcpConfigPath() {
  return path.join(dataRoot, 'mcp', 'mcp_servers.json');
}

function mergeMcpServers(servers, source) {
  const cfg = readJson(mcpConfigPath(), { mcpServers: {}, updated_at: null });
  const imported = [];
  const incoming = Array.isArray(servers)
    ? Object.fromEntries(servers.map((s) => [s.name || slug(s.command || source), s]))
    : (servers || {});
  for (const [name, spec] of Object.entries(incoming)) {
    const key = slug(name);
    cfg.mcpServers[key] = {
      command: spec.command || '',
      args: Array.isArray(spec.args) ? spec.args : [],
      env: spec.env || {},
      enabled: Boolean(spec.enabled),
      source,
      note: spec.note || spec._purpose || spec.description || ''
    };
    imported.push(key);
  }
  cfg.updated_at = new Date().toISOString();
  writeJson(mcpConfigPath(), cfg);
  return imported;
}

function slug(s) {
  return String(s || 'connector').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'connector';
}

function claudeConfigPath() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
}

function claudeMcpBridgePath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'mcp', 'abuz8-mcp-stdio.js') : null,
    path.join(__dirname, 'mcp', 'abuz8-mcp-stdio.js')
  ].filter(Boolean);
  return candidates.find((file) => exists(file)) || candidates[candidates.length - 1];
}

function bundledNodePath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'mcp', 'node.exe') : null,
    path.join(__dirname, 'mcp', 'node.exe'),
    process.execPath
  ].filter(Boolean);
  return candidates.find((file) => exists(file) && /node\.exe$/i.test(file)) || null;
}

function persistentClaudeBridge() {
  const dir = safeMkdir(path.join(dataRoot, 'mcp', 'abuz8-claude-bridge'));
  const bridgeSrc = claudeMcpBridgePath();
  const nodeSrc = bundledNodePath();
  const bridgeDest = path.join(dir, 'abuz8-mcp-stdio.js');
  const nodeDest = path.join(dir, 'node.exe');
  if (bridgeSrc && exists(bridgeSrc)) fs.copyFileSync(bridgeSrc, bridgeDest);
  if (nodeSrc && exists(nodeSrc)) fs.copyFileSync(nodeSrc, nodeDest);
  return { dir, bridge: bridgeDest, node: exists(nodeDest) ? nodeDest : null };
}

function installClaudeSymbiote() {
  const file = claudeConfigPath();
  const cfg = readJson(file, { mcpServers: {} });
  cfg.mcpServers = cfg.mcpServers || {};
  const bridge = persistentClaudeBridge();
  cfg.mcpServers.abuz8_os = {
    command: bridge.node || 'node',
    args: [bridge.bridge],
    env: {
      ABUZ8_CORE_URL: `http://127.0.0.1:${PORT}`
    }
  };
  safeMkdir(path.dirname(file));
  writeJson(file, cfg);
  return { file, server: cfg.mcpServers.abuz8_os };
}

function commandExists(command, args = ['--version']) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

function runCommand(command, args = [], timeout = 15000) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : 0,
        stdout: String(stdout || '').slice(0, 4000),
        stderr: String(stderr || err?.message || '').slice(0, 4000)
      });
    });
  });
}

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function resolveBrainDir() {
  const candidates = [
    process.env.ABUZ8_BRAIN_DIR,
    process.resourcesPath ? path.join(process.resourcesPath, 'brain') : null,
    path.join(__dirname, 'brain')
  ].filter(Boolean);
  return candidates.find((dir) => exists(path.join(dir, 'llama-server.exe'))) || candidates[candidates.length - 1];
}

function brainRuntimeFiles() {
  const dir = resolveBrainDir();
  return {
    dir,
    server: path.join(dir, 'llama-server.exe')
  };
}

function availableEmbeddedBrains() {
  const runtime = brainRuntimeFiles();
  const bundled = EMBEDDED_BRAIN_CATALOG.map((brain) => {
    const model = path.join(runtime.dir, brain.file);
    const present = exists(runtime.server) && exists(model);
    const size = present ? fs.statSync(model).size : 0;
    return {
      ...brain,
      embedded: present,
      model,
      model_file: brain.file,
      size_bytes: size,
      size_mb: Math.round(size / 1024 / 1024),
      runtime: exists(runtime.server) ? 'llama.cpp' : null,
      port: LFM_PORT
    };
  });
  const downloaded = dataRoot ? downloadedGgufBrains(runtime) : [];
  return bundled.concat(downloaded);
}

function downloadedGgufBrains(runtime) {
  const root = path.join(dataRoot, 'models');
  const found = [];
  const walk = (dir) => {
    if (!exists(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) found.push(full);
    }
  };
  walk(root);
  return found.map((model) => {
    const rel = path.relative(root, model).replace(/\\/g, '/');
    const id = `local-${slug(rel.replace(/\.gguf$/i, ''))}`;
    const size = fs.statSync(model).size;
    return {
      id,
      name: `Local GGUF: ${path.basename(model, '.gguf')}`,
      file: path.basename(model),
      tier: 'local',
      role: 'user-downloaded local brain stored inside portable data',
      min_ram_gb: Math.max(8, Math.ceil(size / 1024 / 1024 / 1024) * 3),
      context: 2048,
      embedded: exists(runtime.server),
      model,
      model_file: rel,
      size_bytes: size,
      size_mb: Math.round(size / 1024 / 1024),
      runtime: exists(runtime.server) ? 'llama.cpp' : null,
      port: LFM_PORT,
      user_model: true
    };
  });
}

function selectEmbeddedBrain() {
  const cfg = dataRoot ? readRuntimeConfig() : {};
  const requested = String(
    cfg.selected_brain ||
    cfg.selected_brain_tier ||
    process.env.ABUZ8_BRAIN_TIER ||
    process.env.ABUZ8_BRAIN ||
    ''
  ).toLowerCase();
  const available = availableEmbeddedBrains().filter((b) => b.embedded);
  if (!available.length) return null;
  if (requested) {
    const exact = available.find((b) => [b.id, b.tier, b.name.toLowerCase(), String(b.model_file || '').toLowerCase()].includes(requested));
    if (exact) return exact;
  }
  const totalGb = os.totalmem() / 1024 / 1024 / 1024;
  return available
    .filter((b) => totalGb >= b.min_ram_gb)
    .sort((a, b) => b.min_ram_gb - a.min_ram_gb)[0]
    || available.sort((a, b) => a.min_ram_gb - b.min_ram_gb)[0];
}

function stopEmbeddedBrain() {
  if (lfmProcess) {
    try { lfmProcess.kill(); } catch {}
  }
  lfmProcess = null;
  lfmStarting = false;
}

function setActiveBrain(requested) {
  const key = String(requested || '').trim().toLowerCase();
  if (!key || key === 'auto') {
    writeRuntimeConfigPatch({ selected_brain: 'auto', selected_brain_name: 'Auto' });
    stopEmbeddedBrain();
    activeBrain = selectEmbeddedBrain();
    return { ok: true, selected: embeddedBrainStatus(), restarted: true };
  }
  const brain = availableEmbeddedBrains().find((b) =>
    [b.id, b.tier, b.name.toLowerCase(), b.model_file.toLowerCase()].includes(key)
  );
  if (!brain) throw new Error(`Unknown brain: ${requested}`);
  if (!brain.embedded) throw new Error(`Brain is not bundled in this build: ${brain.name}`);
  writeRuntimeConfigPatch({ selected_brain: brain.id, selected_brain_name: brain.name, selected_brain_tier: brain.tier });
  stopEmbeddedBrain();
  activeBrain = brain;
  return { ok: true, selected: embeddedBrainStatus(), restarted: true };
}

function embeddedBrainStatus() {
  const selected = activeBrain || selectEmbeddedBrain();
  const brains = availableEmbeddedBrains();
  const present = Boolean(selected);
  return {
    id: selected?.id || 'embedded-lfm',
    name: selected?.name || 'Embedded LFM',
    status: present ? (lfmProcess ? 'online' : (lfmStarting ? 'warming' : 'ready')) : 'missing',
    alive: Boolean(lfmProcess),
    embedded: present,
    kind: 'offline-gguf',
    port: LFM_PORT,
    tier: selected?.tier || null,
    role: selected?.role || null,
    model_file: selected?.model_file || null,
    size_mb: selected?.size_mb || 0,
    runtime: selected?.runtime || null,
    available: brains.map((b) => ({
      id: b.id,
      name: b.name,
      tier: b.tier,
      status: b.embedded ? 'ready' : 'missing',
      embedded: b.embedded,
      size_mb: b.size_mb,
      model_file: b.model_file,
      min_ram_gb: b.min_ram_gb,
      role: b.role
    }))
  };
}

function httpJson(method, port, pathname, body, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(out || '{}')); } catch { resolve({ content: out }); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForLfm(ms = 45000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    try {
      await httpJson('GET', LFM_PORT, '/health', null, 2000);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  return false;
}

async function ensureEmbeddedBrain() {
  if (lfmProcess) return true;
  if (lfmStarting) return waitForLfm(20000);
  const files = brainRuntimeFiles();
  const selected = selectEmbeddedBrain();
  if (!exists(files.server) || !selected || !exists(selected.model)) {
    lastLfmError = 'Embedded LFM runtime or model file is missing.';
    return false;
  }
  activeBrain = selected;
  lfmStarting = true;
  lastLfmError = '';
  const args = [
    '-m', selected.model,
    '--host', '127.0.0.1',
    '--port', String(LFM_PORT),
    '-c', String(selected.context || 2048),
    '-ngl', '0',
    '--threads', String(Math.max(2, Math.min(8, os.cpus().length || 4)))
  ];
  try {
    lfmProcess = spawn(files.server, args, { cwd: files.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    lfmProcess.once('error', (e) => {
      lastLfmError = e.message;
      lfmProcess = null;
      lfmStarting = false;
    });
    lfmProcess.stderr.on('data', (d) => {
      const line = String(d).trim();
      if (line) lastLfmError = line.slice(-500);
    });
    lfmProcess.once('exit', (code) => {
      lastLfmError = `LFM runtime exited with code ${code}`;
      lfmProcess = null;
      lfmStarting = false;
    });
    const ready = await waitForLfm();
    lfmStarting = false;
    return ready;
  } catch (e) {
    lastLfmError = e.message;
    lfmProcess = null;
    lfmStarting = false;
    return false;
  }
}

function agentToolInstructions() {
  return [
    'You are ABUZ8 OS Agent, a consumer desktop agent running on this device.',
    'The mind framework controls memory, tasks, personality, and project missions. The embedded LFM model is only an internal reasoning engine; never identify yourself as the LFM brain.',
    `Current device time is ${new Date().toString()}.`,
    'You can request exactly one tool call by returning ONLY compact JSON in this shape:',
    '{"tool":"tool_name","args":{}}',
    'If no tool is needed, return normal helpful text.',
    'Available tools:',
    '- abuz8_device_probe {}',
    '- abuz8_memory_write {"content":"..."}',
    '- abuz8_mission_board {}',
    '- abuz8_mission_task_create {"title":"...","column":"ready","priority":"medium","details":"..."}',
    '- model_download_hf {"repo":"org/repo","file":"model.gguf","allow_network_download":true}',
    '- cloud_brain_register {"provider":"openai|anthropic|custom","endpoint":"https://...","model":"...","api_key_env":"ENV_NAME","allow_cloud_brain":true}',
    '- web_search {"query":"current topic"}',
    '- open_url {"url":"https://example.com"}',
    '- open_app {"name":"notepad|mspaint|chrome|edge|browser|calc|explorer"}',
    '- draw_cartoon_rabbit_in_paint {"caption":"optional caption"}',
    '- screenshot {}',
    '- file_write {"relpath":"notes/example.txt","content":"..."}',
    '- shell_run {"cmd":"whoami|hostname|dir"}',
    'Action tools require the user to enable Allow actions for this session. Never invent unsupported tools. For protected characters, create an original safe drawing instead of claiming to copy the exact character.',
    ''
  ].join('\n');
}

async function embeddedReply(prompt, opts = {}) {
  const ready = await ensureEmbeddedBrain();
  if (!ready) return null;
  const brain = activeBrain || selectEmbeddedBrain();
  const modelPrompt = opts.agentic
    ? `${agentToolInstructions()}\nUser: ${prompt}\nAssistant:`
    : [
      'You are ABUZ8 OS Agent. Speak as the agent, not as a model.',
      'The framework is the mind: memory, tasks, personality, and project missions. The embedded LFM model is just an internal reasoning engine.',
      `Current device time is ${new Date().toString()}.`,
      'Be concise, clear, practical, and calm. If the user asks for current outside information and no tool result is provided, say you need web search.',
      '',
      `User: ${prompt}`,
      'Assistant:'
    ].join('\n');
  for (let i = 0; i < 3; i++) {
    try {
      const out = await httpJson('POST', LFM_PORT, '/completion', {
        prompt: modelPrompt,
        n_predict: 220,
        temperature: 0.35,
        stop: ['User:', '\n\nUser:']
      }, 90000);
      const textOut = out.content || out.response || out.text || '';
      const cleaned = cleanAgentText(textOut);
      if (cleaned) return cleaned;
    } catch (e) {
      lastLfmError = e.message;
    }
    try {
      const out = await httpJson('POST', LFM_PORT, '/v1/completions', {
        prompt: modelPrompt,
        max_tokens: 220,
        temperature: 0.35,
        stop: ['User:', '\n\nUser:']
      }, 90000);
      const textOut = out.choices && out.choices[0] ? out.choices[0].text : '';
      const cleaned = cleanAgentText(textOut);
      if (cleaned) return cleaned;
    } catch (e) {
      lastLfmError = e.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return null;
}

function cleanAgentText(text) {
  let out = String(text || '').replace(/\r/g, '').trim();
  const responseBlock = out.match(/<response>\s*([\s\S]*?)\s*<\/response>/i);
  if (responseBlock) out = responseBlock[1].trim();
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<tool>[\s\S]*?<\/tool>/gi, '').trim();
  out = out.replace(/^Assistant:\s*/i, '').replace(/^ABUZ8 OS Agent:\s*/i, '').trim();
  out = out.replace(/\n?User:\s*[\s\S]*$/i, '').trim();
  out = out.replace(/\b(LFM2?|Liquid Foundation Model)\s*(2\.6B|brain|model)?\b/gi, 'embedded reasoning engine');
  const words = out.split(/\s+/).filter(Boolean);
  const weird = (out.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
  if (out.length < 2 || weird > Math.max(12, out.length * 0.18)) return '';
  if (words.length > 8 && new Set(words.slice(0, 40).map((w) => w.toLowerCase())).size < 4) return '';
  return out;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  if (candidate.startsWith('{') && candidate.endsWith('}')) {
    try { return JSON.parse(candidate); } catch {}
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
  }
  return null;
}

function parseAgentToolCall(text) {
  const parsed = extractJsonObject(text);
  if (!parsed || !parsed.tool) return null;
  const tool = String(parsed.tool || '').trim();
  const args = parsed.args && typeof parsed.args === 'object' ? parsed.args : {};
  return { tool, args };
}

function normalizedSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchMemoryItems(query, limit = 20) {
  const q = normalizedSearchText(query);
  if (!q) return readMemory(limit);
  const tokens = q.split(' ').filter((t) => t.length > 1);
  return readMemory(500).filter((m) => {
    const hay = normalizedSearchText(JSON.stringify(m));
    if (hay.includes(q)) return true;
    return tokens.length > 0 && tokens.every((t) => hay.includes(t));
  }).slice(0, limit);
}

function inferConsumerToolCall(prompt) {
  const msg = String(prompt || '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return null;
  if (lower === '/probe' || /\b(probe|scan|check)\b.*\b(device|computer|system|machine|hardware)\b/.test(lower)) {
    return { tool: 'abuz8_device_probe', args: {} };
  }
  if (/\b(open|launch|start)\b.*\b(chrome|google chrome)\b/.test(lower)) return { tool: 'open_app', args: { name: 'chrome' } };
  if (/\b(open|launch|start)\b.*\b(edge|microsoft edge)\b/.test(lower)) return { tool: 'open_app', args: { name: 'edge' } };
  if (/\b(open|launch|start)\b.*\b(browser|web browser)\b/.test(lower)) return { tool: 'open_app', args: { name: 'browser' } };
  if (/\b(draw|paint|create)\b.*\bmonkey\b/.test(lower) && /\b(paint|mspaint|microsoft paint)\b/.test(lower)) {
    return { tool: 'draw_monkey_in_paint', args: { caption: 'ABUZ8 OS local desktop action proof' } };
  }
  if (/\b(draw|paint|create)\b.*\b(bugs bunny|bunny|rabbit|cartoon rabbit)\b/.test(lower) && /\b(paint|mspaint|microsoft paint)\b/.test(lower)) {
    return { tool: 'draw_cartoon_rabbit_in_paint', args: { caption: 'Original cartoon rabbit - ABUZ8 OS' } };
  }
  if (/\b(open|launch|start)\b.*\b(paint|mspaint)\b/.test(lower)) return { tool: 'open_app', args: { name: 'mspaint' } };
  if (/\b(open|launch|start)\b.*\bnotepad\b/.test(lower)) return { tool: 'open_app', args: { name: 'notepad' } };
  if (/\b(open|launch|start)\b.*\b(calc|calculator)\b/.test(lower)) return { tool: 'open_app', args: { name: 'calc' } };
  if (/\b(open|launch|start)\b.*\b(explorer|file explorer|files)\b/.test(lower)) return { tool: 'open_app', args: { name: 'explorer' } };
  if (/\b(screenshot|screen shot|capture screen)\b/.test(lower)) return { tool: 'screenshot', args: {} };
  const urlMatch = msg.match(/\bhttps?:\/\/[^\s"'<>]+/i);
  if (urlMatch && /\b(open|visit|go to|browse)\b/i.test(msg)) return { tool: 'open_url', args: { url: urlMatch[0] } };
  if (/\b(search|look up|google|duckduckgo|internet|online|current|latest|today|news|who is|what is)\b/i.test(msg)) {
    const q = msg.replace(/\b(search|look up|google|duckduckgo|the|web|internet|online|for|show me|show|open|browser|in the browser|in browser)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (q) return { tool: 'web_search', args: { query: q, open_browser: /\b(show|open|browser|watch|see)\b/i.test(msg) } };
  }
  if (/\b(hostname|machine name)\b/.test(lower)) return { tool: 'shell_run', args: { cmd: 'hostname' } };
  if (/\b(whoami|current user)\b/.test(lower)) return { tool: 'shell_run', args: { cmd: 'whoami' } };
  if (/\b(list|show)\b.*\b(directory|folder|files)\b/.test(lower)) return { tool: 'shell_run', args: { cmd: 'dir' } };
  return null;
}

function summarizeToolResult(tool, result) {
  const payload = result?.result ?? result;
  if (tool === 'open_app') return `Done. Opened ${payload.app || payload.file || 'the requested app'}.`;
  if (tool === 'draw_monkey_in_paint') return `Done. Drew a monkey image and opened it in Paint: ${payload.file}.`;
  if (tool === 'draw_cartoon_rabbit_in_paint') return `Done. Drew an original cartoon rabbit and opened it in Paint: ${payload.file}.`;
  if (tool === 'open_url') return `Done. Opened ${payload.url || 'the requested URL'} in the default browser.`;
  if (tool === 'web_search') {
    const lines = [];
    if (payload.answer) lines.push(payload.answer);
    if (payload.related && payload.related.length) lines.push(payload.related.slice(0, 3).map((r, i) => `${i + 1}. ${r.text}`).join('\n'));
    if (payload.opened?.ok) lines.push('I also opened the source/search page in the browser.');
    if (!lines.length || (lines.length === 1 && String(lines[0]).startsWith('Source:'))) lines.unshift(`I searched for "${payload.query || 'your query'}". No instant answer came back, so use the source/search page for the live results.`);
    lines.push(`Source: ${payload.url || payload.source || 'web search'}`);
    return lines.filter(Boolean).join('\n\n');
  }
  if (tool === 'screenshot') return `Done. Screenshot saved to ${payload.file}.`;
  if (tool === 'file_write') return `Done. Wrote ${payload.bytes || 0} bytes to ${payload.file}.`;
  if (tool === 'shell_run') return `Done.\n\n${String(payload.stdout || '').trim()}`;
  if (tool === 'abuz8_device_probe') {
    return `Device probe complete: ${payload.system?.hostname || os.hostname()} · ${payload.cpu?.name || 'CPU'} · ${payload.memory?.total_gb || '?'}GB RAM · tier ${payload.tier || 'unknown'}.`;
  }
  if (tool === 'abuz8_mission_board') return `Mission board loaded. ${payload.summary || ''}`.trim();
  return `Tool ${tool} completed.\n\n${JSON.stringify(payload, null, 2)}`;
}

async function agenticReply(prompt, opts = {}) {
  const direct = inferConsumerToolCall(prompt);
  if (!direct && /\b(date|time|today|now)\b/i.test(String(prompt || ''))) {
    return { response: localReply(prompt), modelResponse: null, tool_call: null, tool_result: null, fallback: false };
  }
  if (!direct) {
    const modelResponse = await embeddedReply(prompt, { agentic: false });
    return { response: modelResponse || localReply(prompt), modelResponse, tool_call: null, tool_result: null, fallback: !modelResponse };
  }
  const requested = direct;
  try {
    const toolResult = await callLocalTool(requested.tool, requested.args || {});
    return {
      response: summarizeToolResult(requested.tool, toolResult),
      modelResponse: null,
      tool_call: requested,
      tool_result: toolResult,
      fallback: false
    };
  } catch (e) {
    const blocked = /Allow actions|blocked|Allowed|consent/i.test(e.message || '');
    return {
      response: blocked
        ? `I can do that, but real-world actions are locked until you turn on Allow actions for this session. ${e.message}`
        : `I tried to run ${requested.tool}, but it failed: ${e.message}`,
      modelResponse: null,
      tool_call: requested,
      tool_error: e.message,
      fallback: false
    };
  }
}

function localReply(prompt) {
  const msg = String(prompt || '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return 'Portable Core is online. Type a task, ask for a file operation, or import MCP connectors from the Migration view.';
  if (/\b(date|time|today|now)\b/.test(lower)) {
    return `It is ${new Date().toLocaleString()} on this computer.`;
  }
  if (lower.includes('mcp') || lower.includes('connector')) {
    return `Portable Core is online. Use Migration -> Import Local Connectors to copy Claude Desktop MCP entries into ${mcpConfigPath()}. Docker MCP is imported when Docker Desktop exposes "docker mcp".`;
  }
  if (lower.includes('gpu') || lower.includes('avatar') || lower.includes('render')) {
    return 'For GPU-heavy avatar/rendering work, this build uses a fallback ladder: browser preview first, cloud/API renderer second, ComfyUI/NVIDIA worker only when a GPU runtime is connected. The OS stays usable without GPU.';
  }
  if (lower.includes('model') || lower.includes('brain')) {
    return 'The native LFM2 2.6B GGUF brain stays primary in this build. Cloud or extra local brains can be added as hybrid engines, but they do not replace the bundled brain.';
  }
  return `I received: "${msg}"\n\nThe local agent core is active. Memory, MCP config, skills, logs, models, and workspaces are stored only on this device under:\n${dataRoot}\n\nIf this needs current outside information, ask me to search the web or use the Migration view to connect your own providers.`;
}

function sendSse(res, payload, brain = 'Portable Core') {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*'
  });
  const chunks = String(payload).match(/.{1,36}(\s|$)|.{1,36}/g) || [String(payload)];
  let i = 0;
  const tick = () => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify({ delta: chunks[i++] })}\n\n`);
      setTimeout(tick, 18);
    } else {
      res.write(`data: ${JSON.stringify({ done: true, brain, latency_ms: 1 })}\n\n`);
      res.end();
    }
  };
  tick();
}

function sendTui(res) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ABUZ8 Local TUI</title>
  <style>
    :root{color-scheme:dark;font-family:Consolas, ui-monospace, monospace;background:#050907;color:#d9f8ea}
    body{margin:0;padding:16px;background:#050907}
    header{display:flex;align-items:center;gap:10px;border-bottom:1px solid #254136;padding-bottom:10px;margin-bottom:12px}
    .dot{width:8px;height:8px;border-radius:50%;background:#19e0ad;box-shadow:0 0 16px #19e0ad}
    h1{font-size:14px;margin:0;color:#f2d27a;letter-spacing:.02em}
    #log{height:calc(100vh - 118px);overflow:auto;white-space:pre-wrap;line-height:1.5;font-size:13px}
    form{display:flex;gap:8px;position:fixed;left:12px;right:12px;bottom:12px}
    input{flex:1;background:#0b1411;border:1px solid #254136;color:#d9f8ea;border-radius:8px;padding:10px;font:inherit}
    button{background:#19e0ad;color:#03100c;border:0;border-radius:8px;padding:10px 14px;font-weight:700}
    .sys{color:#72d7b9}.user{color:#f2d27a}.agent{color:#d9f8ea}.err{color:#ff746a}
  </style>
</head>
<body>
  <header><span class="dot"></span><h1>ABUZ8 LOCAL TUI - 127.0.0.1:${PORT}</h1></header>
  <main id="log"><span class="sys">Portable Core online. Native LFM brain remains primary. Type a prompt or action command.</span></main>
  <form id="f"><input id="q" autocomplete="off" placeholder="Ask, /probe, open Paint, draw a monkey in Paint..."><button>Send</button></form>
  <script>
    const log=document.getElementById('log'), q=document.getElementById('q'), f=document.getElementById('f');
    function line(cls, text){ const d=document.createElement('div'); d.className=cls; d.textContent='\\n'+text; log.appendChild(d); log.scrollTop=log.scrollHeight; }
    f.onsubmit=async(e)=>{ e.preventDefault(); const text=q.value.trim(); if(!text)return; q.value=''; line('user','> '+text); try{ const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:text,agentic:true})}); const j=await r.json(); line(j.ok?'agent':'err', (j.brain||'core')+': '+(j.response||j.error||JSON.stringify(j))); }catch(err){ line('err','error: '+err.message); } };
  </script>
</body>
</html>`;
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*'
  });
  res.end(html);
}

function memoryFile() {
  return path.join(dataRoot, 'memory', 'events.jsonl');
}

function readMemory(limit = 20) {
  try {
    const lines = fs.readFileSync(memoryFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l)).reverse();
  } catch {
    return [];
  }
}

function detectGpuNames() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

function storageSummary() {
  try {
    const s = fs.statfsSync(dataRoot);
    return {
      data_root: dataRoot,
      free_gb: Math.round((s.bavail * s.bsize) / 1024 / 1024 / 1024),
      total_gb: Math.round((s.blocks * s.bsize) / 1024 / 1024 / 1024)
    };
  } catch {
    return { data_root: dataRoot, free_gb: null, total_gb: null };
  }
}

function cleanSegment(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join(path.sep) || 'model';
}

function huggingFaceUrl(body) {
  if (body.url) return String(body.url);
  const repo = String(body.repo || '').replace(/^https:\/\/huggingface\.co\//, '').replace(/^hf:\/\//, '');
  const file = String(body.file || body.filename || '');
  if (!repo || !file) return '';
  const revision = encodeURIComponent(body.revision || 'main');
  return `https://huggingface.co/${repo}/resolve/${revision}/${file}?download=true`;
}

function downloadFile(url, dest, token) {
  return new Promise((resolve, reject) => {
    safeMkdir(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    const request = https.get(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        file.close(() => fs.rm(dest, { force: true }, () => {}));
        return resolve(downloadFile(new URL(response.headers.location, url).toString(), dest, token));
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        file.close(() => fs.rm(dest, { force: true }, () => {}));
        return reject(new Error(`download failed with HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve({ bytes: fs.statSync(dest).size })));
    });
    request.on('error', (e) => {
      file.close(() => fs.rm(dest, { force: true }, () => {}));
      reject(e);
    });
  });
}

function listDownloadedModels() {
  const root = path.join(dataRoot, 'models');
  const rows = [];
  function walk(dir) {
    if (!exists(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(gguf|onnx|safetensors|bin)$/i.test(entry.name)) {
        const st = fs.statSync(full);
        rows.push({ name: entry.name, path: full, size_mb: Math.round(st.size / 1024 / 1024), modified_at: st.mtime.toISOString() });
      }
    }
  }
  walk(root);
  return rows;
}

async function downloadHuggingFaceModel(body = {}) {
  if (!body.allow_network_download) {
    throw new Error('allow_network_download must be true before downloading model files.');
  }
  const url = huggingFaceUrl(body);
  if (!url || !url.startsWith('https://huggingface.co/')) {
    throw new Error('Provide a Hugging Face repo+file or a direct https://huggingface.co/... model URL.');
  }
  const repoName = cleanSegment(body.repo || 'direct-download');
  const fileName = path.basename(new URL(url).pathname) || cleanSegment(body.file || 'model.gguf');
  const dest = path.join(dataRoot, 'models', 'huggingface', repoName, fileName);
  const result = await downloadFile(url, dest, body.token || process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN);
  return {
    ok: true,
    url,
    path: dest,
    size_mb: Math.round(result.bytes / 1024 / 1024),
    selectable_brain_id: fileName.toLowerCase().endsWith('.gguf') ? `local-${slug(path.relative(path.join(dataRoot, 'models'), dest).replace(/\.gguf$/i, ''))}` : null,
    note: 'Downloaded locally. GGUF files in the portable model shelf are selectable as local brains.'
  };
}

function registerCloudBrain(body = {}) {
  if (!body.allow_cloud_brain) throw new Error('allow_cloud_brain must be true before registering a cloud brain.');
  const id = slug(body.id || body.name || body.provider || `cloud-${Date.now()}`);
  if (!id) throw new Error('cloud brain id/name is required.');
  if (!body.endpoint && !body.provider) throw new Error('provider or endpoint is required.');
  const record = {
    id,
    name: body.name || id,
    provider: body.provider || 'custom',
    endpoint: body.endpoint || '',
    model: body.model || '',
    api_key_env: body.api_key_env || '',
    status: 'registered',
    registered_at: new Date().toISOString()
  };
  writeJson(path.join(dataRoot, 'config', 'cloud-brains', `${id}.json`), record);
  return { ok: true, cloud_brain: record, dir: path.join(dataRoot, 'config', 'cloud-brains') };
}

async function machineProbe() {
  const gpus = await detectGpuNames();
  const totalGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  const cpuName = os.cpus()[0]?.model || 'CPU';
  const gpuText = gpus.join(' ').toLowerCase();
  const hasNvidia = gpuText.includes('nvidia') || gpuText.includes('rtx') || gpuText.includes('gtx');
  const hasDiscreteGpu = hasNvidia || gpuText.includes('radeon') || gpuText.includes('arc');
  const tier = totalGb >= 32 && hasDiscreteGpu ? 'workstation'
    : totalGb >= 16 ? 'creator laptop'
    : totalGb >= 8 ? 'mobile edge'
    : 'lightweight';
  const embedded = embeddedBrainStatus();
  const docker = await commandExists('docker', ['--version']);
  const dockerMcp = docker ? await commandExists('docker', ['mcp', '--help']) : false;
  const ollama = await commandExists('ollama', ['--version']);
  const node = await commandExists('node', ['--version']);
  const python = await commandExists('python', ['--version']);
  const storage = storageSummary();
  const bundled = embedded.available || [];
  const can = [
    { id: 'offline-chat', label: embedded.embedded ? 'Offline sovereign brain' : 'Portable fallback brain', status: embedded.embedded ? 'ready' : 'fallback', detail: embedded.embedded ? `${embedded.name} (${embedded.tier}) is selected. ${bundled.filter((b) => b.embedded).length} LFM tier(s) are bundled and run through llama.cpp.` : 'No GGUF model bundled; Portable Core still answers and routes tools.' },
    { id: 'memory', label: 'Local memory', status: 'ready', detail: `Memory, MCP, logs, models, workspaces, and exports live under ${dataRoot}.` },
    { id: 'mcp', label: 'MCP connector import', status: 'ready', detail: 'Can import Claude Desktop MCP config; Docker MCP imports when Docker Desktop MCP Toolkit is installed.' },
    { id: 'files', label: 'Files and workspaces', status: 'ready', detail: 'App-local folders are created on first run for portable or installed mode.' },
    { id: 'avatar', label: 'Avatar/rendering', status: hasDiscreteGpu ? 'gpu-ready' : 'fallback', detail: hasDiscreteGpu ? 'GPU detected; connect ComfyUI or a render worker for heavy video/avatar jobs.' : 'No strong GPU detected; browser preview/TTS and cloud/API rendering are the default.' },
    { id: 'docker', label: 'Docker tools', status: docker ? (dockerMcp ? 'mcp-ready' : 'docker-ready') : 'optional', detail: docker ? 'Docker is available on this device.' : 'Docker Desktop not detected; Docker MCP is optional.' },
    { id: 'local-dev', label: 'Local developer tools', status: node || python ? 'ready' : 'limited', detail: `Node: ${node ? 'yes' : 'no'} · Python: ${python ? 'yes' : 'no'}` }
  ];
  const recommended = [
    totalGb < 8 ? 'Use lightweight mode and keep the embedded model responses short.' : 'Use the embedded LFM brain for local planning and tool routing.',
    hasDiscreteGpu ? 'Enable GPU renderer connectors for avatar/video jobs.' : 'Use CPU/browser previews for avatar work; connect cloud rendering only when needed.',
    dockerMcp ? 'Import Docker Desktop MCP from Migration.' : 'Import Claude Desktop MCP first, then add Docker MCP if Docker Desktop is installed.'
  ];
  return {
    ok: true,
    tier,
    headline: `This device is classified as ${tier}.`,
    system: { os_family: os.type(), os_release: os.release(), arch: os.arch(), hostname: os.hostname() },
    cpu: { name: cpuName, cores: os.cpus().length },
    memory: { total_gb: totalGb },
    storage,
    gpus: gpus.map((name) => ({ name })),
    embedded_brain: embedded,
    brain_tiers: bundled,
    connectors: { docker, docker_mcp: dockerMcp, ollama, node, python },
    capabilities: can,
    recommended
  };
}

async function route(req, res) {
  const { pathname, searchParams } = splitPath(req.url);
  if (req.method === 'OPTIONS') return text(res, 204, '');

  if (pathname === '/tui') return sendTui(res);
  if (pathname === '/' || pathname === '/health') {
    return json(res, 200, { ok: true, service: 'portable-core', port: PORT, data_root: dataRoot });
  }
  if (pathname === '/api/status') {
    const embedded = embeddedBrainStatus();
    return json(res, 200, {
      ok: true,
      service: 'abuz8-agent-core',
      primary_brain: embedded.embedded ? embedded.name : 'Local reasoning engine',
      brain: 'ABUZ8 OS Agent',
      agent: 'ABUZ8 OS Agent',
      latency_ms: 1,
      memory_count: readMemory(200).length,
      data_root: dataRoot,
      mcp_config: mcpConfigPath(),
      current_time: new Date().toISOString(),
      embedded_brain: embedded
    });
  }
  if (pathname === '/api/chat' || pathname === '/api/chat/stream') {
    const body = await getBody(req);
    const prompt = body.content || body.message || body.prompt || body.raw;
    const agentic = body.agentic !== false;
    const result = agentic
      ? await agenticReply(prompt, body)
      : { response: await embeddedReply(prompt) || localReply(prompt), modelResponse: null, fallback: false };
    const response = result.response;
    appendJsonl(memoryFile(), {
      id: crypto.randomUUID(),
      type: 'chat',
      content: body.content || body.message || '',
      response,
      tool_call: result.tool_call || null,
      tool_error: result.tool_error || null,
      timestamp: new Date().toISOString()
    });
    const embedded = embeddedBrainStatus();
    if (pathname.endsWith('/stream')) return sendSse(res, response, 'ABUZ8 OS Agent');
    return json(res, 200, {
      ok: true,
      response,
      brain: 'ABUZ8 OS Agent',
      reasoning_engine: result.modelResponse ? embedded.name : 'Portable Core',
      latency_ms: result.modelResponse ? null : 1,
      embedded_brain: embedded,
      fallback: Boolean(result.fallback),
      tool_call: result.tool_call || null,
      tool_result: result.tool_result || null,
      tool_error: result.tool_error || null
    });
  }
  if (pathname === '/api/onboarding/brains' || pathname === '/api/brains/list') {
    const embedded = embeddedBrainStatus();
    const lfmBrains = (embedded.available || []).map((b) => ({
      id: b.id,
      name: b.name,
      status: b.embedded ? (embedded.id === b.id ? embedded.status : 'ready') : 'missing',
      alive: embedded.id === b.id && embedded.alive,
      kind: 'offline-gguf',
      tier: b.tier,
      port: LFM_PORT,
      size_mb: b.size_mb,
      model_file: b.model_file,
      role: b.role
    }));
    const brains = [
      { id: 'portable-core', name: 'Portable Core', status: 'online', alive: true, kind: 'Portable Core', port: PORT, models: ['portable-core'] },
      ...lfmBrains
    ];
    return json(res, 200, { ok: true, brains, local: brains, cloud: [] });
  }
  if (pathname === '/api/brains/select') {
    const body = await getBody(req);
    try {
      return json(res, 200, setActiveBrain(body.brain || body.id || body.tier || body.name || 'auto'));
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message, brains: embeddedBrainStatus().available || [] });
    }
  }
  if (pathname === '/api/device/probe' || pathname === '/api/capabilities/probe') {
    return json(res, 200, await machineProbe());
  }
  if (pathname === '/api/mind/status') {
    const board = readMissionBoard();
    return json(res, 200, {
      ok: true,
      agent: 'ABUZ8 OS Agent',
      current_time: new Date().toISOString(),
      framework: 'four-layer local mind',
      layers: [
        { id: 'memory', name: 'Memory', status: 'ready', count: readMemory(500).length, storage: path.join(dataRoot, 'memory') },
        { id: 'tasks', name: 'Tasks', status: 'ready', summary: missionSummary(board), storage: missionFile() },
        { id: 'personality', name: 'Personality', status: 'ready', active: readRuntimeConfig().active_soul || 'default', storage: path.join(dataRoot, 'config') },
        { id: 'missions', name: 'Project missions', status: 'ready', columns: Object.fromEntries(Object.entries(board.columns || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])), storage: path.join(dataRoot, 'mission') }
      ],
      data_root: dataRoot
    });
  }
  if (pathname === '/api/optional-probe') {
    return json(res, 200, { ok: false, optional: true, manual: true, port: searchParams.get('port') || null });
  }
  if (pathname === '/api/memory/recent' || pathname === '/api/memory/all') {
    return json(res, 200, { ok: true, memories: readMemory(Number(searchParams.get('limit') || 20)), data_root: dataRoot });
  }
  if (pathname === '/api/memory/facts') {
    return json(res, 200, { ok: true, facts: readMemory(50).map((m) => ({ content: m.content || m.response || '', timestamp: m.timestamp })) });
  }
  if (pathname === '/api/memory/write') {
    const body = await getBody(req);
    const item = { id: crypto.randomUUID(), type: body.type || 'note', content: body.content || body.text || body.raw || '', timestamp: new Date().toISOString() };
    appendJsonl(memoryFile(), item);
    return json(res, 200, { ok: true, item });
  }
  if (pathname === '/api/memory/search' || pathname === '/api/memory/similar') {
    const q = searchParams.get('q') || searchParams.get('to') || '';
    return json(res, 200, { ok: true, results: searchMemoryItems(q, 20) });
  }
  if (pathname === '/mcp/tools' || pathname === '/api/mcp/tools') {
    return json(res, 200, { ok: true, tools: localToolsList().filter((t) => t.type === 'mcp'), all_tools_endpoint: '/api/tools/list' });
  }
  if (pathname === '/api/mcp/install') {
    const body = await getBody(req);
    const imported = mergeMcpServers(body.servers || body.mcpServers || {}, 'catalog');
    return json(res, 200, { ok: true, imported, mcp_config: mcpConfigPath() });
  }
  if (pathname === '/api/mcp/import/claude-desktop') {
    const file = claudeConfigPath();
    if (!fs.existsSync(file)) return json(res, 200, { ok: false, imported: 0, merged: [], error: `Claude Desktop config not found at ${file}` });
    const cfg = readJson(file, {});
    const imported = mergeMcpServers(cfg.mcpServers || {}, 'claude-desktop');
    return json(res, 200, { ok: true, imported: imported.length, merged: imported, source: file, mcp_config: mcpConfigPath() });
  }
  if (pathname === '/api/mcp/import/docker-desktop') {
    const available = await commandExists('docker', ['mcp', '--help']);
    if (!available) return json(res, 200, { ok: false, merged: [], error: 'Docker Desktop MCP Toolkit was not detected on this machine.' });
    const imported = mergeMcpServers({ 'docker-desktop-gateway': { command: 'docker', args: ['mcp', 'gateway', 'run', '--block-secrets', '--transport', 'stdio'], enabled: false, note: 'Docker Desktop MCP gateway' } }, 'docker-desktop');
    return json(res, 200, { ok: true, merged: imported, mcp_config: mcpConfigPath() });
  }
  if (pathname === '/api/mcp/install/claude-symbiote' || pathname === '/api/mcp/export/claude-desktop') {
    const installed = installClaudeSymbiote();
    return json(res, 200, {
      ok: true,
      message: 'ABUZ8 OS MCP symbiote was added to Claude Desktop. Restart Claude Desktop to load it.',
      claude_config: installed.file,
      server: installed.server
    });
  }
  if (pathname === '/api/models/list') {
    return json(res, 200, { ok: true, models: listDownloadedModels(), embedded: embeddedBrainStatus().available || [] });
  }
  if (pathname === '/api/models/huggingface/download') {
    const body = await getBody(req);
    try {
      return json(res, 200, await downloadHuggingFaceModel(body));
    } catch (e) {
      const status = /allow_network_download/i.test(e.message) ? 403 : 400;
      return json(res, status, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/cloud-brains/register') {
    const body = await getBody(req);
    try {
      return json(res, 200, registerCloudBrain(body));
    } catch (e) {
      const status = /allow_cloud_brain/i.test(e.message) ? 403 : 400;
      return json(res, status, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/cli/probe') {
    const body = await getBody(req);
    if (!body.allow_cli) {
      return json(res, 403, { ok: false, error: 'allow_cli must be true before executing a local CLI command.' });
    }
    const command = String(body.command || '').trim();
    const args = Array.isArray(body.args) ? body.args.map(String) : ['--version'];
    if (!command) return json(res, 400, { ok: false, error: 'command is required' });
    return json(res, 200, { ok: true, command, args, result: await runCommand(command, args, Number(body.timeout || 15000)) });
  }
  if (pathname === '/api/cli/register') {
    const body = await getBody(req);
    if (!body.allow_cli) {
      return json(res, 403, { ok: false, error: 'allow_cli must be true before registering a local CLI connector.' });
    }
    const id = slug(body.id || body.name || body.command || `cli-${Date.now()}`);
    const record = {
      id,
      name: body.name || id,
      command: body.command || '',
      args: Array.isArray(body.args) ? body.args : [],
      auth_command: body.auth_command || body.login_command || '',
      subscription: body.subscription || body.plan || 'user-provided',
      status: 'registered',
      registered_at: new Date().toISOString()
    };
    writeJson(path.join(dataRoot, 'config', 'cli-connectors', `${id}.json`), record);
    return json(res, 200, { ok: true, connector: record, dir: path.join(dataRoot, 'config', 'cli-connectors') });
  }
  if (pathname === '/api/oauth/exchange') {
    const body = await getBody(req);
    if (!body.allow_oauth_store) {
      return json(res, 403, { ok: false, error: 'allow_oauth_store must be true before exchanging and storing provider tokens.' });
    }
    if (!body.token_url || !body.client_id || !body.code) {
      return json(res, 400, { ok: false, error: 'token_url, client_id, and code are required. User consent still happens in the provider browser flow.' });
    }
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: body.client_id,
      code: body.code,
      redirect_uri: body.redirect_uri || ''
    });
    if (body.code_verifier) params.set('code_verifier', body.code_verifier);
    if (body.client_secret) params.set('client_secret', body.client_secret);
    try {
      const tokenUrl = new URL(body.token_url);
      const result = await new Promise((resolve, reject) => {
        const r = https.request({
          method: 'POST',
          hostname: tokenUrl.hostname,
          path: tokenUrl.pathname + tokenUrl.search,
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(params.toString()), accept: 'application/json' }
        }, (rr) => {
          let out = '';
          rr.on('data', (d) => { out += d; });
          rr.on('end', () => resolve({ status: rr.statusCode, body: out }));
        });
        r.on('error', reject);
        r.write(params.toString());
        r.end();
      });
      const parsed = JSON.parse(result.body || '{}');
      if (result.status < 200 || result.status >= 300) return json(res, 400, { ok: false, status: result.status, error: parsed.error_description || parsed.error || 'OAuth exchange failed' });
      const safeToken = { ...parsed, access_token: parsed.access_token ? '[stored-local]' : undefined, refresh_token: parsed.refresh_token ? '[stored-local]' : undefined };
      writeJson(path.join(dataRoot, 'config', 'oauth', `${slug(body.provider || body.client_id)}.json`), { provider: body.provider || body.client_id, token: parsed, saved_at: new Date().toISOString() });
      return json(res, 200, { ok: true, token: safeToken, dir: path.join(dataRoot, 'config', 'oauth') });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/skills/list' || pathname === '/api/skills/registry') {
    return json(res, 200, { ok: true, skills: [], registry: [], dir: path.join(dataRoot, 'skills') });
  }
  if (pathname === '/api/skills/self_learning/status') {
    return json(res, 200, { ok: true, enabled: false, mode: 'manual', hint: 'Self-learning skill capture is available when a skill registry is connected.' });
  }
  if (pathname === '/api/skills/import' || pathname === '/api/skills/create' || pathname === '/api/skills/promote') {
    const body = await getBody(req);
    const id = slug(body.name || body.repo || body.title || `skill-${Date.now()}`);
    writeJson(path.join(dataRoot, 'skills', `${id}.json`), { ...body, id, imported_at: new Date().toISOString() });
    return json(res, 200, { ok: true, id, dir: path.join(dataRoot, 'skills') });
  }
  if (pathname === '/api/hardware/manifest') {
    const probe = await machineProbe();
    return json(res, 200, { ok: true, manifest: { system: probe.system, cpu: probe.cpu, memory: probe.memory, storage: probe.storage, gpus: probe.gpus, tier: probe.tier, capabilities: probe.capabilities, recommended: probe.recommended, embedded_brain: probe.embedded_brain } });
  }
  if (pathname === '/api/swarm/dispatch') {
    const body = await getBody(req);
    const job = { id: `job_${Date.now().toString(36)}`, task: body.task || body.content || 'task', status: 'queued', created_at: new Date().toISOString() };
    jobs.unshift(job);
    try {
      upsertMissionTask({
        id: `swarm-${job.id}`,
        title: job.task,
        column: 'doing',
        priority: body.priority || 'medium',
        owner: 'ABUZ8',
        details: `Swarm job ${job.id}`
      });
    } catch {}
    return json(res, 200, { ok: true, job_id: job.id, job });
  }
  if (pathname === '/swarm/status' || pathname === '/api/creator/queue') {
    return json(res, 200, { ok: true, active: jobs.filter((j) => j.status !== 'done').length, jobs });
  }
  if (pathname === '/api/creator/render') {
    const body = await getBody(req);
    const job = { ...body, id: body.id || `render_${Date.now().toString(36)}`, status: 'queued-local-fallback', created_at: new Date().toISOString() };
    jobs.unshift(job);
    return json(res, 200, { ok: true, job, mode: 'local-fallback' });
  }
  if (pathname === '/api/voice/status' || pathname === '/api/tts/status') {
    const voices = await listWindowsTtsVoices();
    const recognizers = await listWindowsSttRecognizers();
    return json(res, 200, {
      ok: true,
      native_tts: process.platform === 'win32' && voices.length > 0,
      native_tts_engine: process.platform === 'win32' ? 'Windows System.Speech/SAPI' : null,
      native_stt: process.platform === 'win32' && recognizers.length > 0,
      native_stt_engine: process.platform === 'win32' ? 'Windows System.Speech DictationGrammar' : null,
      browser_stt: true,
      browser_tts: true,
      streaming_chat_tts: true,
      recognizers,
      voices,
      voice_profiles: voiceProfiles(voices),
      local_model_assets: listLocalModelAssets().slice(0, 40),
      note: 'This build uses native Windows speech APIs for offline voice in/out when installed on the target machine. Browser speech remains the fallback path.'
    });
  }
  if (pathname === '/api/stt' || pathname === '/api/stt/transcribe') {
    const body = await getBody(req);
    try {
      const result = await transcribeWindowsStt(body.audio_base64 || body.wav_base64 || body.audio || body.raw || '');
      return json(res, 200, { ok: true, ...result });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message, fallback: 'browser-stt' });
    }
  }
  if (pathname === '/api/tts' || pathname === '/api/tts/stream') {
    const body = await getBody(req);
    try {
      const wav = await synthesizeWindowsTts(body.text || body.raw || '', body.voice || '', body.profile || body.voice_profile || '');
      return binary(res, 200, wav, 'audio/wav');
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message, fallback: 'browser-tts' });
    }
  }
  if (pathname === '/api/avatar/speak') {
    const body = await getBody(req);
    try {
      const wav = await synthesizeWindowsTts(body.text || body.raw || '', body.voice || '', body.profile || body.voice_profile || '');
      return binary(res, 200, wav, 'audio/wav');
    } catch (e) {
      return json(res, 200, { ok: true, queued: false, fallback: 'browser-tts', error: e.message });
    }
  }
  if (pathname === '/api/models/local' || pathname === '/api/local-models') {
    return json(res, 200, { ok: true, roots: modelRoots(), models: listLocalModelAssets() });
  }
  if (pathname === '/api/avatar/health') {
    const voices = await listWindowsTtsVoices();
    return json(res, 200, { ok: true, mode: voices.length ? 'native-windows-tts' : 'browser-tts-fallback', voices });
  }
  if (pathname === '/api/routing/leaderboard') return json(res, 200, { ok: true, rows: [{ lane: 'portable-core', n_calls: readMemory(500).length, mean_success: 1, cost_per_1k: 0 }] });
  if (pathname === '/api/provenance/stats') return json(res, 200, { ok: true, fact_count: readMemory(1000).length, agent_count: 1, open_conflicts: 0 });
  if (pathname === '/api/security/integrity' || pathname === '/api/security/audit') return json(res, 200, { ok: true, message: 'Portable runtime folders and local API are reachable.', data_root: dataRoot });
  if (pathname === '/api/telephony/status') return json(res, 200, { ok: true, active: false, hint: 'Connect Twilio or another provider in settings.' });
  if (pathname === '/api/crm/health') return json(res, 200, { ok: true, mode: 'local-fallback', hint: 'CRM data is stored locally until Stripe or an external CRM is connected.' });
  if (pathname === '/api/chimera/panels') {
    const embedded = embeddedBrainStatus();
    const panels = [
      { id: 'portable-core', role: 'local router', model: 'portable-core', enabled: true, active: !embedded.embedded, weight: embedded.embedded ? 0.25 : 1 },
      ...(embedded.available || []).map((b) => ({
        id: b.id,
        role: b.role || b.tier || 'embedded brain',
        model: b.name,
        enabled: b.embedded,
        active: embedded.id === b.id,
        status: embedded.id === b.id ? embedded.status : b.status,
        weight: embedded.id === b.id ? 1 : 0.5
      }))
    ];
    return json(res, 200, { ok: true, panels, active: embedded });
  }
  if (pathname === '/api/chimera/deliberate') {
    const body = await getBody(req);
    const prompt = body.prompt || body.content || body.raw || '';
    const response = await embeddedReply(prompt) || localReply(prompt);
    return json(res, 200, { ok: true, response, verdict: response, panels: [embeddedBrainStatus().id || 'portable-core'] });
  }
  if (pathname === '/api/connections/discover') return json(res, 200, { ok: true, connections: [{ id: 'portable-core', status: 'online', url: `http://127.0.0.1:${PORT}` }] });
  if (pathname === '/api/revenue/summary' || pathname === '/api/cost/summary' || pathname === '/api/usage' || pathname === '/api/traces') return json(res, 200, { ok: true, rows: [], total: 0, cost: 0 });
  if (pathname === '/api/actions/status') return json(res, 200, { ok: true, allow_actions: actionConsentGranted, session_only: true });
  if (pathname === '/api/actions/consent') {
    const body = await getBody(req);
    actionConsentGranted = body.allow_actions === true;
    appendJsonl(path.join(dataRoot, 'logs', 'action-consent.jsonl'), { allow_actions: actionConsentGranted, timestamp: new Date().toISOString() });
    return json(res, 200, { ok: true, allow_actions: actionConsentGranted, session_only: true });
  }
  if (pathname === '/api/tools/list') return json(res, 200, { ok: true, tools: localToolsList(), custom_tools_file: toolsFile() });
  if (pathname === '/api/tools/create') {
    const body = await getBody(req);
    try {
      const tool = createLocalTool(body);
      return json(res, 200, { ok: true, tool, tools: localToolsList(), custom_tools_file: toolsFile() });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/tools/call') {
    const body = await getBody(req);
    try {
      const result = await callLocalTool(body.tool || body.name, body.args || body);
      appendJsonl(path.join(dataRoot, 'logs', 'tool-calls.jsonl'), { ...result, timestamp: new Date().toISOString() });
      return json(res, 200, result);
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/mission/board' || pathname === '/mission/board.json') {
    const board = readMissionBoard();
    return json(res, 200, { ...board, summary: missionSummary(board), file: missionFile() });
  }
  if (pathname === '/api/mission/task') {
    const body = await getBody(req);
    try {
      const task = upsertMissionTask(body);
      const board = readMissionBoard();
      return json(res, 200, { ok: true, task, board, summary: missionSummary(board) });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/mission/move') {
    const body = await getBody(req);
    try {
      const task = moveMissionTask(body.id, body.column);
      const board = readMissionBoard();
      return json(res, 200, { ok: true, task, board, summary: missionSummary(board) });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }
  if (pathname === '/mission/crm/state.json') {
    const board = readMissionBoard();
    return json(res, 200, {
      ok: true,
      portfolio: [],
      leads: [],
      revenue: 0,
      goals: board.tasks.filter((t) => t.column !== 'done').slice(0, 6).map((t) => ({ label: t.title, status: `${t.column} · ${t.priority}` })),
      blockers: board.tasks.filter((t) => t.blocked || t.priority === 'blocker').map((t) => ({ issue: t.title, severity: t.priority || 'medium' })),
      mission: board.mission,
      summary: missionSummary(board)
    });
  }
  if (pathname === '/api/sessions/summary') return json(res, 200, { ok: true, sessions: [] });
  if (pathname === '/api/souls/list') {
    const cfg = readRuntimeConfig();
    return json(res, 200, {
      ok: true,
      active: cfg.active_soul || 'default',
      souls: [
        { name: 'default', display_name: 'Default Agent', role: 'calm practical desktop operator' },
        { name: 'operator', display_name: 'Operator', role: 'tool-first desktop control and verification' },
        { name: 'researcher', display_name: 'Researcher', role: 'web-aware question answering and source gathering' },
        { name: 'builder', display_name: 'Builder', role: 'projects, tasks, and implementation planning' }
      ]
    });
  }
  if (pathname === '/api/souls/active') {
    const body = await getBody(req);
    const soul = slug(body.soul || body.name || 'default') || 'default';
    writeRuntimeConfigPatch({ active_soul: soul });
    return json(res, 200, { ok: true, active: soul, session_only: false });
  }
  if (pathname === '/api/telegram/send') return json(res, 200, { ok: false, error: 'Telegram is not configured in portable mode.' });

  return json(res, 404, { ok: false, error: `No portable-core endpoint for ${pathname}` });
}

async function start(options = {}) {
  if (server) return { port: PORT, dataRoot };
  logFn = options.log || logFn;
  hostExecutable = process.env.PORTABLE_EXECUTABLE_FILE
    || (options.app && typeof options.app.getPath === 'function' ? options.app.getPath('exe') : null)
    || process.execPath;
  dataRoot = resolveDataRoot(options.app);
  initFolders();
  server = http.createServer((req, res) => route(req, res).catch((e) => json(res, 500, { ok: false, error: e.message })));
  await new Promise((resolve, reject) => {
    server.once('error', async (e) => {
      if (e && e.code === 'EADDRINUSE') {
        if (process.env.ABUZ8_ALLOW_EXTERNAL_BACKEND === '1') {
          logFn(`port ${PORT} is already in use; adopting existing local backend because ABUZ8_ALLOW_EXTERNAL_BACKEND=1.`);
          server = null;
          return resolve();
        }
        return reject(new Error(`ABUZ8 bundled core could not bind 127.0.0.1:${PORT}. Close the older ABUZ8/Qadir process or set ABUZ8_PORT to a free port.`));
      }
      reject(e);
    });
    server.listen(PORT, '127.0.0.1', resolve);
  });
  if (server) logFn(`portable core listening on http://127.0.0.1:${PORT}`);
  logFn(`data root: ${dataRoot}`);
  return { port: PORT, dataRoot };
}

function stop() {
  if (server) server.close();
  server = null;
  if (lfmProcess) {
    try { lfmProcess.kill(); } catch {}
    lfmProcess = null;
  }
}

module.exports = { start, stop, PORT };
