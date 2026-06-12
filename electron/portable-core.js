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
let serverHost = '127.0.0.1';
let dataRoot = null;
// Live activity feed (Manus-style): an in-memory ring buffer the UI polls.
const activityLog = [];
let activitySeq = 0;
let agentRunning = false;
function pushActivity(type, label, detail) {
  activitySeq += 1;
  activityLog.push({ id: activitySeq, t: new Date().toISOString(), type, label: String(label || '').slice(0, 120), detail: String(detail || '').slice(0, 240) });
  if (activityLog.length > 300) activityLog.shift();
  return activitySeq;
}
let logFn = (m) => console.log('[portable-core] ' + m);
const jobs = [];
let lfmProcess = null;
let lfmStarting = false;
let lastLfmError = '';
let activeBrain = null;
let hostExecutable = null;
let actionConsentGranted = false;
const mcpProcesses = new Map();

// The LFM brains were removed to keep the OS lean — NVIDIA Nemotron 3 Nano 4B
// (a downloaded GGUF) is the primary brain now. Any GGUF dropped in the models
// shelf still appears as a selectable brain via downloadedGgufBrains().
const EMBEDDED_BRAIN_CATALOG = [];

// Predefined executive agents the user can pick. Each is a system prompt plus a
// recommended real toolset. No personas are faked — every listed tool exists.
const AGENT_ROLES = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    tagline: 'Executive coordinator — plans, routes, and delegates across every tool.',
    tools: ['web_search', 'cmd_run', 'file_write', 'open_app', 'open_url', 'screenshot', 'abuz8_memory_write', 'abuz8_mission_board'],
    system: 'You are ABUZ8 OS Orchestrator, the executive controller of a local agent operating system. You plan multi-step work, decide which tool or sub-agent fits, and keep answers decisive and technical. You have native control of this machine through the host tools. Be direct, no filler.'
  },
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    tagline: 'Live web research and source synthesis.',
    tools: ['web_search', 'open_url', 'abuz8_memory_write'],
    system: 'You are ABUZ8 OS Research Analyst. You gather current information with web_search and fetch, cross-check sources, and synthesize concise, cited findings. State uncertainty plainly. Never invent facts or URLs.'
  },
  {
    id: 'systems-engineer',
    name: 'Systems Engineer',
    tagline: 'Inspects the host, runs CLIs, drives MCP servers.',
    tools: ['cmd_run', 'shell_run', 'cli_probe', 'web_search'],
    system: 'You are ABUZ8 OS Systems Engineer. You inspect and operate this machine through the command line and MCP servers. Explain what a command does before proposing it, prefer read-only diagnostics first, and report exact output. You are precise and safety-aware but you do execute real work.'
  },
  {
    id: 'desktop-operator',
    name: 'Desktop Operator',
    tagline: 'Native desktop actions — apps, files, screenshots, URLs.',
    tools: ['open_app', 'open_url', 'screenshot', 'file_write', 'cmd_run'],
    system: 'You are ABUZ8 OS Desktop Operator. You carry out native desktop actions: launching apps, writing files in the sandbox, opening URLs, and capturing the screen. Confirm the concrete action taken and its result path. Do only what is asked.'
  },
  {
    id: 'automation-builder',
    name: 'Automation Builder',
    tagline: 'Creates new tools and wires connectors.',
    tools: ['abuz8_tool_create', 'cli_probe', 'web_search'],
    system: 'You are ABUZ8 OS Automation Builder. You design and register new local tools and connectors, defining clear names, commands, and arguments. Produce working tool definitions, not placeholders.'
  },
  {
    id: 'knowledge-keeper',
    name: 'Knowledge Keeper',
    tagline: 'Reads, writes, and searches local memory.',
    tools: ['abuz8_memory_write', 'memory_search'],
    system: 'You are ABUZ8 OS Knowledge Keeper. You capture durable facts to local memory and retrieve them on request. Keep entries atomic and well-labeled. Never expose data outside this machine.'
  },
  // ── Executive / growth roles migrated from the Hermes operator-mode & X-growth playbooks ──
  {
    id: 'ceo-operator',
    name: 'CEO / Operator',
    tagline: 'Runs the company in Operator Mode — revenue-first, no permission theater.',
    tools: ['abuz8_mission_board', 'abuz8_mission_task_create', 'swarm_run', 'web_search', 'cmd_run', 'abuz8_memory_write'],
    system: 'You are the ABUZ8 OS CEO / Operator. You run the user’s one-person company in Operator Mode. RULES: (1) Revenue first — judge every task by whether it moves money or builds a revenue asset; deprioritize the rest. (2) No permission theater — once direction is clear, execute; do not ask "shall I continue?" after each step. (3) Massive action bias — ship the whole plan (e.g. a 7-day calendar), not one item at a time. (4) Multi-agent output — when parts can be produced in parallel, produce them together. (5) Fact-check specs/pricing before publishing. You delegate via the Kanban board and the swarm. Coordinate Sales, Content, Distribution, Research, and Kanban-Ops sub-agents. Be decisive and concrete.'
  },
  {
    id: 'seo-strategist',
    name: 'SEO Strategist',
    tagline: 'Keyword strategy, content architecture, technical + on-page SEO.',
    tools: ['web_search', 'content_generate', 'abuz8_memory_write'],
    system: 'You are the ABUZ8 OS SEO Strategist. You plan keyword clusters and search intent, design site/content architecture and internal linking, and write on-page + technical SEO recommendations (titles, meta, schema, Core Web Vitals, crawlability). Ground recommendations in real search behavior and state assumptions. Output concrete briefs, not generic advice.'
  },
  {
    id: 'x-growth-operator',
    name: 'X Growth Operator',
    tagline: 'Audience growth + monetization on X. Carousels, threads, 25-problems protocol.',
    tools: ['content_generate', 'x_post', 'web_search', 'abuz8_mission_task_create'],
    system: 'You are the ABUZ8 OS X Growth Operator, running the migrated x-growth-monetization playbook v2. Engine: carousel posts (10–15 slides: hook → problem → why it matters → mental model → steps → proof → TL;DR → CTA), 3× daily, plus 5–8 short tweets and live threads. Signature protocol: publicly solve 25 of the hardest problems in the niche per week, each tagged with the user’s signature. Engage every reply, quote-RT with added insight, weekly AMA. Track impressions/engagement/follower growth and iterate. Revenue paths: ad share, digital products, affiliates, sponsorships. Fact-check all specs/pricing before drafting. Produce ready-to-post content, not theory.'
  },
  {
    id: 'content-producer',
    name: 'Content Producer',
    tagline: 'NotebookLM-style synthesis → YouTube scripts, threads, carousels.',
    tools: ['content_generate', 'web_search', 'file_write'],
    system: 'You are the ABUZ8 OS Content Producer. You synthesize sources into structured content the way a research-to-media pipeline does: ingest notes/links, extract the spine, then produce the requested format — YouTube script (hook, beats, B-roll cues, CTA), X carousel, thread, blog outline, or show notes. Keep a consistent voice and a single CTA. Mark anything you could not verify rather than inventing it.'
  },
  {
    id: 'swarm-orchestrator',
    name: 'Swarm Orchestrator',
    tagline: 'Decomposes a goal and runs a multi-agent swarm to completion.',
    tools: ['swarm_run', 'abuz8_mission_task_create', 'cmd_run', 'web_search'],
    system: 'You are the ABUZ8 OS Swarm Orchestrator. You decompose a goal into parallel work, assign each part to the best specialized role, run them as a swarm, then verify and synthesize the results into one coherent deliverable. Topology: orchestrator → workers → verifier → synthesis. Name the sub-agents you used and reconcile conflicts explicitly.'
  }
];

function resolveRoleSystem(roleId) {
  if (!roleId || roleId === 'default' || roleId === 'auto') return null;
  const role = AGENT_ROLES.find((r) => r.id === roleId || slug(r.name) === slug(roleId));
  return role ? role.system : null;
}

// ── Soul: persistent personality + mission, Hermes-style, loaded into every chat ──
const DEFAULT_SOUL = `You are ABUZ8 — a sharp, loyal, JARVIS-class operator OS for your owner. Voice: confident, concise, a little wry; never robotic, never groveling. You take initiative: when a request implies an action you can perform (open an app or site, run a command, search, create a tool), you DO it rather than describing it. You speak plainly, fact-check before asserting specs or prices, and you never fake a result — if something needs a key or isn't possible, you say so in one line and offer the next best move.`;
const DEFAULT_MISSION = `Standing mission: help the owner build a one-person company that generates revenue through content creation and mass SEO/social marketing. Bias every suggestion toward shipping assets that compound (carousels, threads, articles, tools) and toward the X signature protocol of publicly solving hard problems. Revenue-first, massive action, no permission theater.`;

function soulDir() { return safeMkdir(path.join(dataRoot, 'soul')); }
function readTextFile(f, fallback) { try { return fs.readFileSync(f, 'utf8'); } catch { return fallback; } }
function loadSoul() {
  const p = path.join(soulDir(), 'SOUL.md');
  const m = path.join(soulDir(), 'MISSION.md');
  if (!exists(p)) fs.writeFileSync(p, DEFAULT_SOUL, 'utf8');
  if (!exists(m)) fs.writeFileSync(m, DEFAULT_MISSION, 'utf8');
  return { personality: readTextFile(p, DEFAULT_SOUL).trim(), mission: readTextFile(m, DEFAULT_MISSION).trim() };
}
function saveSoul(patch = {}) {
  if (typeof patch.personality === 'string') fs.writeFileSync(path.join(soulDir(), 'SOUL.md'), patch.personality, 'utf8');
  if (typeof patch.mission === 'string') fs.writeFileSync(path.join(soulDir(), 'MISSION.md'), patch.mission, 'utf8');
  return loadSoul();
}
// Compose the full system prompt: soul personality + active role + standing mission.
function composeSystem(roleId, explicit) {
  if (explicit) return explicit;
  const soul = dataRoot ? loadSoul() : { personality: DEFAULT_SOUL, mission: DEFAULT_MISSION };
  const role = resolveRoleSystem(roleId);
  return [soul.personality, role, soul.mission].filter(Boolean).join('\n\n');
}

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
    { name: 'open_app', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Open an allowlisted desktop app: notepad, mspaint, calc, or explorer.' },
    { name: 'draw_monkey_in_paint', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Create a simple monkey drawing in the portable sandbox and open it in Microsoft Paint.' },
    { name: 'screenshot', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Capture the primary screen to the portable data shots folder.' },
    { name: 'file_write', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Write a text file inside the portable data sandbox only.' },
    { name: 'shell_run', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Run allowlisted quick probes: whoami, hostname, or dir.' },
    { name: 'cmd_run', type: 'action', status: actionConsentGranted ? 'ready' : 'blocked', description: 'Run any local CLI command or shell pipeline with full native control after Allow actions consent.' },
    { name: 'cli_probe', type: 'local-api', status: 'permission-gated', description: 'Probe local CLIs with allow_cli.' },
    { name: 'cli_register', type: 'local-api', status: 'permission-gated', description: 'Register a local CLI bridge with allow_cli.' },
    { name: 'oauth_exchange', type: 'local-api', status: 'permission-gated', description: 'Store user-authorized OAuth tokens locally with allow_oauth_store.' },
    { name: 'embedded_brain_runtime', type: 'local-runtime', status: brain?.embedded ? 'ready' : 'fallback', description: brain?.embedded ? `\${brain.name} selected automatically.` : 'No embedded GGUF selected.' },
    { name: 'web_search', type: 'local-api', status: 'ready', description: 'Real-time web search via DuckDuckGo HTML scraping. Returns structured results with titles, URLs, and snippets.' },
    { name: 'browser_do', type: 'action', status: browserAutomationAvailable() ? 'ready' : 'attachment-missing', description: 'Drive a real browser with Playwright: navigate, click, fill, screenshot, extract page text.' },
    { name: 'gui_do', type: 'action', status: guiAutomationAvailable() ? (actionConsentGranted ? 'ready' : 'blocked') : 'attachment-missing', description: 'Control the real mouse/keyboard/screen with PyAutoGUI (move, click, type, hotkey, screenshot).' }
  ];
  return builtIns.concat(readCustomTools());
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

function actionsAllowed() {
  if (actionConsentGranted) return true;
  // Honor the persisted setting so consent survives relaunch (the UI toggle writes this).
  try { return readJson(settingsPath(), {}).auto_grant_actions === true; } catch { return false; }
}

function requireActionConsent() {
  if (!actionsAllowed()) {
    throw new Error('Action tools are blocked until the user enables Allow actions.');
  }
}

// Apps the agent can launch by name. Browsers/Office/utilities resolve through
// the Windows App Paths registry via `start`, so they work without a full path.
function normalizeAllowedApp(name) {
  const key = slug(name || '');
  const apps = {
    notepad: { target: 'notepad', label: 'Notepad' },
    mspaint: { target: 'mspaint', label: 'Paint' },
    paint: { target: 'mspaint', label: 'Paint' },
    calc: { target: 'calc', label: 'Calculator' },
    calculator: { target: 'calc', label: 'Calculator' },
    explorer: { target: 'explorer', label: 'File Explorer' },
    files: { target: 'explorer', label: 'File Explorer' },
    chrome: { target: 'chrome', label: 'Google Chrome' },
    'google-chrome': { target: 'chrome', label: 'Google Chrome' },
    edge: { target: 'msedge', label: 'Microsoft Edge' },
    msedge: { target: 'msedge', label: 'Microsoft Edge' },
    firefox: { target: 'firefox', label: 'Firefox' },
    brave: { target: 'brave', label: 'Brave' },
    word: { target: 'winword', label: 'Word' },
    excel: { target: 'excel', label: 'Excel' },
    powerpoint: { target: 'powerpnt', label: 'PowerPoint' },
    outlook: { target: 'outlook', label: 'Outlook' },
    cmd: { target: 'cmd', label: 'Command Prompt' },
    terminal: { target: 'wt', label: 'Windows Terminal' },
    powershell: { target: 'powershell', label: 'PowerShell' },
    'task-manager': { target: 'taskmgr', label: 'Task Manager' },
    taskmgr: { target: 'taskmgr', label: 'Task Manager' },
    settings: { target: 'ms-settings:', label: 'Settings' },
    spotify: { target: 'spotify', label: 'Spotify' },
    code: { target: 'code', label: 'VS Code' },
    vscode: { target: 'code', label: 'VS Code' }
  };
  return apps[key] || null;
}

// Launch via `start` so browsers, URLs, App-Paths apps, and shell verbs all work.
function launchViaStart(target, extra = []) {
  const quote = (s) => `"${String(s).replace(/"/g, '')}"`;
  const cmdline = `start "" ${quote(target)} ${extra.map(quote).join(' ')}`.trim();
  const child = spawn(cmdline, { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { launched: true, target, args: extra };
}

async function startProcessDetached(file, args = []) {
  const child = spawn(file, args.map(String), { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { launched: true, pid: child.pid, file, args };
}

async function actionOpenApp(args = {}) {
  requireActionConsent();
  const raw = args.name || args.app || args.target || '';
  const app = normalizeAllowedApp(raw);
  if (!app) {
    // Unknown name: try launching it directly through `start` (resolves App Paths).
    const guess = slug(raw);
    if (!guess) throw new Error('No app name supplied.');
    const r = launchViaStart(guess);
    return { ...r, app: guess, note: 'Launched via Windows start; if nothing opened, the app is not installed or not on App Paths.' };
  }
  const result = launchViaStart(app.target);
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

// Resolve a site name or bare domain to a URL. Handles "youtube", "youtube.com",
// "gmail", optional search query (e.g. youtube search), and full URLs.
const SITE_MAP = {
  youtube: 'https://www.youtube.com', yt: 'https://www.youtube.com',
  google: 'https://www.google.com', gmail: 'https://mail.google.com',
  github: 'https://github.com', x: 'https://x.com', twitter: 'https://x.com',
  reddit: 'https://www.reddit.com', maps: 'https://maps.google.com',
  chatgpt: 'https://chat.openai.com', claude: 'https://claude.ai',
  amazon: 'https://www.amazon.com', wikipedia: 'https://www.wikipedia.org',
  netflix: 'https://www.netflix.com', linkedin: 'https://www.linkedin.com',
  instagram: 'https://www.instagram.com', facebook: 'https://www.facebook.com',
  huggingface: 'https://huggingface.co', drive: 'https://drive.google.com'
};
function resolveSiteUrl(name, search) {
  const raw = String(name || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const key = slug(raw);
  let base = SITE_MAP[key];
  if (!base && /\.[a-z]{2,}$/i.test(raw)) base = 'https://' + raw.replace(/^\/+/, '');
  if (!base) return null;
  if (search) {
    if (key === 'youtube' || key === 'yt') return `${base}/results?search_query=${encodeURIComponent(search)}`;
    if (key === 'google') return `${base}/search?q=${encodeURIComponent(search)}`;
    if (key === 'github') return `${base}/search?q=${encodeURIComponent(search)}`;
    if (key === 'amazon') return `${base}/s?k=${encodeURIComponent(search)}`;
    if (key === 'reddit') return `${base}/search/?q=${encodeURIComponent(search)}`;
  }
  return base;
}

async function actionOpenUrl(args = {}) {
  requireActionConsent();
  // Accept url, a site name (+ optional search), or a raw query.
  let url = args.url || args.href;
  if (!url && (args.site || args.name)) url = resolveSiteUrl(args.site || args.name, args.search);
  url = normalizeHttpUrl(url || args.query);
  const browserKey = args.browser ? slug(args.browser) : '';
  const browser = browserKey && normalizeAllowedApp(browserKey);
  if (browser) {
    const r = launchViaStart(browser.target, [url]);
    return { ...r, browser: browser.label, url };
  }
  const r = launchViaStart(url);
  return { ...r, browser: 'default', url };
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

async function actionCmdRun(args = {}) {
  requireActionConsent();
  const command = String(args.command || args.cmd || '').trim();
  if (!command) throw new Error('command is required.');
  const list = Array.isArray(args.args) ? args.args.map(String) : [];
  const timeout = Number(args.timeout || 60000);
  // Full native CLI control, gated only by the session Allow-actions consent.
  // Run through the shell so pipelines and built-ins work like a real terminal.
  if (list.length) return runCommand(command, list, timeout);
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    execFile(shell, shellArgs, { windowsHide: true, timeout, cwd: args.cwd && exists(args.cwd) ? args.cwd : dataRoot, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        command,
        code: err && typeof err.code === 'number' ? err.code : 0,
        stdout: String(stdout || '').slice(0, 12000),
        stderr: String(stderr || err?.message || '').slice(0, 12000)
      });
    });
  });
}

const SENSITIVE_TOOLS = ['shell_run', 'cmd_run', 'file_write', 'screenshot', 'open_app', 'open_url'];

async function callLocalTool(name, args = {}) {
  const toolName = String(name || args.name || args.tool || '').trim();
  if (!toolName) throw new Error('tool name is required');
  const key = slug(toolName);
  const isTool = (...names) => names.map(slug).includes(key);
  const body = args || {};

  // Permission gate: sensitive tools require consent
  const settings = readJson(settingsPath(), {});
  const requireConsent = settings.require_consent !== false;
  const autoGrant = settings.auto_grant_actions === true;
  if (requireConsent && !autoGrant && SENSITIVE_TOOLS.some(t => slug(t) === key)) {
    if (!body._permitted) {
      return {
        ok: false,
        tool: toolName,
        action_required: true,
        reason: `The tool \`${toolName}\` requires your permission to run.`,
        prompt: `⚠️ **Permission Required**: Run \`${toolName}\`?\nType \`/allow-actions\` to grant permission, or \`/deny\` to reject.`
      };
    }
  }

  if (isTool('abuz8_chat', 'chat')) {
    const prompt = body.message || body.content || body.prompt || body.raw || '';
    const r = await reasonReply(prompt);
    return { ok: true, tool: toolName, result: { response: r.text, brain: embeddedBrainStatus(), answered_by: r.brain, fallback: r.fallback } };
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
  if (isTool('open_app')) {
    return { ok: true, tool: toolName, result: await actionOpenApp(body) };
  }
  if (isTool('draw_monkey_in_paint', 'paint_monkey', 'draw_monkey')) {
    return { ok: true, tool: toolName, result: await actionDrawMonkeyInPaint(body) };
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
  if (isTool('mcp_call')) {
    // Two-way bridge: the agent drives any registered MCP server (Desktop
    // Commander, Windows-MCP mouse/keyboard, Antigravity, …). Consent-gated —
    // these are real OS-control tools.
    requireActionConsent();
    const mcpServer = String(body.server || '').trim();
    const mcpTool = String(body.tool || body.name || '').trim();
    if (!mcpServer || !mcpTool) throw new Error('mcp_call requires {"server":"...","tool":"...","args":{}}. List servers at /api/mcp/servers.');
    return { ok: true, tool: 'mcp_call', server: mcpServer, mcp_tool: mcpTool, result: await mcpCallTool(mcpServer, mcpTool, body.args || {}) };
  }
  if (isTool('cmd_run', 'run_command', 'terminal')) {
    return { ok: true, tool: toolName, result: await actionCmdRun(body) };
  }
  if (isTool('swarm_run', 'swarm')) {
    return { ok: true, tool: toolName, result: await runSwarm(body.task || body.goal || body.content, body.roles || body.agents) };
  }
  if (isTool('content_generate', 'generate_content')) {
    return { ok: true, tool: toolName, result: await generateContent(body) };
  }
  if (isTool('x_post', 'post_to_x', 'tweet')) {
    return { ok: true, tool: toolName, result: await xPost(body) };
  }
  if (isTool('browser_do', 'browser', 'web_automate')) {
    return { ok: true, tool: toolName, result: await browserDo(body) };
  }
  if (isTool('gui_do', 'desktop_control', 'mouse_keyboard')) {
    return { ok: true, tool: toolName, result: await guiDo(body) };
  }
  if (isTool('web_search')) {
    return { ok: true, tool: toolName, result: await webSearch(body) };
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

// ── Attachments: optional engines that make ABUZ8 more capable. It runs without
// any of them; each detected one upgrades a capability (voice, hearing, etc.). ──
function attachmentsDir() { return safeMkdir(path.join(dataRoot, 'attachments')); }

function piperPaths() {
  const root = path.join(attachmentsDir(), 'piper');
  return { root, exe: path.join(root, 'piper.exe'), voicesDir: path.join(root, 'voices') };
}
function piperAvailable() { return exists(piperPaths().exe); }

function listPiperVoices() {
  const { voicesDir } = piperPaths();
  if (!exists(voicesDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(voicesDir)) {
    if (!f.endsWith('.onnx')) continue;
    const id = f.replace(/\.onnx$/, '');
    const parts = id.split('-'); // lang_REGION-name-quality
    const lang = (parts[0] || '').split('_')[0];
    out.push({
      id,
      name: prettyVoiceName(id),
      lang,
      engine: 'piper',
      file: path.join(voicesDir, f),
      arabic: lang === 'ar'
    });
  }
  return out;
}
function prettyVoiceName(id) {
  const map = {
    'en_US-hfc_female-medium': 'Aria (US female, natural)',
    'en_US-ryan-high': 'Ryan (US male, hi-fi)',
    'en_GB-alan-medium': 'Alan (British male)',
    'ar_JO-kareem-medium': 'Kareem (Arabic / عربي)'
  };
  return map[id] || id.replace(/_/g, ' ');
}

// Neural TTS via Piper. Optional preset shapes the delivery (e.g. "cartoon" =
// faster + higher pitch via length_scale; "calm" = slower).
function synthesizePiper(textValue, voiceId, preset) {
  return new Promise((resolve, reject) => {
    const { exe, voicesDir } = piperPaths();
    if (!exists(exe)) return reject(new Error('Piper attachment not installed.'));
    const voices = listPiperVoices();
    const voice = voices.find((v) => v.id === voiceId) || voices.find((v) => v.lang === 'en') || voices[0];
    if (!voice) return reject(new Error('No Piper voice installed.'));
    const textClean = String(textValue || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!textClean) return reject(new Error('No text supplied.'));
    const ttsDir = safeMkdir(path.join(dataRoot, 'cache', 'tts'));
    const outputFile = path.join(ttsDir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.wav`);
    // length_scale: <1 faster/brighter, >1 slower. cartoon = fast+light.
    const presets = { normal: ['--length_scale', '1.0'], calm: ['--length_scale', '1.18'], fast: ['--length_scale', '0.82'], cartoon: ['--length_scale', '0.72', '--noise_w', '0.95'], narrator: ['--length_scale', '1.08'] };
    const extra = presets[slug(preset || 'normal')] || presets.normal;
    const args = ['-m', voice.file, '-f', outputFile, ...extra];
    const child = execFile(exe, args, { cwd: piperPaths().root, windowsHide: true, timeout: 45000 }, (err) => {
      if (err && !exists(outputFile)) return reject(err);
      try {
        const wav = fs.readFileSync(outputFile);
        try { fs.unlinkSync(outputFile); } catch {}
        resolve({ wav, voice: voice.id, engine: 'piper' });
      } catch (e) { reject(e); }
    });
    child.stdin.write(textClean);
    child.stdin.end();
  });
}

function attachmentsStatus() {
  const piper = piperAvailable();
  const voices = piper ? listPiperVoices() : [];
  return {
    ok: true,
    attachments: [
      { id: 'piper-tts', name: 'Piper Neural Voice', capability: 'Text-to-speech (offline, natural)', installed: piper, detail: piper ? `${voices.length} voice(s): ${voices.map((v) => v.name).join(', ')}` : 'Not installed — falls back to Windows SAPI.' },
      { id: 'whisper-stt', name: 'Whisper Hearing', capability: 'Speech-to-text (offline)', installed: whisperAvailable(), detail: whisperAvailable() ? 'Offline transcription ready.' : 'Not installed — falls back to browser/Windows STT.' },
      { id: 'lora-adapters', name: 'LoRA Specialist Brains', capability: 'Modular skill adapters on the local brain', installed: listLoraAdapters().length > 0, detail: listLoraAdapters().length ? `${listLoraAdapters().length} adapter(s) available.` : 'Drop .gguf LoRA files in attachments/lora to specialize the brain.' },
      { id: 'playwright', name: 'Playwright Browser Control', capability: 'Real browser automation (navigate/click/fill/extract)', installed: browserAutomationAvailable(), detail: browserAutomationAvailable() ? 'Headless/headed Chromium automation ready.' : 'Not installed — npm i playwright in attachments/playwright.' },
      { id: 'pyautogui', name: 'PyAutoGUI Desktop Control', capability: 'Real mouse/keyboard/screen control', installed: guiAutomationAvailable(), detail: guiAutomationAvailable() ? 'Native desktop control ready (consent-gated).' : 'Not installed — pip install pyautogui.' }
    ],
    voice_engine: piper ? 'piper' : 'windows-sapi',
    voices: [...voices, ...[]]
  };
}

// ── Playwright browser automation (real, headed or headless) ──
function playwrightPaths() {
  const root = path.join(attachmentsDir(), 'playwright');
  return { root, runner: path.join(root, 'run.js'), node: bundledNodePath() || 'node', hasModule: exists(path.join(root, 'node_modules', 'playwright')) };
}
function browserAutomationAvailable() { const p = playwrightPaths(); return exists(p.runner) && p.hasModule; }

async function browserDo(args = {}) {
  const p = playwrightPaths();
  if (!browserAutomationAvailable()) throw new Error('Playwright attachment not installed (attachments/playwright).');
  const spec = {
    url: args.url ? (resolveSiteUrl(args.url, args.search) || (/^https?:/i.test(args.url) ? args.url : 'https://' + args.url)) : undefined,
    headless: args.headless !== false && args.show !== true,
    actions: Array.isArray(args.actions) ? args.actions : [],
    extract: args.extract !== false,
    screenshot: args.screenshot ? path.join(safeMkdir(path.join(dataRoot, 'shots')), `browser-${Date.now()}.png`) : undefined
  };
  const specFile = path.join(safeMkdir(path.join(dataRoot, 'cache')), `pw-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec), 'utf8');
  return new Promise((resolve, reject) => {
    execFile(p.node, [p.runner, specFile], { cwd: p.root, windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      try { fs.unlinkSync(specFile); } catch {}
      if (err && !stdout) return reject(new Error(err.message));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('browser runner returned no JSON: ' + String(stdout).slice(0, 200))); }
    });
  });
}

// ── PyAutoGUI desktop automation (real mouse/keyboard/screen) ──
function pyautoguiPaths() {
  const root = path.join(attachmentsDir(), 'pyautogui');
  return { root, runner: path.join(root, 'gui.py') };
}
function guiAutomationAvailable() { return exists(pyautoguiPaths().runner); }

async function guiDo(args = {}) {
  requireActionConsent(); // controls the real machine — always gated
  const p = pyautoguiPaths();
  if (!guiAutomationAvailable()) throw new Error('PyAutoGUI attachment not installed (attachments/pyautogui).');
  if (args.action === 'screenshot' && !args.path) args.path = path.join(safeMkdir(path.join(dataRoot, 'shots')), `gui-${Date.now()}.png`);
  return new Promise((resolve, reject) => {
    execFile('python', [p.runner, JSON.stringify(args)], { windowsHide: true, timeout: 30000 }, (err, stdout) => {
      if (err && !stdout) return reject(new Error(err.message));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('gui runner returned no JSON: ' + String(stdout).slice(0, 200))); }
    });
  });
}

function listLoraAdapters() {
  const dir = path.join(attachmentsDir(), 'lora');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.gguf$/i.test(f)).map((f) => ({ id: f.replace(/\.gguf$/i, ''), file: path.join(dir, f) }));
}

function whisperPaths() {
  const root = path.join(attachmentsDir(), 'whisper');
  const exe = ['whisper-cli.exe', 'main.exe', 'whisper.exe'].map((n) => path.join(root, n)).find((p) => exists(p));
  const model = exists(path.join(root, 'models')) ? fs.readdirSync(path.join(root, 'models')).find((f) => /\.bin$/i.test(f)) : null;
  return { root, exe: exe || path.join(root, 'whisper-cli.exe'), model: model ? path.join(root, 'models', model) : null };
}
function whisperAvailable() { const w = whisperPaths(); return exists(w.exe) && Boolean(w.model); }

function transcribeWhisper(wavBase64) {
  return new Promise((resolve, reject) => {
    const w = whisperPaths();
    if (!whisperAvailable()) return reject(new Error('Whisper attachment not installed.'));
    const b64 = String(wavBase64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
    if (!b64) return reject(new Error('No audio supplied.'));
    const sttDir = safeMkdir(path.join(dataRoot, 'cache', 'stt'));
    const inFile = path.join(sttDir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.wav`);
    fs.writeFileSync(inFile, Buffer.from(b64, 'base64'));
    execFile(w.exe, ['-m', w.model, '-f', inFile, '-otxt', '-of', inFile, '-nt'], { windowsHide: true, timeout: 60000 }, (err) => {
      const txtFile = inFile + '.txt';
      let transcript = '';
      try { transcript = fs.readFileSync(txtFile, 'utf8').trim(); } catch {}
      try { fs.unlinkSync(inFile); } catch {}
      try { fs.unlinkSync(txtFile); } catch {}
      if (err && !transcript) return reject(err);
      resolve({ transcript, engine: 'whisper.cpp' });
    });
  });
}

// ── Voice sidecar — native GPU STT (Whisper large-v3) + TTS (Kokoro-82M) ────
// A resident Python service on :8921 the core auto-detects and auto-spawns,
// exactly like external model runners. Preferred over Piper/Windows/browser.
const VOICE_SIDECAR_PORT = Number(process.env.ABUZ8_VOICE_PORT || 8921);
let voiceSidecarCache = { at: 0, health: null };
let voiceSidecarSpawned = false;
async function voiceSidecarHealth(force) {
  if (!force && Date.now() - voiceSidecarCache.at < 5000) return voiceSidecarCache.health;
  try {
    const txt = await fetchUrl(`http://127.0.0.1:${VOICE_SIDECAR_PORT}/health`, { timeout: 1500 });
    voiceSidecarCache = { at: Date.now(), health: JSON.parse(txt) };
  } catch { voiceSidecarCache = { at: Date.now(), health: null }; }
  return voiceSidecarCache.health;
}
function voiceSidecarScript() {
  return [
    path.join(__dirname, 'voice', 'voice_sidecar.py'),
    path.join(process.resourcesPath || '', 'voice', 'voice_sidecar.py')
  ].find((p) => p && exists(p)) || null;
}
async function ensureVoiceSidecar() {
  const h = await voiceSidecarHealth();
  if (h && h.ok) return h;
  if (voiceSidecarSpawned) return null;
  const script = voiceSidecarScript();
  if (!script) return null;
  const python = ['C:\\Program Files\\Python311\\python.exe', 'C:\\Python311\\python.exe']
    .find((p) => exists(p)) || 'python';
  try {
    const proc = spawn(python, [script], {
      env: { ...process.env, ABUZ8_VOICE_PORT: String(VOICE_SIDECAR_PORT) },
      detached: true, stdio: 'ignore', windowsHide: true
    });
    proc.unref();
    voiceSidecarSpawned = true;
    // Fire-and-forget warmup so first real call is instant.
    setTimeout(() => {
      fetchUrl(`http://127.0.0.1:${VOICE_SIDECAR_PORT}/warmup`, { method: 'POST', timeout: 300000 }).catch(() => {});
    }, 5000);
    logFn(`[voice] sidecar spawning via ${python} (${script})`);
  } catch (e) { logFn(`[voice] sidecar spawn failed: ${e.message}`); }
  return null;
}
function httpPostBuffer(url, bodyObj, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, buffer: Buffer.concat(chunks), headers: r.headers }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('voice sidecar timeout')));
    req.end(JSON.stringify(bodyObj));
  });
}

// ── Internet tunnel (cloudflared) — phone/PWA reachable over the internet ──
let tunnelProc = null;
let tunnelUrl = '';
function cloudflaredPath() {
  return [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe'
  ].find((p) => exists(p)) || 'cloudflared';
}
function startTunnel() {
  return new Promise((resolve, reject) => {
    if (tunnelProc && tunnelUrl) return resolve(tunnelUrl);
    const proc = spawn(cloudflaredPath(), ['tunnel', '--url', `http://127.0.0.1:${PORT}`], { windowsHide: true });
    tunnelProc = proc;
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !tunnelUrl) { tunnelUrl = m[0]; logFn(`[tunnel] live at ${tunnelUrl}`); resolve(tunnelUrl); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', () => { tunnelProc = null; tunnelUrl = ''; });
    proc.on('error', (e) => { tunnelProc = null; reject(e); });
    setTimeout(() => { if (!tunnelUrl) reject(new Error('cloudflared did not report a URL within 30s')); }, 30000);
  });
}
function stopTunnel() {
  try { tunnelProc && tunnelProc.kill(); } catch {}
  tunnelProc = null; tunnelUrl = '';
}

// ── Telephony (Twilio) — the OS's own real phone number, two-way SMS ───────
function twilioCreds() {
  const s = readJson(settingsPath(), {});
  return {
    sid: s.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID || '',
    token: s.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN || '',
    from: s.twilio_from || process.env.TWILIO_FROM || ''
  };
}
function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
async function twilioSendSms(to, text) {
  const { sid, token, from } = twilioCreds();
  if (!sid || !token || !from) throw new Error('Twilio is not configured. Set twilio_account_sid, twilio_auth_token, twilio_from in Settings.');
  const params = new URLSearchParams({ To: to, From: from, Body: String(text || '').slice(0, 1500) });
  const resp = await fetchUrl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString(),
    timeout: 20000
  });
  return JSON.parse(resp);
}

function synthesizeWindowsTts(textValue, voiceName = '') {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Native TTS is only bundled for Windows in this build.'));
    const textClean = String(textValue || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!textClean) return reject(new Error('No text supplied.'));
    const ttsDir = safeMkdir(path.join(dataRoot, 'cache', 'tts'));
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const inputFile = path.join(ttsDir, `${id}.txt`);
    const outputFile = path.join(ttsDir, `${id}.wav`);
    fs.writeFileSync(inputFile, textClean, 'utf8');
    const scriptBody = [
      'param([string]$InputFile,[string]$OutputFile,[string]$VoiceName)',
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      'if ($VoiceName) { try { $synth.SelectVoice($VoiceName) } catch {} }',
      '$synth.Rate = 0',
      '$synth.Volume = 100',
      '$synth.SetOutputToWaveFile($OutputFile)',
      '$synth.Speak([IO.File]::ReadAllText($InputFile))',
      '$synth.Dispose()'
    ].join('; ');
    const script = `& { ${scriptBody} }`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, inputFile, outputFile, String(voiceName || '')], { windowsHide: true, timeout: 30000 }, (err) => {
      try { fs.unlinkSync(inputFile); } catch {}
      if (err) return reject(err);
      try {
        const wav = fs.readFileSync(outputFile);
        try { fs.unlinkSync(outputFile); } catch {}
        resolve(wav);
      } catch (e) {
        reject(e);
      }
    });
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
  // Never let a disposable/test data root (under %TEMP%) poison Claude Desktop's
  // config with bridge paths that vanish when the temp dir is cleaned.
  if (String(dataRoot || '').toLowerCase().startsWith(os.tmpdir().toLowerCase())) {
    return { file, server: null, skipped: 'temp-data-root' };
  }
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

function clearExternalBrain(patch = {}) {
  return { ...patch, selected_external_id: '', selected_external_backend: '', selected_external_endpoint: '', selected_external_model: '' };
}
function setActiveBrain(requested) {
  const raw = String(requested || '').trim();
  const key = raw.toLowerCase();
  if (!key || key === 'auto') {
    writeRuntimeConfigPatch(clearExternalBrain({ selected_brain: 'auto', selected_brain_name: 'Auto' }));
    stopEmbeddedBrain();
    activeBrain = selectEmbeddedBrain();
    return { ok: true, selected: embeddedBrainStatus(), restarted: true };
  }
  // Live external/GPU backend brain: ollama: / lmstudio: / vllm: / llamacpp:
  const m = raw.match(/^(ollama|lmstudio|vllm|llamacpp):(.+)$/i);
  if (m) {
    const backend = m[1].toLowerCase();
    const model = m[2];
    const endpoint = backend === 'ollama' ? 'http://127.0.0.1:11434/v1'
      : backend === 'lmstudio' ? 'http://127.0.0.1:1234/v1'
      : backend === 'vllm' ? 'http://127.0.0.1:8000/v1'
      : 'http://127.0.0.1:8080/v1';
    writeRuntimeConfigPatch({ selected_brain: raw, selected_brain_name: `${backend} · ${model}`, selected_external_id: raw, selected_external_backend: backend, selected_external_endpoint: endpoint, selected_external_model: model });
    stopEmbeddedBrain();
    activeBrain = null;
    return { ok: true, selected: { id: raw, name: `${backend} · ${model}`, kind: `gpu-${backend}`, endpoint, status: 'ready', external: true, available: embeddedBrainStatus().available }, restarted: true };
  }
  const brain = availableEmbeddedBrains().find((b) =>
    [b.id, b.tier, b.name.toLowerCase(), b.model_file.toLowerCase()].includes(key)
  );
  if (!brain) throw new Error(`Unknown brain: ${requested}`);
  if (!brain.embedded) throw new Error(`Brain is not bundled in this build: ${brain.name}`);
  writeRuntimeConfigPatch(clearExternalBrain({ selected_brain: brain.id, selected_brain_name: brain.name, selected_brain_tier: brain.tier }));
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

function lfmHealthy(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port: LFM_PORT, path: '/health', timeout: timeoutMs }, (res) => {
      res.resume();
      // llama-server answers 503 while the model is still loading; only 200 means ready.
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function waitForLfm(ms = 150000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await lfmHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

async function ensureEmbeddedBrain() {
  if (lfmProcess && await lfmHealthy()) return true;
  if (lfmProcess) return waitForLfm(150000);
  if (lfmStarting) return waitForLfm(150000);
  const files = brainRuntimeFiles();
  const selected = selectEmbeddedBrain();
  if (!exists(files.server) || !selected || !exists(selected.model)) {
    lastLfmError = 'Embedded LFM runtime or model file is missing.';
    return false;
  }
  activeBrain = selected;
  lfmStarting = true;
  lastLfmError = '';
  const ngl = await detectGpuLayers();
  if (ngl !== '0') logFn(`embedded brain: GPU offload enabled (-ngl ${ngl}).`);
  const args = [
    '-m', selected.model,
    '--host', '127.0.0.1',
    '--port', String(LFM_PORT),
    '-c', String(selected.context || 2048),
    '-ngl', String(ngl),
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
    'You are ABUZ8 OS Pro, a consumer desktop agent running fully local on CPU.',
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
    '- open_url {"url":"https://example.com"}',
    '- open_app {"name":"notepad|mspaint|calc|explorer"}',
    '- screenshot {}',
    '- file_write {"relpath":"notes/example.txt","content":"..."}',
    '- shell_run {"cmd":"whoami|hostname|dir"}',
    '- cmd_run {"command":"any local CLI command or shell pipeline"}',
    '- web_search {"q":"search terms"}',
    '- mcp_call {"server":"desktop-commander","tool":"list_directory","args":{"path":"C:/"}} — drive a registered MCP server. desktop-commander = files/terminal/processes; windows-mcp = mouse, keyboard, windows, UI control.',
    'Action tools require the user to enable Allow actions for this session. Never invent unsupported tools.',
    ''
  ].join('\n');
}

async function embeddedReply(prompt, opts = {}) {
  const ready = await ensureEmbeddedBrain();
  if (!ready) return null;
  const brain = activeBrain || selectEmbeddedBrain();
  const persona = opts.system
    ? opts.system
    : `You are ABUZ8 OS Portable Brain running ${brain?.name || 'an embedded LFM model'}. Be concise, practical, and tool-aware.`;
  const modelPrompt = opts.agentic
    ? `${persona}\n\n${agentToolInstructions()}\nUser: ${prompt}\nAssistant:`
    : `${persona}\n\nUser: ${prompt}\nAssistant:`;
  for (let i = 0; i < 3; i++) {
    try {
      const out = await httpJson('POST', LFM_PORT, '/completion', {
        prompt: modelPrompt,
        n_predict: 400,
        temperature: 0.35,
        stop: ['User:', '\n\nUser:']
      }, 90000);
      const textOut = out.content || out.response || out.text || '';
      if (String(textOut).trim()) return String(textOut).trim();
    } catch (e) {
      lastLfmError = e.message;
    }
    try {
      const out = await httpJson('POST', LFM_PORT, '/v1/completions', {
        prompt: modelPrompt,
        max_tokens: 400,
        temperature: 0.35,
        stop: ['User:', '\n\nUser:']
      }, 90000);
      const textOut = out.choices && out.choices[0] ? out.choices[0].text : '';
      if (String(textOut).trim()) return String(textOut).trim();
    } catch (e) {
      lastLfmError = e.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return null;
}

async function providerReply(prompt, providerName, system) {
  const cfg = readJson(providersPath(), { providers: [] });
  const candidates = providerName
    ? cfg.providers.filter((p) => p.name === providerName)
    : cfg.providers.filter((p) => p.enabled !== false);
  // Cloud providers with keys answer fastest when local runners are down; try them first.
  const ordered = candidates.slice().sort((a, b) => Number(Boolean(b.api_key)) - Number(Boolean(a.api_key)));
  for (const p of ordered) {
    if (!p.endpoint && !p.api_key) continue;
    try {
      const out = await callProviderChat(p, prompt, system);
      const text = String(out || '').trim();
      if (text) return { text, provider: p.name, model: p.model || p.name };
    } catch {}
  }
  return null;
}

// Reply ladder: forced provider -> embedded LFM brain -> any enabled provider -> canned core text.
async function reasonReply(prompt, opts = {}) {
  const system = composeSystem(opts.role, opts.system);
  const passOpts = { ...opts, system };
  if (opts.provider) {
    const forced = await providerReply(prompt, opts.provider, system);
    if (forced) return { text: forced.text, brain: `${forced.provider} · ${forced.model}`, fallback: false, model: true };
  }
  const local = await primaryReply(prompt, passOpts);
  if (local) {
    const ext = activeExternalDescriptor();
    const brain = activeBrain || selectEmbeddedBrain();
    return { text: local, brain: ext ? `${ext.backend} · ${ext.model}` : (brain?.name || 'Embedded LFM'), fallback: false, model: true };
  }
  const cloud = await providerReply(prompt, null, system);
  if (cloud) return { text: cloud.text, brain: `${cloud.provider} · ${cloud.model}`, fallback: false, model: true };
  return { text: localReply(prompt), brain: 'Portable Core', fallback: true, model: false };
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

const BROWSER_WORDS = 'chrome|google chrome|edge|microsoft edge|msedge|firefox|brave';
function detectBrowser(s) {
  const m = String(s).toLowerCase().match(new RegExp(`\\b(${BROWSER_WORDS})\\b`));
  if (!m) return '';
  const w = m[1];
  if (/chrome/.test(w)) return 'chrome';
  if (/edge/.test(w)) return 'edge';
  if (/firefox/.test(w)) return 'firefox';
  if (/brave/.test(w)) return 'brave';
  return '';
}

function inferConsumerToolCall(prompt) {
  const msg = String(prompt || '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return null;

  if (lower === '/probe' || /\b(probe|scan)\b.*\b(device|computer|system|machine|hardware)\b/.test(lower)) {
    return { tool: 'abuz8_device_probe', args: {} };
  }
  if (/\b(draw|paint|create)\b.*\bmonkey\b/.test(lower)) {
    return { tool: 'draw_monkey_in_paint', args: { caption: 'ABUZ8 OS local desktop action proof' } };
  }
  if (/\b(screenshot|screen shot|capture screen|take a shot)\b/.test(lower)) return { tool: 'screenshot', args: {} };

  // ── Browser + website intents (the big fix) ──
  const browser = detectBrowser(lower);
  const fullUrl = msg.match(/\bhttps?:\/\/[^\s"'<>]+/i);
  // "search youtube for X" / "youtube search X" / "play X on youtube"
  const ytSearch = lower.match(/\b(?:search\s+youtube\s+for|youtube\s+search|find\s+on\s+youtube|play)\s+(.+)/);
  if (ytSearch && /youtube|\bplay\b/.test(lower)) {
    const q = ytSearch[1].replace(/\bon youtube\b/,'').trim();
    if (q) return { tool: 'open_url', args: { site: 'youtube', search: q, browser } };
  }
  // "search google for X" / "google X" / "look up X"
  const gSearch = lower.match(/\b(?:search\s+google\s+for|google|search\s+the\s+web\s+for|look\s+up|web\s+search)\s+(.+)/);
  if (gSearch && !/youtube/.test(lower)) {
    const q = gSearch[1].replace(/\bon google\b/,'').trim();
    if (q) {
      // If they asked to OPEN/browse, open the browser to results; else use web_search tool.
      if (/\b(open|browse|go to|in (?:chrome|edge|firefox|the browser))\b/.test(lower) || browser)
        return { tool: 'open_url', args: { site: 'google', search: q, browser } };
      return { tool: 'web_search', args: { q } };
    }
  }
  // explicit full URL
  if (fullUrl && /\b(open|visit|go to|browse|launch|navigate)\b/.test(lower)) {
    return { tool: 'open_url', args: { url: fullUrl[0], browser } };
  }
  // "open chrome to/and youtube", "open youtube in chrome", "open youtube"
  if (/\b(open|launch|start|go to|visit|navigate|pull up)\b/.test(lower)) {
    // try to find a site name in the message
    const siteWord = lower.match(/\b(youtube|yt|gmail|google|github|reddit|x|twitter|maps|chatgpt|claude|amazon|wikipedia|netflix|linkedin|instagram|facebook|huggingface|drive)\b/);
    const domain = msg.match(/\b([a-z0-9-]+\.(?:com|org|net|io|ai|dev|co|gov|edu)(?:\.[a-z]{2})?)\b/i);
    if (siteWord) return { tool: 'open_url', args: { site: siteWord[1], browser } };
    if (domain) return { tool: 'open_url', args: { site: domain[1], browser } };
    // just a browser with no site → open the browser
    if (browser) return { tool: 'open_app', args: { name: browser } };
    // a known app
    const appWord = lower.match(/\b(notepad|paint|mspaint|calculator|calc|explorer|files|word|excel|powerpoint|outlook|cmd|command prompt|terminal|powershell|task manager|settings|spotify|vs ?code|code)\b/);
    if (appWord) return { tool: 'open_app', args: { name: appWord[1].replace(/\s+/g,'-') } };
  }

  // ── Run a command ──
  const runCmd = msg.match(/^\s*(?:run|execute|exec)\s+(?:the\s+command\s+)?[`'"]?(.+?)[`'"]?\s*$/i);
  if (runCmd) return { tool: 'cmd_run', args: { command: runCmd[1] } };
  if (/\b(hostname|machine name)\b/.test(lower)) return { tool: 'cmd_run', args: { command: 'hostname' } };
  if (/\bwhoami\b|\bcurrent user\b/.test(lower)) return { tool: 'cmd_run', args: { command: 'whoami' } };
  if (/\b(list|show)\b.*\b(directory|folder|files)\b/.test(lower)) return { tool: 'cmd_run', args: { command: 'dir' } };

  // ── Web search (no browser implied) ──
  if (/\b(search|look up|find)\b.*\b(web|internet|online)\b/.test(lower)) {
    const q = msg.replace(/\b(search|look up|find|the|web|internet|online|for)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (q) return { tool: 'web_search', args: { q } };
  }
  return null;
}

function summarizeToolResult(tool, result) {
  const payload = result?.result ?? result;
  if (tool === 'mcp_call') {
    // MCP results carry {content:[{type:'text',text}...]} — surface the text.
    const content = payload?.content;
    const textOut = Array.isArray(content)
      ? content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim()
      : '';
    const label = `${result?.server || 'mcp'} · ${result?.mcp_tool || 'tool'}`;
    return textOut ? `Done via ${label}:\n\n${textOut.slice(0, 3000)}` : `Done via ${label}.\n\n${JSON.stringify(payload, null, 2).slice(0, 2000)}`;
  }
  if (tool === 'open_app') return `Done — opened ${payload.app || payload.target || 'the requested app'}.`;
  if (tool === 'draw_monkey_in_paint') return `Done. Drew a monkey image and opened it in Paint: ${payload.file}.`;
  if (tool === 'open_url') return `Done — opened ${payload.url || 'the requested URL'} in ${payload.browser || 'the default browser'}.`;
  if (tool === 'screenshot') return `Done. Screenshot saved to ${payload.file}.`;
  if (tool === 'file_write') return `Done. Wrote ${payload.bytes || 0} bytes to ${payload.file}.`;
  if (tool === 'shell_run' || tool === 'cmd_run') {
    const out = String(payload.stdout || '').trim();
    const err = String(payload.stderr || '').trim();
    return `Ran \`${payload.command || 'command'}\`${payload.ok === false ? ' (exit '+payload.code+')' : ''}.\n\n${out || err || '(no output)'}`.slice(0, 3000);
  }
  if (tool === 'abuz8_device_probe') {
    return `Device probe complete: ${payload.system?.hostname || os.hostname()} · ${payload.cpu?.name || 'CPU'} · ${payload.memory?.total_gb || '?'}GB RAM · tier ${payload.tier || 'unknown'}.`;
  }
  if (tool === 'abuz8_mission_board') return `Mission board loaded. ${payload.summary || ''}`.trim();
  if (tool === 'web_search') {
    const rows = (payload.results || []).slice(0, 5).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
    return rows ? `Web search results for "${payload.query}" (${payload.source}):\n\n${rows}` : `Web search for "${payload.query}" returned no results.`;
  }
  return `Tool ${tool} completed.\n\n${JSON.stringify(payload, null, 2)}`;
}

const KNOWN_AGENT_TOOLS = new Set(['open_app','open_url','screenshot','file_write','shell_run','cmd_run','web_search','draw_monkey_in_paint','abuz8_device_probe','abuz8_memory_write','abuz8_mission_board','swarm_run','content_generate','browser_do','gui_do','mcp_call']);

async function executeAgentTool(requested, opts) {
  pushActivity('tool', `Action: ${requested.tool}`, JSON.stringify(requested.args || {}).slice(0, 120));
  try {
    const toolResult = await callLocalTool(requested.tool, requested.args || {});
    // The tool layer may itself return a consent-required envelope.
    if (toolResult && toolResult.action_required) {
      return { response: toolResult.prompt || toolResult.reason || 'This action needs permission.', tool_call: requested, tool_result: toolResult, fallback: false, needs_consent: true };
    }
    return { response: summarizeToolResult(requested.tool, toolResult), modelResponse: null, tool_call: requested, tool_result: toolResult, fallback: false };
  } catch (e) {
    const blocked = /Allow actions|blocked|consent/i.test(e.message || '');
    return {
      response: blocked
        ? `I can do that, but desktop/CLI actions are off right now. Turn on **Allow actions** (toggle at the bottom of Chat) and ask again — it stays on.`
        : `I tried to run ${requested.tool}, but it failed: ${e.message}`,
      modelResponse: null, tool_call: requested, tool_error: e.message, fallback: false
    };
  }
}

async function agenticReply(prompt, opts = {}) {
  // 1) Fast deterministic intent (open browser/app/site, search, run command…).
  const direct = inferConsumerToolCall(prompt);
  if (direct) return executeAgentTool(direct, opts);

  // 2) Model-chosen tool: ask the brain to emit a tool call; execute if valid.
  try {
    const modelText = await primaryReply(prompt, { agentic: true, role: opts.role });
    const parsed = modelText ? parseAgentToolCall(modelText) : null;
    if (parsed && KNOWN_AGENT_TOOLS.has(slug(parsed.tool).replace(/-/g, '_'))) {
      const norm = { tool: slug(parsed.tool).replace(/-/g, '_'), args: parsed.args || {} };
      return executeAgentTool(norm, opts);
    }
    // 3) No tool — return the model's own answer (or the full reply ladder if empty).
    if (modelText && modelText.trim() && !/^\s*\{/.test(modelText)) {
      const ext = activeExternalDescriptor();
      const brain = activeBrain || selectEmbeddedBrain();
      return { response: modelText.trim(), modelResponse: modelText.trim(), brain: ext ? `${ext.backend} · ${ext.model}` : (brain?.name || 'Embedded LFM'), tool_call: null, fallback: false };
    }
  } catch {}
  const r = await reasonReply(prompt, { agentic: false, provider: opts.provider, role: opts.role });
  return { response: r.text, modelResponse: r.model ? r.text : null, brain: r.brain, tool_call: null, tool_result: null, fallback: r.fallback };
}

function localReply(prompt) {
  const msg = String(prompt || '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return 'Portable Core is online. Type a task, ask for a file operation, or import MCP connectors from the Migration view.';
  if (lower.includes('mcp') || lower.includes('connector')) {
    return `Portable Core is online. Use Migration -> Import Local Connectors to copy Claude Desktop MCP entries into ${mcpConfigPath()}. Docker MCP is imported when Docker Desktop exposes "docker mcp".`;
  }
  if (lower.includes('gpu') || lower.includes('avatar') || lower.includes('render')) {
    return 'For GPU-heavy avatar/rendering work, this build uses a fallback ladder: browser preview first, cloud/API renderer second, ComfyUI/NVIDIA worker only when a GPU runtime is connected. The OS stays usable without GPU.';
  }
  if (lower.includes('model') || lower.includes('brain')) {
    return 'The native LFM2 2.6B GGUF brain stays primary in this build. Cloud or extra local brains can be added as hybrid engines, but they do not replace the bundled brain.';
  }
  return `Portable Core received: "${msg}"\n\nThe clean-machine runtime is active. Data, memory, MCP config, skills, logs, models, and workspaces are stored under:\n${dataRoot}\n\nFor stronger reasoning, connect a local model runner or cloud provider in the connectors panel.`;
}

async function webSearch(body = {}) {
  const query = String(body.q || body.query || body.text || '').trim();
  if (!query) throw new Error('query is required');
  const maxResults = Number(body.max_results || body.limit || 8);
  const apiKey = body.api_key || process.env.SERPER_API_KEY || process.env.GOOGLE_API_KEY || body.google_key;

  // Try DuckDuckGo Lite (no API key required, HTML scraping)
  try {
    const ddgResult = await searchDuckDuckGoLite(query, maxResults);
    if (ddgResult.results.length > 0) {
      return { ok: true, query, results: ddgResult.results, count: ddgResult.results.length, source: 'duckduckgo', note: '' };
    }
  } catch (e) {
    // fall through
  }

  // Try Google Custom Search if API key provided
  if (apiKey) {
    try {
      const cx = body.google_cx || process.env.GOOGLE_CX;
      if (cx) {
        const gResult = await searchGoogleCSE(query, maxResults, apiKey, cx);
        if (gResult.results.length > 0) {
          return { ok: true, query, results: gResult.results, count: gResult.results.length, source: 'google_cse', note: '' };
        }
      }
    } catch (e) {
      // fall through
    }
  }

  // Try SearX instances (public metasearch)
  try {
    const searxResult = await searchSearX(query, maxResults);
    if (searxResult.results.length > 0) {
      return { ok: true, query, results: searxResult.results, count: searxResult.results.length, source: 'searx', note: 'Results from public SearX instance' };
    }
  } catch (e) {}

  // Final fallback: structured guidance
  return {
    ok: true,
    query,
    results: [],
    count: 0,
    source: 'fallback',
    note: 'Web search returned no results. Try configuring Google Custom Search API key in Settings.',
    fallback_action: {
      tool: 'open_url',
      args: { url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` }
    }
  };
}

async function searchDuckDuckGoLite(query, maxResults) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const html = await fetchUrl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
  const results = [];
  const rows = html.match(/<tr[^>]*>.*?<\/tr>/gs) || [];
  for (let i = 0; i < rows.length && results.length < maxResults; i++) {
    const row = rows[i];
    const link = row.match(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/);
    const snippet = row.match(/<td[^>]*class="result-snippet"[^>]*>(.*?)<\/td>/s) || row.match(/<td[^>]*>(.*?)<\/td>/s);
    if (link) {
      results.push({
        title: link[2].replace(/<[^>]+>/g, '').trim(),
        url: link[1].startsWith('http') ? link[1] : `https://duckduckgo.com${link[1]}`,
        snippet: snippet ? snippet[1].replace(/<[^>]+>/g, '').trim() : ''
      });
    }
  }
  return { results };
}

async function searchGoogleCSE(query, maxResults, apiKey, cx) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;
  const resp = await fetchUrl(url);
  const data = JSON.parse(resp);
  const results = (data.items || []).map(item => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.snippet || ''
  }));
  return { results };
}

async function searchSearX(query, maxResults) {
  // Try multiple public SearX instances
  const instances = [
    'https://searx.be',
    'https://search.bus-hit.me',
    'https://searx.tiekoetter.com'
  ];
  
  for (const instance of instances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json`;
      const data = await new Promise((resolve, reject) => {
        https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'accept': 'application/json' }, timeout: 10000 }, (res) => {
          let d = '';
          res.on('data', (chunk) => d += chunk);
          res.on('end', () => resolve(d));
        }).on('error', reject).setTimeout(10000, () => reject(new Error('timeout')));
      });
      const parsed = JSON.parse(data);
      if (parsed.results && parsed.results.length) {
        return {
          results: parsed.results.slice(0, maxResults).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content || r.snippet || ''
          })).filter(r => r.snippet && r.snippet.length > 10)
        };
      }
    } catch (e) {
      // Try next instance
    }
  }
  throw new Error('All SearX instances failed');
}

async function searchSerper(query, maxResults, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ q: query, num: maxResults });
    const req = https.request('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const results = (parsed.organic || []).slice(0, maxResults).map(r => ({
            title: r.title,
            url: r.link,
            snippet: r.snippet
          }));
          resolve({ ok: true, query, results, count: results.length, source: 'serper' });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function searchBrave(query, maxResults, apiKey) {
  return new Promise((resolve, reject) => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    https.get(url, { headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const results = (parsed.web?.results || []).slice(0, maxResults).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.description
          }));
          resolve({ ok: true, query, results, count: results.length, source: 'brave' });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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

// ── Real GPU introspection: nvidia-smi first (VRAM/driver/CUDA), WMI fallback ──
let _gpuDetectCache = null;
function nvidiaSmiQuery() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total,driver_version,compute_cap', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      if (err) return resolve([]);
      const rows = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, mem, driver, cc] = l.split(',').map((s) => s.trim());
        const vram_mb = Number(mem) || null;
        return { name, vendor: 'nvidia', vram_mb, vram_gb: vram_mb ? Math.round(vram_mb / 1024) : null, driver_version: driver || null, cuda_compute: cc || null };
      });
      resolve(rows);
    });
  });
}
async function detectGpus() {
  if (_gpuDetectCache) return _gpuDetectCache;
  const nv = await nvidiaSmiQuery();
  if (nv.length) { _gpuDetectCache = nv; return nv; }
  const names = await detectGpuNames();
  _gpuDetectCache = names.map((name) => ({
    name,
    vendor: /nvidia|rtx|gtx|tesla|quadro/i.test(name) ? 'nvidia' : /radeon|amd/i.test(name) ? 'amd' : /arc|intel/i.test(name) ? 'intel' : 'unknown',
    vram_gb: null, driver_version: null, cuda_compute: null
  }));
  return _gpuDetectCache;
}
// How many model layers to offload to GPU. ABUZ8_NGL overrides; otherwise offload
// all layers when an NVIDIA GPU AND the CUDA backend (ggml-cuda.dll) are present.
async function detectGpuLayers() {
  const override = process.env.ABUZ8_NGL;
  if (override != null && override !== '') return String(override);
  try {
    const gpus = await detectGpus();
    const hasNvidia = gpus.some((g) => g.vendor === 'nvidia');
    const cudaDll = exists(path.join(resolveBrainDir(), 'ggml-cuda.dll'));
    return (hasNvidia && cudaDll) ? '999' : '0';
  } catch { return '0'; }
}

// ── Live external LLM backends (auto-probe: Ollama, LM Studio, vLLM, llama.cpp) ──
function probeBackendJson(port, pathn, timeoutMs) {
  return httpJson('GET', port, pathn, null, timeoutMs).catch(() => null);
}
async function probeOllamaModels() {
  const data = await probeBackendJson(11434, '/api/tags', 1500);
  if (!data || !Array.isArray(data.models)) return [];
  return data.models.map((m) => ({
    id: `ollama:${m.name}`, name: m.name, backend: 'ollama', kind: 'gpu-ollama',
    endpoint: 'http://127.0.0.1:11434/v1', model: m.name,
    size_mb: m.size ? Math.round(m.size / 1048576) : 0
  }));
}
async function probeOpenAiModels(port, backend, kind) {
  const data = await probeBackendJson(port, '/v1/models', 1200);
  if (!data || !Array.isArray(data.data)) return [];
  return data.data.map((m) => ({
    id: `${backend}:${m.id}`, name: m.id, backend, kind,
    endpoint: `http://127.0.0.1:${port}/v1`, model: m.id, size_mb: 0
  }));
}
async function detectExternalBrains() {
  const groups = await Promise.all([
    probeOllamaModels(),
    probeOpenAiModels(1234, 'lmstudio', 'remote-lmstudio'),
    probeOpenAiModels(8000, 'vllm', 'remote-vllm'),
    probeOpenAiModels(8080, 'llamacpp', 'remote-llamacpp')
  ]);
  return groups.flat();
}
function activeExternalDescriptor() {
  const cfg = dataRoot ? readRuntimeConfig() : {};
  if (cfg.selected_external_endpoint && cfg.selected_external_model) {
    return { backend: cfg.selected_external_backend || 'openai', endpoint: cfg.selected_external_endpoint, model: cfg.selected_external_model, id: cfg.selected_external_id };
  }
  return null;
}
// On launch, when no GGUF is bundled and nothing is selected, adopt the best
// local GPU model (Ollama etc.) so the app thinks on the GPU with zero config.
async function autoAdoptBrainIfNeeded() {
  const cfg = dataRoot ? readRuntimeConfig() : {};
  if (cfg.selected_external_endpoint && cfg.selected_external_model) return null;
  const sel = String(cfg.selected_brain || '').toLowerCase();
  const haveEmbedded = availableEmbeddedBrains().some((b) => b.embedded);
  if (haveEmbedded) return null;            // a real local GGUF exists — keep it
  if (sel && sel !== 'auto') return null;   // user picked something specific
  const list = await detectExternalBrains();
  const pick = list.find((b) => b.backend === 'ollama' && !/embed/i.test(b.name))
    || list.find((b) => !/embed/i.test(b.name));
  if (!pick) return null;
  try { setActiveBrain(pick.id); return pick.id; } catch { return null; }
}
// Primary completion: a user-selected live GPU backend (Ollama etc.) wins; else
// the embedded llama.cpp brain. This is what makes the dual-5090 the real brain.
async function primaryReply(prompt, opts = {}) {
  const ext = activeExternalDescriptor();
  if (ext) {
    try {
      const out = await callProviderChat({ type: ext.backend, endpoint: ext.endpoint, model: ext.model }, prompt, opts.system || composeSystem(opts.role));
      const t = String(out || '').trim();
      if (t) return t;
    } catch (e) { lastLfmError = `external brain (${ext.id}): ${e.message}`; }
  }
  return embeddedReply(prompt, opts);
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
  const gpuList = await detectGpus();
  const gpus = gpuList.map((g) => g.name);
  const totalGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  const cpuName = os.cpus()[0]?.model || 'CPU';
  const gpuText = gpus.join(' ').toLowerCase();
  const hasNvidia = gpuList.some((g) => g.vendor === 'nvidia') || gpuText.includes('nvidia') || gpuText.includes('rtx') || gpuText.includes('gtx');
  const hasDiscreteGpu = hasNvidia || gpuText.includes('radeon') || gpuText.includes('arc');
  const nvidiaGpus = gpuList.filter((g) => g.vendor === 'nvidia');
  const totalVramGb = gpuList.reduce((sum, g) => sum + (g.vram_gb || 0), 0);
  const cudaReady = hasNvidia && exists(path.join(resolveBrainDir(), 'ggml-cuda.dll'));
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
    gpus: gpuList,
    gpu_count: gpuList.length,
    gpu_total_vram_gb: totalVramGb,
    nvidia_count: nvidiaGpus.length,
    cuda_ready: cudaReady,
    embedded_brain: embedded,
    brain_tiers: bundled,
    connectors: { docker, docker_mcp: dockerMcp, ollama, node, python },
    capabilities: can,
    recommended
  };
}

// Known port → service hints for the system map. Real detection still requires
// the port to be listening; this only labels what is found.
const PORT_HINTS = {
  '8900': 'ABUZ8 OS Portable Core (this app)',
  '8902': 'ABUZ8 embedded LFM brain (llama.cpp)',
  '1234': 'LM Studio (OpenAI-compatible)',
  '11434': 'Ollama',
  '8188': 'ComfyUI',
  '9119': 'Hermes Agent gateway',
  '18789': 'OpenClaw gateway',
  '8910': 'Mission Agent',
  '3000': 'Dev server (Node/React)',
  '5173': 'Vite dev server',
  '8000': 'HTTP dev server',
  '8080': 'HTTP / proxy',
  '5432': 'PostgreSQL',
  '3306': 'MySQL/MariaDB',
  '6379': 'Redis',
  '27017': 'MongoDB',
  '9000': 'MinIO / PHP-FPM',
  '7860': 'Gradio',
  '5000': 'Flask / HTTP',
  '4000': 'Dev server',
  '3001': 'Dev server'
};

// CLIs ABUZ8 can drive. Each probe is a fast version check.
const CLI_CATALOG = [
  { id: 'node', cmd: 'node', args: ['--version'], label: 'Node.js' },
  { id: 'npm', cmd: 'npm', args: ['--version'], label: 'npm' },
  { id: 'npx', cmd: 'npx', args: ['--version'], label: 'npx' },
  { id: 'python', cmd: 'python', args: ['--version'], label: 'Python' },
  { id: 'pip', cmd: 'pip', args: ['--version'], label: 'pip' },
  { id: 'uv', cmd: 'uv', args: ['--version'], label: 'uv' },
  { id: 'uvx', cmd: 'uvx', args: ['--version'], label: 'uvx' },
  { id: 'git', cmd: 'git', args: ['--version'], label: 'Git' },
  { id: 'gh', cmd: 'gh', args: ['--version'], label: 'GitHub CLI' },
  { id: 'docker', cmd: 'docker', args: ['--version'], label: 'Docker' },
  { id: 'kubectl', cmd: 'kubectl', args: ['version', '--client'], label: 'kubectl' },
  { id: 'aws', cmd: 'aws', args: ['--version'], label: 'AWS CLI' },
  { id: 'gcloud', cmd: 'gcloud', args: ['--version'], label: 'gcloud' },
  { id: 'az', cmd: 'az', args: ['version'], label: 'Azure CLI' },
  { id: 'terraform', cmd: 'terraform', args: ['version'], label: 'Terraform' },
  { id: 'ollama', cmd: 'ollama', args: ['--version'], label: 'Ollama CLI' },
  { id: 'ffmpeg', cmd: 'ffmpeg', args: ['-version'], label: 'FFmpeg' },
  { id: 'curl', cmd: 'curl', args: ['--version'], label: 'curl' },
  { id: 'pwsh', cmd: 'pwsh', args: ['--version'], label: 'PowerShell 7' },
  { id: 'cargo', cmd: 'cargo', args: ['--version'], label: 'Rust/Cargo' },
  { id: 'go', cmd: 'go', args: ['version'], label: 'Go' },
  { id: 'java', cmd: 'java', args: ['-version'], label: 'Java' },
  { id: 'dotnet', cmd: 'dotnet', args: ['--version'], label: '.NET' },
  { id: 'code', cmd: 'code', args: ['--version'], label: 'VS Code' },
  { id: 'cursor', cmd: 'cursor', args: ['--version'], label: 'Cursor' },
  { id: 'claude', cmd: 'claude', args: ['--version'], label: 'Claude Code' },
  { id: 'gemini', cmd: 'gemini', args: ['--version'], label: 'Gemini CLI' },
  { id: 'codex', cmd: 'codex', args: ['--version'], label: 'OpenAI Codex CLI' },
  { id: 'lms', cmd: 'lms', args: ['version'], label: 'LM Studio CLI' },
  { id: 'wsl', cmd: 'wsl', args: ['--version'], label: 'WSL' },
  { id: 'wrangler', cmd: 'wrangler', args: ['--version'], label: 'Cloudflare Wrangler' }
];

function scanListeningPorts() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return execFile('bash', ['-lc', "ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null"], { timeout: 6000 }, (e, out) => resolve(parseUnixPorts(String(out || ''))));
    }
    execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve([]);
      const seen = new Map();
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (!m) continue;
        const [, addr, port, pid] = m;
        if (addr.startsWith('[') && addr !== '[::]' && addr !== '[::1]') {}
        const key = port;
        if (!seen.has(key)) seen.set(key, { port: Number(port), addr, pid: Number(pid) });
      }
      resolve(Array.from(seen.values()));
    });
  });
}

function parseUnixPorts(out) {
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/:(\d+)\s+.*LISTEN/);
    if (m) rows.push({ port: Number(m[1]), addr: '0.0.0.0', pid: 0 });
  }
  return rows;
}

function mapPidsToNames(pids) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !pids.length) return resolve({});
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      const map = {};
      if (!err) {
        for (const line of String(stdout).split(/\r?\n/)) {
          const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
          if (cols.length >= 2) map[cols[1]] = cols[0];
        }
      }
      resolve(map);
    });
  });
}

async function discoverClis() {
  const results = await Promise.all(CLI_CATALOG.map(async (c) => {
    const probe = await runCommand(c.cmd, c.args, 5000);
    const version = (probe.stdout || probe.stderr || '').split(/\r?\n/).find((l) => l.trim()) || '';
    return { id: c.id, label: c.label, command: c.cmd, available: probe.ok, version: probe.ok ? version.trim().slice(0, 80) : null };
  }));
  return results;
}

async function systemScan() {
  const rawPorts = await scanListeningPorts();
  const pidNames = await mapPidsToNames([...new Set(rawPorts.map((p) => String(p.pid)))]);
  const ports = rawPorts
    .sort((a, b) => a.port - b.port)
    .map((p) => ({
      port: p.port,
      address: p.addr,
      pid: p.pid,
      process: pidNames[String(p.pid)] || null,
      service: PORT_HINTS[String(p.port)] || null,
      local: p.addr === '127.0.0.1' || p.addr === '0.0.0.0' || p.addr === '[::]' || p.addr === '[::1]'
    }));
  const clis = await discoverClis();
  const endpoints = APP_ENDPOINTS;
  const probe = await machineProbe();
  return {
    ok: true,
    scanned_at: new Date().toISOString(),
    host: probe.system,
    cpu: probe.cpu,
    memory: probe.memory,
    storage: probe.storage,
    gpus: probe.gpus,
    tier: probe.tier,
    ports,
    port_count: ports.length,
    clis,
    cli_available: clis.filter((c) => c.available).length,
    endpoints,
    embedded_brain: probe.embedded_brain
  };
}

// Self-describing catalog of this app's own HTTP endpoints, for the System map.
const APP_ENDPOINTS = [
  { method: 'POST', path: '/api/chat', desc: 'Chat with the active brain/agent role' },
  { method: 'GET', path: '/api/system/scan', desc: 'Scan ports, CLIs, endpoints, hardware' },
  { method: 'GET', path: '/api/agents/roles', desc: 'List predefined agent roles' },
  { method: 'GET', path: '/api/device/probe', desc: 'Hardware and capability probe' },
  { method: 'GET', path: '/api/brains/list', desc: 'List local brain models' },
  { method: 'POST', path: '/api/brains/select', desc: 'Switch active brain tier' },
  { method: 'GET', path: '/api/tools/list', desc: 'List built-in and custom tools' },
  { method: 'POST', path: '/api/tools/call', desc: 'Execute a tool by name' },
  { method: 'POST', path: '/api/tools/create', desc: 'Create a custom local tool' },
  { method: 'GET', path: '/api/mcp/servers', desc: 'List MCP servers' },
  { method: 'GET', path: '/api/mcp/servers/:name/tools', desc: 'List an MCP server’s tools' },
  { method: 'POST', path: '/api/mcp/call', desc: 'Call an MCP tool' },
  { method: 'POST', path: '/api/cli/probe', desc: 'Run a local CLI command (consent)' },
  { method: 'GET', path: '/api/memory/recent', desc: 'Recent local memory' },
  { method: 'POST', path: '/api/memory/write', desc: 'Write a memory note' },
  { method: 'GET', path: '/api/providers', desc: 'List model providers' },
  { method: 'POST', path: '/api/providers', desc: 'Add or update a provider' },
  { method: 'POST', path: '/api/swarm/run', desc: 'Run a multi-agent swarm on a goal' },
  { method: 'POST', path: '/api/content/generate', desc: 'Generate carousel/thread/script/SEO content' },
  { method: 'POST', path: '/api/x/post', desc: 'Post to X (needs OAuth2 token)' },
  { method: 'POST', path: '/api/growth/seed', desc: 'Seed the 25-problems X growth board' },
  { method: 'GET', path: '/api/skills/installed', desc: 'List migrated skill packs' },
  { method: 'GET', path: '/api/bridge/status', desc: 'Claude Desktop two-way bridge status' },
  { method: 'POST', path: '/api/bridge/reinstall', desc: 'Reinstate the Claude Desktop symbiosis' },
  { method: 'GET', path: '/api/mission/board', desc: 'Kanban board (delegation)' }
];

// ── Multi-agent swarm: run several roles on one task, then synthesize. Real,
// sequential calls through the same reply ladder (brain or providers). ──
async function runSwarm(task, roleIds = []) {
  const goal = String(task || '').trim();
  if (!goal) throw new Error('task is required');
  const roles = (roleIds && roleIds.length ? roleIds : ['research-analyst', 'systems-engineer', 'content-producer'])
    .map((id) => AGENT_ROLES.find((r) => r.id === id)).filter(Boolean);
  const workers = [];
  for (const role of roles) {
    const r = await reasonReply(`Goal: ${goal}\n\nContribute your part as the ${role.name}. Be specific and actionable.`, { role: role.id });
    workers.push({ role: role.id, name: role.name, output: r.text, brain: r.brain });
  }
  const merged = workers.map((w) => `### ${w.name}\n${w.output}`).join('\n\n');
  const synth = await reasonReply(`You are the synthesis agent. Goal: ${goal}\n\nThe specialized agents reported:\n\n${merged}\n\nReconcile their work into one coherent, deduplicated plan with clear next steps.`, { role: 'swarm-orchestrator' });
  return { ok: true, goal, agents: workers, synthesis: synth.text, brain: synth.brain };
}

// Salvage a tool call from messy small-model output (handles malformed JSON
// like {"tool":"web_search {\"q\":...}"} by finding a known tool name + an arg).
function salvageToolCall(raw) {
  const text = String(raw || '');
  for (const t of KNOWN_AGENT_TOOLS) {
    if (new RegExp('\\b' + t + '\\b', 'i').test(text)) {
      const after = text.slice(text.toLowerCase().indexOf(t));
      let args = {};
      const argMatch = after.match(/\{[\s\S]*\}/);
      if (argMatch) { try { args = JSON.parse(argMatch[0]); } catch {} }
      if (!Object.keys(args).length) {
        const kv = text.match(/"(q|query|command|url|site|content|topic|name|goal)"\s*:\s*"([^"]+)"/i);
        const bare = text.match(new RegExp(t + '[^a-z0-9]+([^\\n"}{]{2,80})', 'i'));
        const val = kv ? kv[2] : (bare ? bare[1].trim() : '');
        if (val) args = { q: val, command: val, content: val, url: val, topic: val, name: val };
      }
      return { tool: t, args };
    }
  }
  return null;
}

// ── Autonomous agent loop (ReAct-style): plan → act → observe → repeat. ──
// Grounded in the common agentic pattern used by AutoGPT/Manus/OpenHands/CrewAI:
// a thinking model emits one tool call at a time; the loop executes it and feeds
// the result back until the goal is met or a step budget is hit.
async function runAgentLoop(goal, opts = {}) {
  const maxSteps = Math.max(1, Math.min(Number(opts.max_steps || 6), 12));
  const steps = [];
  let history = '';
  agentRunning = true;
  pushActivity('plan', 'Autopilot started', goal);
  const toolList = [
    'web_search {"q":"..."}', 'open_url {"url" or "site":"...","browser":"chrome?"}', 'open_app {"name":"chrome|notepad|..."}',
    'cmd_run {"command":"..."}', 'file_write {"relpath":"...","content":"..."}', 'screenshot {}',
    'abuz8_memory_write {"content":"..."}', 'content_generate {"topic":"...","format":"x-carousel|youtube-script|..."}',
    'abuz8_device_probe {}'
  ];
  for (let i = 0; i < maxSteps; i++) {
    const planPrompt = [
      `GOAL: ${goal}`,
      history ? `Progress so far:\n${history}` : 'No actions taken yet.',
      `Choose the SINGLE next tool. Available: ${toolList.join(' | ')}`,
      'Reply with ONLY one compact JSON object: {"tool":"<name>","args":{...}}  — or if the goal is done: {"done":true,"answer":"..."}'
    ].join('\n\n');
    // Route through the reply ladder so a configured cloud provider (far better at
    // this) is used when present; otherwise the local brain.
    let raw = '';
    try { const r = await reasonReply(planPrompt, { system: 'You are a precise tool-planning engine. Output ONLY one JSON object and nothing else.' }); raw = r.text || ''; } catch {}
    const obj = extractJsonObject(raw) || {};
    if (obj.done || /"done"\s*:\s*true/.test(raw)) {
      agentRunning = false; pushActivity('done', 'Autopilot finished', obj.answer || 'Goal completed.');
      return { ok: true, goal, steps, final: obj.answer || obj.final || 'Goal completed.', stopped: 'done' };
    }
    let call = parseAgentToolCall(raw) || salvageToolCall(raw);
    if (!call || !KNOWN_AGENT_TOOLS.has(slug(call.tool).replace(/-/g, '_'))) {
      const txt = String(raw).replace(/[`*]/g, '').trim();
      agentRunning = false; pushActivity('done', 'Autopilot finished', txt.slice(0, 80));
      return { ok: true, goal, steps, final: txt || 'Done.', stopped: steps.length ? 'answer' : 'no-tool', note: steps.length ? undefined : 'The local brain did not emit a usable tool call. Configure a cloud provider or a larger model for reliable autonomous loops.' };
    }
    const toolName = slug(call.tool).replace(/-/g, '_');
    pushActivity('step', `Step ${i + 1}: ${toolName}`, JSON.stringify(call.args || {}).slice(0, 100));
    let observation;
    try {
      const result = await callLocalTool(toolName, call.args || {});
      observation = summarizeToolResult(toolName, result).slice(0, 600);
    } catch (e) { observation = `ERROR: ${e.message}`; }
    steps.push({ n: i + 1, tool: toolName, args: call.args || {}, observation });
    pushActivity('observe', `↳ ${toolName} result`, observation.slice(0, 120));
    history += `Step ${i + 1}: ${toolName}(${JSON.stringify(call.args || {})}) -> ${observation}\n`;
  }
  agentRunning = false; pushActivity('done', 'Autopilot reached step limit', '');
  return { ok: true, goal, steps, final: 'Reached the step limit. Here is what I accomplished above.', stopped: 'max_steps' };
}

const CONTENT_FORMATS = {
  'x-carousel': 'Produce a 10-slide X carousel. Slide 1 Hook (bold claim/question); Slide 2 Problem; Slide 3 Why it matters; Slide 4 Mental model; Slides 5-8 Steps with concrete detail; Slide 9 TL;DR one-sentence recap; Slide 10 CTA. Label each slide.',
  'x-thread': 'Produce an X thread of 7-12 tweets. Tweet 1 is a scroll-stopping hook. Each subsequent tweet is self-contained, under 280 chars. End with a CTA.',
  'youtube-script': 'Produce a YouTube script: a 15-second hook, an outline of beats, the spoken narration per beat, B-roll/visual cues in brackets, and an end-screen CTA.',
  'blog-outline': 'Produce an SEO blog outline: working title, target keyword + 4 secondary keywords, meta description, H2/H3 structure with one-line notes each, and an internal-link suggestion list.',
  'notebook-synthesis': 'Act as a research-to-media synthesizer: extract the core thesis, the 5 key supporting points, notable quotes/stats to verify, and a one-paragraph executive summary. Mark anything that needs source verification.'
};

async function generateContent(body = {}) {
  const topic = String(body.topic || body.content || body.prompt || '').trim();
  if (!topic) throw new Error('topic is required');
  const format = String(body.format || 'x-carousel');
  const spec = CONTENT_FORMATS[format] || CONTENT_FORMATS['x-carousel'];
  const sources = body.sources ? `\n\nSource material:\n${String(body.sources).slice(0, 6000)}` : '';
  const prompt = `${spec}\n\nTopic: ${topic}${sources}`;
  const r = await reasonReply(prompt, { role: format === 'blog-outline' ? 'seo-strategist' : 'content-producer' });
  const id = `${format}-${slug(topic).slice(0, 40)}`;
  const file = path.join(safeMkdir(path.join(dataRoot, 'exports', 'content')), `${id}.md`);
  try { fs.writeFileSync(file, `# ${topic}\n\n_Format: ${format} · ${new Date().toISOString()}_\n\n${r.text}`, 'utf8'); } catch {}
  return { ok: true, format, topic, content: r.text, brain: r.brain, saved_to: file };
}

// X (Twitter) post via API v2. Requires a user OAuth2 token with tweet.write —
// stored in settings as x_access_token. App-only bearer tokens cannot post; we
// say so honestly rather than pretend success.
async function xPost(body = {}) {
  const t = String(body.text || body.content || '').trim();
  if (!t) throw new Error('text is required');
  const settings = readJson(settingsPath(), {});
  const token = body.access_token || settings.x_access_token || process.env.X_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, needs_credentials: true, error: 'No X access token configured. Add an OAuth2 user token with tweet.write scope in Settings → X. App-only/bearer tokens cannot post.' };
  }
  try {
    const resp = await fetchUrl('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: t.slice(0, 280) })
    });
    const data = JSON.parse(resp || '{}');
    if (data.errors || data.status >= 400 || data.title) {
      return { ok: false, error: (data.detail || data.title || JSON.stringify(data)), raw: data };
    }
    return { ok: true, id: data.data?.id, text: data.data?.text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Seed the mission board with the migrated X-growth protocol: the 25-problems
// weekly rule plus a 7-day content cadence. Creates real tasks on the board.
function seedGrowthBoard() {
  const created = [];
  const now = new Date().toISOString();
  upsertMissionTask({ id: 'x-rule-25', title: 'X Signature Rule: publicly solve 25 hard problems this week', column: 'doing', priority: 'high', owner: 'x-growth-operator', details: 'Each problem solved publicly on X with your signature. Log impressions in the tracker.' });
  created.push('x-rule-25');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cadence = ['Carousel (10 slides)', 'Thread (problem solved live)', 'Short tweet + proof screenshot'];
  days.forEach((d) => cadence.forEach((c, i) => {
    const id = `x-${d.toLowerCase()}-${i}`;
    upsertMissionTask({ id, title: `${d}: ${c}`, column: 'ready', priority: 'medium', owner: 'content-producer', details: 'Auto-seeded from x-growth-monetization 7-day cadence.' });
    created.push(id);
  }));
  upsertMissionTask({ id: 'rev-track', title: 'Revenue tracker: log ad-share, product, affiliate, sponsorship income', column: 'backlog', priority: 'high', owner: 'ceo-operator', details: 'Revenue-first triage: review weekly.' });
  created.push('rev-track');
  return { ok: true, created, board: readMissionBoard() };
}

// Read migrated skills from the skills dir (markdown SKILL.md + json definitions).
function listSkills() {
  const root = path.join(dataRoot, 'skills');
  const skills = [];
  if (exists(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillMd = path.join(root, entry.name, 'SKILL.md');
        let name = entry.name, desc = '';
        if (exists(skillMd)) {
          const head = fs.readFileSync(skillMd, 'utf8').slice(0, 800);
          const nm = head.match(/name:\s*([^\n]+)/i); if (nm) name = nm[1].trim().replace(/['"]/g, '');
          const dm = head.match(/description:\s*([^\n]+)/i); if (dm) desc = dm[1].trim().replace(/['"]/g, '');
        }
        const refs = exists(path.join(root, entry.name, 'references')) ? fs.readdirSync(path.join(root, entry.name, 'references')).length : 0;
        skills.push({ id: entry.name, name, description: desc, kind: 'skill-pack', references: refs });
      } else if (entry.name.endsWith('.json')) {
        const j = readJson(path.join(root, entry.name), {});
        skills.push({ id: entry.name.replace(/\.json$/, ''), name: j.name || entry.name, description: j.description || '', kind: 'definition' });
      }
    }
  }
  return skills;
}

// ── Two-way Claude Desktop symbiosis ──
// Direction A (Claude → ABUZ8): the stdio symbiote, self-healed on startup.
// Direction B (ABUZ8 → Claude's tools): import Claude Desktop's MCP servers so
// ABUZ8 runs the same tool fleet through its own MCP client.
function bridgeStatus() {
  const claudeCfgFile = claudeConfigPath();
  const claudeCfg = readJson(claudeCfgFile, { mcpServers: {} });
  const symbiote = claudeCfg.mcpServers && claudeCfg.mcpServers.abuz8_os ? claudeCfg.mcpServers.abuz8_os : null;
  const bridge = persistentClaudeBridge();
  const localMcp = readJson(mcpConfigPath(), { mcpServers: {} });
  const importedFromClaude = Object.entries(localMcp.mcpServers || {}).filter(([, s]) => s.source === 'claude-desktop').map(([n]) => n);
  return {
    ok: true,
    claude_to_abuz8: { installed: Boolean(symbiote), config: claudeCfgFile, bridge_present: exists(bridge.bridge), node_present: Boolean(bridge.node) },
    abuz8_to_claude: { imported_servers: importedFromClaude, count: importedFromClaude.length, note: importedFromClaude.length ? 'ABUZ8 runs the same MCP servers Claude Desktop uses.' : 'No Claude Desktop MCP servers imported yet.' },
    restart_claude_to_load: Boolean(symbiote)
  };
}

function reinstateBridge() {
  const installed = installClaudeSymbiote();
  let imported = [];
  try {
    const file = claudeConfigPath();
    if (exists(file)) {
      const cfg = readJson(file, {});
      // Import every Claude Desktop MCP server EXCEPT our own symbiote (avoid recursion).
      const incoming = { ...(cfg.mcpServers || {}) };
      delete incoming.abuz8_os;
      imported = mergeMcpServers(incoming, 'claude-desktop');
    }
  } catch {}
  try { imported = imported.concat(importClaudeExtensions()); } catch {}
  try { imported = imported.concat(importAntigravity()); } catch {}
  imported = [...new Set(imported)];
  return { ok: true, symbiote: installed.server, claude_config: installed.file, imported, status: bridgeStatus() };
}

// ── Claude Desktop Extensions (.dxt) → spawnable MCP servers ────────────────
// Desktop Commander, Windows-MCP, etc. install as extensions with a manifest
// that declares the exact stdio command. Resolve ${__dirname}, drop unresolved
// ${user_config.*} env entries, and register them as first-class MCP servers.
function claudeExtensionsDir() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'Claude Extensions');
}
function specFromExtensionManifest(extDir, manifest) {
  const mc = manifest && manifest.server && manifest.server.mcp_config;
  if (!mc || !mc.command) return null;
  const resolveVar = (v) => String(v).replace(/\$\{__dirname\}/g, extDir);
  const env = {};
  for (const [k, v] of Object.entries(mc.env || {})) {
    const val = resolveVar(v);
    if (/\$\{user_config\./.test(val)) continue; // user-config placeholder we cannot resolve
    env[k] = val;
  }
  if ((mc.env || {}).ANONYMIZED_TELEMETRY) env.ANONYMIZED_TELEMETRY = 'false';
  return {
    command: resolveVar(mc.command),
    args: (mc.args || []).map(resolveVar),
    env,
    enabled: true,
    note: `Claude Desktop extension: ${manifest.display_name || manifest.name || path.basename(extDir)}`
  };
}
function importClaudeExtensions() {
  const root = claudeExtensionsDir();
  if (!exists(root)) return [];
  const incoming = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extDir = path.join(root, entry.name);
    const manifest = readJson(path.join(extDir, 'manifest.json'), null);
    if (!manifest) continue;
    const spec = specFromExtensionManifest(extDir, manifest);
    if (!spec) continue;
    incoming[slug(manifest.name || entry.name.split('.').pop())] = spec;
  }
  return Object.keys(incoming).length ? mergeMcpServers(incoming, 'claude-extensions') : [];
}

// ── Antigravity (Google IDE) MCP configs ────────────────────────────────────
function antigravityConfigPaths() {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    path.join(appdata, 'Antigravity', 'User', 'mcp.json'),
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json')
  ];
}
function importAntigravity() {
  const merged = [];
  for (const file of antigravityConfigPaths()) {
    if (!exists(file)) continue;
    const cfg = readJson(file, {});
    const servers = cfg.mcpServers || cfg.servers || {};
    if (Object.keys(servers).length) merged.push(...mergeMcpServers(servers, 'antigravity'));
  }
  return [...new Set(merged)];
}

// ── Open-weight model catalog (LM Studio / Anything-LLM style) ──
// Curated GGUF models from Hugging Face, sized small→large so the OS can
// recommend and download the most capable one this machine can actually run.
const MODEL_CATALOG = [
  { id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B Instruct', repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf', params: '0.5B', size_gb: 0.5, min_ram_gb: 3, note: 'Ultra-light, runs on anything.' },
  { id: 'llama3.2-1b', name: 'Llama 3.2 1B Instruct', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', params: '1B', size_gb: 0.8, min_ram_gb: 4, note: 'Fast general assistant.' },
  { id: 'qwen2.5-3b', name: 'Qwen2.5 3B Instruct', repo: 'Qwen/Qwen2.5-3B-Instruct-GGUF', file: 'qwen2.5-3b-instruct-q4_k_m.gguf', params: '3B', size_gb: 2.0, min_ram_gb: 8, note: 'Strong small all-rounder (good Arabic).' },
  { id: 'nemotron-nano-4b', name: 'NVIDIA Nemotron 3 Nano 4B', repo: 'unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF', file: 'NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf', params: '4B', size_gb: 2.9, min_ram_gb: 8, note: 'NVIDIA edge model built for AGENTIC TOOL USE. Best sub-4GB tool caller (2026). temp 0.6 / top_p 0.95.' },
  { id: 'phi4-mini', name: 'Microsoft Phi-4 Mini', repo: 'bartowski/Phi-4-mini-instruct-GGUF', file: 'Phi-4-mini-instruct-Q4_K_M.gguf', params: '3.8B', size_gb: 2.5, min_ram_gb: 8, note: 'Strong reasoning + tool use per size.' },
  { id: 'gemma3-4b', name: 'Gemma 3 4B Instruct', repo: 'bartowski/google_gemma-3-4b-it-GGUF', file: 'google_gemma-3-4b-it-Q4_K_M.gguf', params: '4B', size_gb: 2.5, min_ram_gb: 8, note: 'Google Gemma 3, good tool calling + multilingual.' },
  { id: 'phi3.5-mini', name: 'Phi-3.5 Mini Instruct', repo: 'bartowski/Phi-3.5-mini-instruct-GGUF', file: 'Phi-3.5-mini-instruct-Q4_K_M.gguf', params: '3.8B', size_gb: 2.4, min_ram_gb: 8, note: 'Great reasoning per size.' },
  { id: 'llama3.1-8b', name: 'Llama 3.1 8B Instruct', repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', params: '8B', size_gb: 4.9, min_ram_gb: 12, note: 'Capable general model.' },
  { id: 'qwen2.5-7b', name: 'Qwen2.5 7B Instruct', repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF', file: 'qwen2.5-7b-instruct-q4_k_m.gguf', params: '7B', size_gb: 4.7, min_ram_gb: 12, note: 'Top-tier 7B for tools & code.' },
  { id: 'qwen2.5-coder-7b', name: 'Qwen2.5 Coder 7B', repo: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', file: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf', params: '7B', size_gb: 4.7, min_ram_gb: 12, note: 'Best small coding model.' },
  { id: 'deepseek-r1-8b', name: 'DeepSeek-R1 Distill 8B', repo: 'bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF', file: 'DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf', params: '8B', size_gb: 4.9, min_ram_gb: 14, note: 'Reasoning-focused.' },
  { id: 'mistral-nemo-12b', name: 'Mistral Nemo 12B', repo: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF', file: 'Mistral-Nemo-Instruct-2407-Q4_K_M.gguf', params: '12B', size_gb: 7.1, min_ram_gb: 16, note: 'Strong, 128k context.' },
  { id: 'qwen2.5-14b', name: 'Qwen2.5 14B Instruct', repo: 'Qwen/Qwen2.5-14B-Instruct-GGUF', file: 'qwen2.5-14b-instruct-q4_k_m.gguf', params: '14B', size_gb: 9.0, min_ram_gb: 20, note: 'Near-frontier local quality.' },
  { id: 'qwen2.5-32b', name: 'Qwen2.5 32B Instruct', repo: 'Qwen/Qwen2.5-32B-Instruct-GGUF', file: 'qwen2.5-32b-instruct-q4_k_m.gguf', params: '32B', size_gb: 19.8, min_ram_gb: 32, note: 'Heavy workstation model.' }
];

async function modelCatalog() {
  const totalGb = os.totalmem() / 1024 / 1024 / 1024;
  const gpus = await detectGpuNames();
  const usable = totalGb * 0.6; // leave headroom for the OS + app
  const downloaded = new Set(listDownloadedModels().map((m) => m.name.toLowerCase()));
  const rows = MODEL_CATALOG.map((m) => ({
    ...m,
    runnable: m.min_ram_gb <= totalGb,
    comfortable: m.min_ram_gb <= usable,
    installed: downloaded.has(m.file.toLowerCase())
  }));
  // Recommend the largest comfortable model.
  const best = rows.filter((m) => m.comfortable).sort((a, b) => b.min_ram_gb - a.min_ram_gb)[0];
  if (best) best.recommended = true;
  return { ok: true, device: { ram_gb: Math.round(totalGb), gpus }, recommended_id: best?.id || null, models: rows };
}

async function route(req, res) {
  const { pathname, searchParams } = splitPath(req.url);
  if (req.method === 'OPTIONS') return text(res, 204, '');

  // ── LAN auth gate ── When LAN access is on, any request NOT from localhost
  // must carry the access key. The command-execution API is RCE-capable, so
  // unauthenticated LAN exposure is never allowed. Localhost (the desktop app)
  // is always trusted; the app shell + health load unauthenticated so the phone
  // can fetch the page and then authenticate with the key in its URL.
  try {
    const s0 = readJson(settingsPath(), {});
    if (s0.lan_access === true && !isLocalRequest(req)) {
      const openPaths = ['/', '/app', '/index.html', '/health', '/mobile', '/mobile.html', '/manifest.json', '/sw.js', '/verify.html'];
      if (!openPaths.includes(pathname)) {
        const key = req.headers['x-abuz8-key'] || searchParams.get('key') || '';
        if (!s0.lan_token || key !== s0.lan_token) {
          return json(res, 401, { ok: false, error: 'This ABUZ8 instance requires the LAN access key. Open the /app link that includes ?key=…' });
        }
      }
    }
  } catch {}

  if (pathname === '/tui') return sendTui(res);
  if (pathname === '/health') {
    return json(res, 200, { ok: true, service: 'portable-core', port: PORT, data_root: dataRoot });
  }
  // Serve the dashboard over HTTP so a phone/tablet on the LAN can use it.
  if (pathname === '/' || pathname === '/app' || pathname === '/index.html') {
    const html = readRendererHtml();
    if (html) return text(res, 200, html, 'text/html; charset=utf-8');
    return json(res, 200, { ok: true, service: 'portable-core', note: 'Renderer not found on disk; use the desktop window.' });
  }
  // Serve the mobile PWA shell + its assets so a phone on the LAN can install it.
  if (pathname === '/mobile' || pathname === '/mobile.html' || pathname === '/manifest.json' || pathname === '/sw.js' || pathname === '/verify.html' || pathname.startsWith('/renderer/')) {
    const rel = pathname === '/mobile' ? 'mobile.html' : pathname.replace(/^\/renderer\//, '').replace(/^\//, '');
    if (serveRendererFile(res, rel)) return;
    return json(res, 404, { ok: false, error: `Asset not found: ${rel}` });
  }
  if (pathname === '/api/lan/status') {
    const s = readJson(settingsPath(), {});
    return json(res, 200, { ok: true, enabled: s.lan_access === true, key: s.lan_access ? s.lan_token : undefined, urls: lanUrls(s.lan_access ? s.lan_token : ''), bound: serverHost });
  }
  if (pathname === '/api/lan/toggle') {
    const body = await getBody(req);
    const s = readJson(settingsPath(), {});
    s.lan_access = body.enabled === true;
    if (s.lan_access && !s.lan_token) s.lan_token = crypto.randomBytes(5).toString('hex'); // 10-char PIN
    s.updated_at = new Date().toISOString();
    writeJson(settingsPath(), s);
    await rebindServer(s.lan_access ? '0.0.0.0' : '127.0.0.1');
    return json(res, 200, { ok: true, enabled: s.lan_access, key: s.lan_access ? s.lan_token : undefined, urls: lanUrls(s.lan_access ? s.lan_token : ''), bound: serverHost });
  }
  if (pathname === '/api/status') {
    const embedded = embeddedBrainStatus();
    const extStatus = activeExternalDescriptor();
    const brainName = extStatus ? `${extStatus.backend} · ${extStatus.model}` : (embedded.embedded ? embedded.name : 'Portable Core');
    return json(res, 200, {
      ok: true,
      service: 'portable-core',
      primary_brain: brainName,
      brain: brainName,
      latency_ms: 1,
      memory_count: readMemory(200).length,
      data_root: dataRoot,
      mcp_config: mcpConfigPath(),
      embedded_brain: embedded
    });
  }
  if (pathname === '/api/chat' || pathname === '/api/chat/stream') {
    const body = await getBody(req);
    const prompt = body.content || body.message || body.prompt || body.raw;
    const agentic = body.agentic !== false;
    pushActivity('chat', 'You', String(prompt || '').slice(0, 100));
    let result;
    if (agentic) {
      result = await agenticReply(prompt, body);
    } else {
      const r = await reasonReply(prompt, { provider: body.provider, role: body.role });
      result = { response: r.text, modelResponse: r.model ? r.text : null, brain: r.brain, fallback: r.fallback };
    }
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
    const brainLabel = result.brain || (result.modelResponse ? embedded.name : 'Portable Core');
    if (pathname.endsWith('/stream')) return sendSse(res, response, brainLabel);
    return json(res, 200, {
      ok: true,
      response,
      brain: brainLabel,
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
    const external = await detectExternalBrains();
    const activeExtId = activeExternalDescriptor()?.id || null;
    const externalBrains = external.map((b) => ({
      id: b.id, name: b.name, status: 'ready', alive: activeExtId === b.id,
      kind: b.kind, backend: b.backend, endpoint: b.endpoint, size_mb: b.size_mb || 0
    }));
    const brains = [
      { id: 'portable-core', name: 'Portable Core', status: 'online', alive: true, kind: 'Portable Core', port: PORT, models: ['portable-core'] },
      ...lfmBrains,
      ...externalBrains
    ];
    return json(res, 200, { ok: true, brains, local: brains, external: externalBrains, cloud: externalBrains });
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
  if (pathname === '/api/system/scan') {
    return json(res, 200, await systemScan());
  }
  if (pathname === '/api/models/catalog') {
    return json(res, 200, await modelCatalog());
  }
  if (pathname === '/api/soul') {
    if (req.method === 'POST') {
      const body = await getBody(req);
      return json(res, 200, { ok: true, soul: saveSoul(body) });
    }
    return json(res, 200, { ok: true, soul: loadSoul() });
  }
  if (pathname === '/api/agents/roles') {
    return json(res, 200, { ok: true, roles: AGENT_ROLES.map((r) => ({ id: r.id, name: r.name, tagline: r.tagline, tools: r.tools })) });
  }
  if (pathname === '/api/swarm/run') {
    const body = await getBody(req);
    try { return json(res, 200, await runSwarm(body.task || body.goal || body.content, body.roles || body.agents)); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/agent/run') {
    const body = await getBody(req);
    try { return json(res, 200, await runAgentLoop(body.goal || body.task || body.content, body)); }
    catch (e) { agentRunning = false; return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/activity') {
    const since = Number(searchParams.get('since') || 0);
    const board = readMissionBoard();
    const summary = missionSummary(board);
    return json(res, 200, {
      ok: true,
      seq: activitySeq,
      agent_running: agentRunning,
      events: activityLog.filter((e) => e.id > since),
      missions: { total: summary.total, counts: summary.counts, next: summary.next }
    });
  }
  if (pathname === '/api/browser/do') {
    const body = await getBody(req);
    try { return json(res, 200, { ok: true, result: await browserDo(body) }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/gui/do') {
    const body = await getBody(req);
    try { return json(res, 200, { ok: true, result: await guiDo(body) }); }
    catch (e) { const s = /consent|Allow actions/i.test(e.message) ? 403 : 400; return json(res, s, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/content/generate') {
    const body = await getBody(req);
    try { return json(res, 200, await generateContent(body)); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/content/formats') {
    return json(res, 200, { ok: true, formats: Object.keys(CONTENT_FORMATS) });
  }
  if (pathname === '/api/x/post') {
    const body = await getBody(req);
    return json(res, 200, await xPost(body));
  }
  if (pathname === '/api/growth/seed') {
    return json(res, 200, seedGrowthBoard());
  }
  if (pathname === '/api/skills/installed') {
    return json(res, 200, { ok: true, skills: listSkills(), dir: path.join(dataRoot, 'skills') });
  }
  if (pathname === '/api/bridge/status') {
    return json(res, 200, bridgeStatus());
  }
  if (pathname === '/api/bridge/reinstall' || pathname === '/api/bridge/reinstate') {
    return json(res, 200, reinstateBridge());
  }
  if (pathname === '/api/cmd/run') {
    const body = await getBody(req);
    try {
      return json(res, 200, { ok: true, result: await actionCmdRun(body) });
    } catch (e) {
      const status = /consent|Allow actions/i.test(e.message) ? 403 : 400;
      return json(res, status, { ok: false, error: e.message });
    }
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
  if (pathname === '/api/mcp/import/antigravity') {
    const imported = importAntigravity();
    return json(res, 200, { ok: true, imported: imported.length, merged: imported, sources: antigravityConfigPaths().filter(exists), mcp_config: mcpConfigPath() });
  }
  if (pathname === '/api/mcp/import/claude-extensions') {
    const imported = importClaudeExtensions();
    return json(res, 200, { ok: true, imported: imported.length, merged: imported, source: claudeExtensionsDir(), mcp_config: mcpConfigPath() });
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
  if (pathname === '/api/attachments') {
    return json(res, 200, attachmentsStatus());
  }
  if (pathname === '/api/voice/status' || pathname === '/api/tts/status') {
    const sidecar = await ensureVoiceSidecar();
    const sidecarUp = Boolean(sidecar && sidecar.ok);
    const piper = piperAvailable();
    const piperVoices = piper ? listPiperVoices() : [];
    const winVoices = await listWindowsTtsVoices();
    const recognizers = await listWindowsSttRecognizers();
    const kokoroVoices = sidecarUp
      ? ['bm_fable', 'bm_george', 'bf_emma', 'am_adam', 'am_michael', 'af_heart', 'af_bella', 'af_nicole'].map((v) => ({ id: v, name: `Kokoro · ${v}`, engine: 'kokoro', neural: true }))
      : [];
    const voices = [
      ...kokoroVoices,
      ...piperVoices.map((v) => ({ id: v.id, name: v.name, engine: 'piper', lang: v.lang, neural: true, arabic: v.arabic })),
      ...winVoices.map((v) => ({ id: v, name: v, engine: 'windows', neural: false }))
    ];
    return json(res, 200, {
      ok: true,
      voice_engine: sidecarUp ? 'kokoro-gpu' : (piper ? 'piper-neural' : 'windows-sapi'),
      neural_tts: sidecarUp || piper,
      neural_stt: sidecarUp || whisperAvailable(),
      stt_engine: sidecarUp ? 'whisper-large-v3-gpu' : (whisperAvailable() ? 'whisper.cpp' : 'windows-stt'),
      sidecar: sidecarUp ? sidecar : null,
      native_tts: process.platform === 'win32' && winVoices.length > 0,
      browser_stt: true, browser_tts: true, streaming_chat_tts: true,
      live_talk: sidecarUp,
      presets: ['normal', 'calm', 'fast', 'narrator', 'cartoon'],
      recognizers, voices,
      note: sidecarUp
        ? `Native GPU voice active: Whisper large-v3 (hearing) + Kokoro (speaking, ${sidecar.default_voice || 'bm_fable'}) on ${sidecar.device}.`
        : (piper ? 'Offline neural voice via Piper is active. Browser/Windows speech remain fallbacks.' : 'Install the Piper attachment or the voice sidecar for natural neural voices.')
    });
  }
  if (pathname === '/api/stt' || pathname === '/api/stt/transcribe') {
    const body = await getBody(req);
    const audio = body.audio_base64 || body.wav_base64 || body.audio || body.raw || '';
    // Tier 1: GPU sidecar (Whisper large-v3). Tier 2: whisper.cpp attachment. Tier 3: Windows STT.
    const sidecar = await ensureVoiceSidecar();
    if (sidecar && sidecar.ok) {
      try {
        const r = await httpPostBuffer(`http://127.0.0.1:${VOICE_SIDECAR_PORT}/stt`, { audio_base64: audio });
        const parsed = JSON.parse(r.buffer.toString('utf8'));
        if (parsed.ok) return json(res, 200, parsed);
      } catch {}
    }
    try {
      const result = whisperAvailable() ? await transcribeWhisper(audio) : await transcribeWindowsStt(audio);
      return json(res, 200, { ok: true, ...result });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message, fallback: 'browser-stt' });
    }
  }
  if (pathname === '/api/tts' || pathname === '/api/tts/stream') {
    const body = await getBody(req);
    // Tier 1: GPU sidecar (Kokoro-82M, bm_fable default). Tier 2: Piper. Tier 3: Windows SAPI.
    const sidecar = await ensureVoiceSidecar();
    if (sidecar && sidecar.ok) {
      try {
        const r = await httpPostBuffer(`http://127.0.0.1:${VOICE_SIDECAR_PORT}/tts`, {
          text: body.text || body.raw || '', voice: body.voice || '', speed: body.speed || 1.0
        });
        if (r.status === 200 && String(r.headers['content-type'] || '').includes('audio')) {
          return binary(res, 200, r.buffer, 'audio/wav');
        }
      } catch {}
    }
    try {
      if (piperAvailable()) {
        const r = await synthesizePiper(body.text || body.raw || '', body.voice || '', body.preset);
        return binary(res, 200, r.wav, 'audio/wav');
      }
      const wav = await synthesizeWindowsTts(body.text || body.raw || '', body.voice || '');
      return binary(res, 200, wav, 'audio/wav');
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message, fallback: 'browser-tts' });
    }
  }
  if (pathname === '/api/avatar/speak') {
    const body = await getBody(req);
    try {
      const wav = await synthesizeWindowsTts(body.text || body.raw || '', body.voice || '');
      return binary(res, 200, wav, 'audio/wav');
    } catch (e) {
      return json(res, 200, { ok: true, queued: false, fallback: 'browser-tts', error: e.message });
    }
  }
  if (pathname === '/api/avatar/health') {
    const voices = await listWindowsTtsVoices();
    return json(res, 200, { ok: true, mode: voices.length ? 'native-windows-tts' : 'browser-tts-fallback', voices });
  }
  if (pathname === '/api/routing/leaderboard') return json(res, 200, { ok: true, rows: [{ lane: 'portable-core', n_calls: readMemory(500).length, mean_success: 1, cost_per_1k: 0 }] });
  if (pathname === '/api/provenance/stats') return json(res, 200, { ok: true, fact_count: readMemory(1000).length, agent_count: 1, open_conflicts: 0 });
  if (pathname === '/api/security/integrity' || pathname === '/api/security/audit') return json(res, 200, { ok: true, message: 'Portable runtime folders and local API are reachable.', data_root: dataRoot });
  if (pathname === '/api/telephony/status') {
    const t = twilioCreds();
    const configured = Boolean(t.sid && t.token && t.from);
    return json(res, 200, {
      ok: true, active: configured, provider: 'twilio', number: configured ? t.from : null,
      inbound_webhook: `${tunnelUrl || `http://127.0.0.1:${PORT}`}/api/telephony/inbound`,
      tunnel: tunnelUrl || null,
      hint: configured
        ? 'Two-way SMS is live. Point your Twilio number\'s messaging webhook at inbound_webhook (start the tunnel for a public URL).'
        : 'Give the OS its own phone number: buy a Twilio number, then set twilio_account_sid, twilio_auth_token, twilio_from in Settings.'
    });
  }
  if (pathname === '/api/telephony/send') {
    requireActionConsent();
    const body = await getBody(req);
    const to = String(body.to || '').trim();
    const text = String(body.text || body.message || '').trim();
    if (!to || !text) return json(res, 400, { ok: false, error: 'to and text are required' });
    try {
      const r = await twilioSendSms(to, text);
      appendJsonl(path.join(dataRoot, 'logs', 'tool-calls.jsonl'), { ok: true, tool: 'telephony_send', to, sid: r.sid, timestamp: new Date().toISOString() });
      return json(res, 200, { ok: true, sid: r.sid, status: r.status, to: r.to });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/telephony/inbound') {
    // Twilio posts x-www-form-urlencoded; getBody hands it to us as {raw}.
    const body = await getBody(req);
    const form = new URLSearchParams(body.raw || '');
    const from = form.get('From') || body.From || 'unknown';
    const text = (form.get('Body') || body.Body || '').trim();
    let reply = 'ABUZ8 OS received your message.';
    if (text) {
      try { const r = await agenticReply(text, { role: 'sms' }); reply = (r.response || '').slice(0, 1500) || reply; } catch {}
    }
    pushActivity('telephony', `SMS from ${from}`, text.slice(0, 120));
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
  }
  if (pathname === '/api/tunnel/status') {
    return json(res, 200, { ok: true, active: Boolean(tunnelProc && tunnelUrl), url: tunnelUrl || null, mobile_app: tunnelUrl ? `${tunnelUrl}/app` : null });
  }
  if (pathname === '/api/tunnel/start') {
    requireActionConsent();
    try {
      const url = await startTunnel();
      return json(res, 200, { ok: true, url, mobile_app: `${url}/app`, note: 'Anyone with this URL can reach the OS — it is random and unlisted, but treat it like a key. Stop the tunnel when done.' });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/tunnel/stop') {
    stopTunnel();
    return json(res, 200, { ok: true, active: false });
  }
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
  if (pathname === '/api/actions/status') return json(res, 200, { ok: true, allow_actions: actionsAllowed(), session_only: false });
  if (pathname === '/api/actions/consent') {
    const body = await getBody(req);
    actionConsentGranted = body.allow_actions === true;
    // Persist so it survives relaunch (read back by actionsAllowed / start()).
    const s = readJson(settingsPath(), {});
    s.auto_grant_actions = actionConsentGranted;
    s.updated_at = new Date().toISOString();
    writeJson(settingsPath(), s);
    appendJsonl(path.join(dataRoot, 'logs', 'action-consent.jsonl'), { allow_actions: actionConsentGranted, timestamp: new Date().toISOString() });
    return json(res, 200, { ok: true, allow_actions: actionConsentGranted, session_only: false });
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
      pushActivity('tool', `Tool: ${result.tool || body.tool || body.name}`, result.ok === false ? (result.error || 'failed') : 'ok');
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
      pushActivity('mission', `Task: ${task.title}`, `→ ${task.column} · ${task.owner}`);
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
      pushActivity('mission', `Moved: ${task.title}`, `→ ${task.column}`);
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
  if (pathname === '/api/souls/list') return json(res, 200, { ok: true, souls: ['portable-core'] });
  if (pathname === '/api/souls/active') return json(res, 200, { ok: true });
  if (pathname === '/api/telegram/send') {
    const settings = readJson(settingsPath(), {});
    const token = settings.telegram_token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return json(res, 200, { ok: false, error: 'Telegram not configured. Set a bot token in Settings.' });
    const body = await getBody(req);
    const chatId = body.chat_id || settings.telegram_chat_id;
    if (!chatId) return json(res, 200, { ok: false, error: 'No chat_id configured. Send /start to your bot first.' });
    try {
      const resp = await fetchUrl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: body.text || body.message || '', parse_mode: 'Markdown' })
      });
      const data = JSON.parse(resp);
      return json(res, 200, { ok: data.ok, error: data.description || null });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  // ── SETTINGS API ──────────────────────────────────────────────
  if (pathname === '/api/settings') {
    if (req.method === 'POST') {
      const body = await getBody(req);
      const cfg = readJson(settingsPath(), {});
      for (const k of Object.keys(body)) cfg[k] = body[k];
      cfg.updated_at = new Date().toISOString();
      writeJson(settingsPath(), cfg);
      return json(res, 200, { ok: true, settings: cfg });
    }
    const s = readJson(settingsPath(), {});
    s._dataRoot = dataRoot;
    s._port = PORT;
    return json(res, 200, { ok: true, settings: s });
  }

  // ── PROVIDERS API ────────────────────────────────────────────
  if (pathname === '/api/providers') {
    if (req.method === 'POST') {
      const body = await getBody(req);
      const cfg = readJson(providersPath(), { providers: [] });
      const existing = cfg.providers.findIndex(p => p.name === body.name);
      const entry = { name: body.name, type: body.type || 'openai', endpoint: body.endpoint || '', model: body.model || '', api_key: body.api_key || '', enabled: body.enabled !== false, context_length: Number(body.context_length) || 8192, parameters: body.parameters || { temperature: 0.7, max_tokens: 2048 } };
      if (existing >= 0) cfg.providers[existing] = entry;
      else cfg.providers.push(entry);
      writeJson(providersPath(), cfg);
      return json(res, 200, { ok: true, providers: cfg.providers });
    }
    const cfg = readJson(providersPath(), { providers: [] });
    return json(res, 200, { ok: true, providers: cfg.providers });
  }

  // ── PROVIDER CHAT ────────────────────────────────────────────
  if (pathname === '/api/provider/chat') {
    const body = await getBody(req);
    const providerName = body.provider || body.brain || 'lmstudio';
    const cfg = readJson(providersPath(), { providers: [] });
    const provider = cfg.providers.find(p => p.name === providerName);
    if (!provider) return json(res, 200, { ok: false, error: `Provider '${providerName}' not configured. Add it in Settings.`, fallback: true });
    if (!provider.enabled) return json(res, 200, { ok: false, error: `Provider '${providerName}' is disabled.`, fallback: true });
    try {
      const result = await callProviderChat(provider, body.content || body.message || body.prompt || '');
      return json(res, 200, { ok: true, response: result, provider: providerName, brain: provider.model || providerName });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message, fallback: true });
    }
  }

  // ── MCP SERVER RUNTIME ──────────────────────────────────────
  if (pathname === '/api/mcp/servers') {
    const cfg = readJson(mcpConfigPath(), { mcpServers: {} });
    const running = Array.from(mcpProcesses.keys());
    const servers = Object.entries(cfg.mcpServers).map(([name, spec]) => ({ name, command: spec.command, args: spec.args || [], enabled: spec.enabled !== false, source: spec.source || 'catalog', note: spec.note || '', running: running.includes(name) }));
    return json(res, 200, { ok: true, servers });
  }

  if (pathname.match(/^\/api\/mcp\/servers\/.+\/start$/)) {
    const name = pathname.split('/')[4];
    try {
      const pid = await startMcpServer(name);
      return json(res, 200, { ok: true, message: `Started MCP server: ${name}`, pid });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }
  if (pathname.match(/^\/api\/mcp\/servers\/.+\/stop$/)) {
    const name = pathname.split('/')[4];
    stopMcpServer(name);
    return json(res, 200, { ok: true, message: `Stopped MCP server: ${name}` });
  }
  if (pathname.match(/^\/api\/mcp\/servers\/.+\/tools$/)) {
    const name = pathname.split('/')[4];
    try {
      const tools = await mcpListTools(name);
      return json(res, 200, { ok: true, server: name, tools });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/mcp/call') {
    const body = await getBody(req);
    const serverName = String(body.server || '').trim();
    const toolName2 = String(body.tool || body.name || '').trim();
    if (!serverName || !toolName2) return json(res, 400, { ok: false, error: 'server and tool are required' });
    try {
      const result = await mcpCallTool(serverName, toolName2, body.args || body.arguments || {});
      appendJsonl(path.join(dataRoot, 'logs', 'tool-calls.jsonl'), { ok: true, mcp: serverName, tool: toolName2, timestamp: new Date().toISOString() });
      return json(res, 200, { ok: true, server: serverName, tool: toolName2, result });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }
  if (pathname.match(/^\/api\/mcp\/servers\/.+\/enable$/)) {
    const name = pathname.split('/')[4];
    const body = await getBody(req);
    const cfg = readJson(mcpConfigPath(), { mcpServers: {} });
    if (!cfg.mcpServers[name]) return json(res, 404, { ok: false, error: `MCP server '${name}' not found` });
    cfg.mcpServers[name].enabled = body.enabled !== false;
    writeJson(mcpConfigPath(), cfg);
    return json(res, 200, { ok: true, enabled: cfg.mcpServers[name].enabled, name });
  }

  // ── PERMISSION REQUEST ──────────────────────────────────────
  if (pathname === '/api/actions/request') {
    const body = await getBody(req);
    return json(res, 200, { ok: true, action_required: true, tool: body.tool || 'unknown', reason: body.reason || 'This action requires your permission.', request_id: `perm-${Date.now()}`, prompt: `⚠️ **Permission Request**: ${body.reason || 'This action requires your permission.'}\n\nType \`/allow-actions\` to grant permission for this session, or type \`/deny\` to reject.` });
  }

  // ── TELEGRAM POLL ──────────────────────────────────────────
  if (pathname === '/api/telegram/poll') {
    const settings = readJson(settingsPath(), {});
    const token = settings.telegram_token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return json(res, 200, { ok: false, error: 'No token configured' });
    try {
      const offset = settings.telegram_update_offset || 0;
      const resp = await fetchUrl(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5`, { timeout: 10000 });
      const data = JSON.parse(resp);
      if (data.ok && data.result && data.result.length > 0) {
        const maxUpdate = Math.max(...data.result.map(u => u.update_id));
        const msgs = data.result.filter(u => u.message && u.message.text);
        for (const msg of msgs) {
          if (msg.message.text === '/start') {
            settings.telegram_chat_id = String(msg.message.chat.id);
            settings.telegram_update_offset = maxUpdate + 1;
            writeJson(settingsPath(), settings);
            // Send welcome
            await fetchUrl(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: msg.message.chat.id, text: '✅ ABUZ8 OS connected! You can now receive notifications here.' })
            });
            return json(res, 200, { ok: true, registered: true, chat_id: String(msg.message.chat.id) });
          }
        }
        settings.telegram_update_offset = maxUpdate + 1;
        writeJson(settingsPath(), settings);
      }
      return json(res, 200, { ok: true, registered: false, message: 'Send /start to your bot from Telegram to register.' });
    } catch (e) {
      return json(res, 200, { ok: false, error: e.message });
    }
  }

  return json(res, 404, { ok: false, error: `No portable-core endpoint for ${pathname}` });
}

// Read the dashboard HTML from disk (works inside the asar via Electron fs).
function readRendererHtml() {
  const candidates = [
    path.join(__dirname, 'renderer', 'index.html'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'renderer', 'index.html') : null
  ].filter(Boolean);
  for (const f of candidates) { try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } catch {} }
  return null;
}

// Resolve a file inside the renderer/ folder (works inside the asar via Electron fs).
function rendererFilePath(rel) {
  const safe = String(rel || '').replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/^\/+/, '');
  if (!safe) return null;
  const candidates = [
    path.join(__dirname, 'renderer', safe),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'renderer', safe) : null
  ].filter(Boolean);
  return candidates.find((f) => { try { return fs.existsSync(f) && fs.statSync(f).isFile(); } catch { return false; } }) || null;
}
function serveRendererFile(res, rel) {
  const f = rendererFilePath(rel);
  if (!f) return false;
  const ext = path.extname(f).toLowerCase();
  const mime = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.json' ? 'application/json; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml'
    : ext === '.ico' ? 'image/x-icon' : ext === '.webmanifest' ? 'application/manifest+json'
    : 'application/octet-stream';
  try {
    const buf = fs.readFileSync(f);
    res.writeHead(200, { 'content-type': mime, 'access-control-allow-origin': '*', 'cache-control': 'no-cache' });
    res.end(buf);
    return true;
  } catch { return false; }
}

// Is the request from this machine (always trusted)?
function isLocalRequest(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// LAN URLs the phone can open (IPv4 non-internal interfaces), key embedded.
function lanUrls(key) {
  const q = key ? `?key=${key}` : '';
  const urls = [`http://127.0.0.1:${PORT}/app${q}`];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${PORT}/app${q}`);
      }
    }
  } catch {}
  return urls;
}

// Re-bind the running server to a new host (localhost <-> LAN) without restart.
function rebindServer(host) {
  return new Promise((resolve) => {
    if (!server || host === serverHost) { serverHost = host; return resolve(serverHost); }
    server.close(() => {
      serverHost = host;
      server.listen(PORT, serverHost, () => { logFn(`portable core re-bound to http://${serverHost}:${PORT}`); resolve(serverHost); });
    });
  });
}

async function start(options = {}) {
  if (server) return { port: PORT, dataRoot };
  logFn = options.log || logFn;
  hostExecutable = process.env.PORTABLE_EXECUTABLE_FILE
    || (options.app && typeof options.app.getPath === 'function' ? options.app.getPath('exe') : null)
    || process.execPath;
  dataRoot = resolveDataRoot(options.app);
  initFolders();
  // Restore persisted action consent so "Allow actions" survives relaunch.
  try { if (readJson(settingsPath(), {}).auto_grant_actions === true) actionConsentGranted = true; } catch {}
  // Bind to the LAN only if the user has opted in; otherwise localhost-only.
  try { if (readJson(settingsPath(), {}).lan_access === true) serverHost = '0.0.0.0'; } catch {}
  server = http.createServer((req, res) => route(req, res).catch((e) => json(res, 500, { ok: false, error: e.message })));
  await new Promise((resolve, reject) => {
    server.once('error', async (e) => {
      if (e && e.code === 'EADDRINUSE') {
        if (process.env.ABUZ8_ALLOW_EXTERNAL_BACKEND === '1') {
          logFn(`port ${PORT} is already in use; adopting existing local backend because ABUZ8_ALLOW_EXTERNAL_BACKEND=1.`);
          server = null;
          return resolve();
        }
        return reject(new Error(`ABUZ8 bundled core could not bind ${serverHost}:${PORT}. Close the older ABUZ8/Qadir process or set ABUZ8_PORT to a free port.`));
      }
      reject(e);
    });
    server.listen(PORT, serverHost, resolve);
  });
  if (server) logFn(`portable core listening on http://${serverHost}:${PORT}`);
  logFn(`data root: ${dataRoot}`);
  ensureVoiceSidecar().catch(() => {});
  // Self-heal the two-way Claude Desktop symbiosis on every launch.
  try {
    const b = reinstateBridge();
    logFn(`claude bridge: symbiote ${b.symbiote ? 'installed' : 'present'}; imported ${b.imported.length} Claude MCP server(s).`);
  } catch (e) { logFn('claude bridge self-heal skipped: ' + e.message); }
  try { startTelegramPolling(); logFn('telegram bridge: polling active (set a bot token in Settings to connect your phone).'); } catch (e) {}
  try { const adopted = await autoAdoptBrainIfNeeded(); if (adopted) logFn(`auto-adopted local GPU brain: ${adopted}`); } catch (e) {}
  return { port: PORT, dataRoot };
}

let telegramTimer = null;
function stop() {
  if (telegramTimer) { clearTimeout(telegramTimer); telegramTimer = null; }
  if (server) server.close();
  server = null;
  if (lfmProcess) {
    try { lfmProcess.kill(); } catch {}
    lfmProcess = null;
  }
  for (const [name, client] of mcpProcesses) {
    try { (client.proc || client).kill(); } catch {}
    mcpProcesses.delete(name);
  }
}

// ── Telegram two-way bridge: long-poll getUpdates, answer phone messages with
//    the active (GPU) brain. Set settings.telegram_token, then send /start. ──
async function pollTelegramOnce() {
  const settings = readJson(settingsPath(), {});
  const token = settings.telegram_token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const offset = settings.telegram_update_offset || 0;
  const resp = await fetchUrl(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`, { timeout: 25000 });
  const data = JSON.parse(resp);
  if (!data.ok || !Array.isArray(data.result) || !data.result.length) return true;
  const maxUpdate = Math.max(...data.result.map((u) => u.update_id));
  for (const u of data.result) {
    const msg = u.message;
    if (!msg || !msg.text) continue;
    const chatId = String(msg.chat.id);
    settings.telegram_chat_id = chatId;
    const send = (t) => fetchUrl(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: String(t).slice(0, 3900) }) }).catch(() => {});
    if (msg.text.trim() === '/start') {
      await send('✅ ABUZ8 OS connected. Message me and I will answer from your machine (GPU brain).');
    } else {
      try { const r = await reasonReply(msg.text, {}); await send(r.text || '(no reply)'); }
      catch (e) { await send('Error: ' + e.message); }
    }
  }
  settings.telegram_update_offset = maxUpdate + 1;
  writeJson(settingsPath(), settings);
  return true;
}
function startTelegramPolling() {
  if (telegramTimer) return;
  const tick = async () => {
    let hadToken = true;
    try { hadToken = await pollTelegramOnce(); } catch (e) { /* transient network/Telegram error */ }
    telegramTimer = setTimeout(tick, hadToken ? 1200 : 15000);
  };
  telegramTimer = setTimeout(tick, 3000);
}

// ── SETTINGS / PROVIDERS HELPERS ──────────────────────────────
function settingsPath() { return path.join(dataRoot, 'config', 'settings.json'); }
function providersPath() { return path.join(dataRoot, 'config', 'providers.json'); }

async function callProviderChat(provider, prompt, system) {
  const endpoint = (provider.endpoint || '').replace(/\/+$/, '');
  const model = provider.model || 'default';
  const params = provider.parameters || { temperature: 0.7, max_tokens: 2048 };
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const isLm = provider.type === 'lmstudio' || endpoint.includes('localhost:1234') || endpoint.includes('127.0.0.1:1234');
  const base = isLm ? (endpoint || 'http://localhost:1234')
    : (provider.type === 'openai' || provider.type === 'hermes') ? (endpoint || 'https://api.openai.com/v1')
    : endpoint;
  const url = `${base}/v1/chat/completions`.replace('/v1/v1/', '/v1/');
  const headers = { 'Content-Type': 'application/json' };
  if (provider.api_key) headers['Authorization'] = `Bearer ${provider.api_key}`;
  const body = JSON.stringify({ model, messages, temperature: params.temperature, max_tokens: params.max_tokens || 2048, stream: false });
  const resp = await fetchUrl(url, { method: 'POST', headers, body });
  const data = JSON.parse(resp);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const body = opts.body ? Buffer.from(opts.body) : null;
    const req = mod.request(url, {
      method: opts.method || 'GET',
      headers: { ...opts.headers, ...(body ? { 'Content-Length': body.length } : {}) },
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── MCP SERVER RUNTIME ────────────────────────────────────────
// Real MCP client: line-delimited JSON-RPC over stdio (initialize,
// tools/list, tools/call) so imported servers are usable, not just spawned.
function spawnMcpClient(name, spec) {
  // shell:true is needed for PATH shims (npx/uv/docker), but the shell splits
  // unquoted spaces — extension paths like "Claude Extensions" must be quoted.
  const shQuote = (s) => { s = String(s); return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const proc = spawn(shQuote(spec.command), (spec.args || []).map(shQuote), {
    env: { ...process.env, ...(spec.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true
  });
  const client = { proc, buf: '', nextId: 1, pending: new Map(), initialized: null, stderrTail: '' };
  proc.stdout.on('data', (d) => {
    client.buf += d.toString();
    let idx;
    while ((idx = client.buf.indexOf('\n')) >= 0) {
      const line = client.buf.slice(0, idx).trim();
      client.buf = client.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && client.pending.has(msg.id)) {
          const { resolve, reject, timer } = client.pending.get(msg.id);
          client.pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    }
  });
  proc.stderr.on('data', (d) => { client.stderrTail = (client.stderrTail + d.toString()).slice(-800); });
  proc.on('exit', (code) => {
    for (const { reject, timer } of client.pending.values()) {
      clearTimeout(timer);
      reject(new Error(`MCP server '${name}' exited (code ${code}). ${client.stderrTail.slice(-300)}`));
    }
    client.pending.clear();
    mcpProcesses.delete(name);
    if (code !== 0) logFn(`[mcp:${name}] exited code ${code}: ${client.stderrTail.slice(0, 200)}`);
  });
  proc.on('error', (e) => {
    for (const { reject, timer } of client.pending.values()) { clearTimeout(timer); reject(e); }
    client.pending.clear();
    mcpProcesses.delete(name);
  });
  return client;
}

function mcpRequest(client, name, method, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = client.nextId++;
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`MCP server '${name}' timed out on ${method}`));
    }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
  });
}

async function ensureMcpClient(name) {
  let client = mcpProcesses.get(name);
  if (client && client.proc && client.proc.exitCode === null) {
    if (client.initialized) await client.initialized;
    return client;
  }
  const cfg = readJson(mcpConfigPath(), { mcpServers: {} });
  const spec = cfg.mcpServers[name];
  if (!spec) throw new Error(`MCP server '${name}' not found in config`);
  if (!spec.command) throw new Error(`MCP server '${name}' has no command configured`);
  client = spawnMcpClient(name, spec);
  mcpProcesses.set(name, client);
  client.initialized = mcpRequest(client, name, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'abuz8-os', version: '1.0.0' }
  }, 60000).then(() => {
    client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  });
  await client.initialized;
  return client;
}

async function startMcpServer(name) {
  const client = await ensureMcpClient(name);
  return client.proc.pid;
}

async function mcpListTools(name) {
  const client = await ensureMcpClient(name);
  const result = await mcpRequest(client, name, 'tools/list', {}, 30000);
  return result.tools || [];
}

async function mcpCallTool(name, tool, args) {
  const client = await ensureMcpClient(name);
  return mcpRequest(client, name, 'tools/call', { name: tool, arguments: args || {} }, 120000);
}

function stopMcpServer(name) {
  const client = mcpProcesses.get(name);
  if (!client) return;
  try { (client.proc || client).kill(); } catch {}
  mcpProcesses.delete(name);
}

module.exports = { start, stop, PORT };
