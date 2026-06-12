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
const VOICE_PORT = Number(process.env.ABUZ8_VOICE_PORT || 8903);

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
// Dedicated tiny "voice brain" (e.g. Qwen2.5 0.5B) for instant spoken replies,
// running alongside the main reasoning brain on its own port.
let voiceProcess = null;
let voiceStarting = false;
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

// ── The Lineage: a family of specialist agent CLASSES on one shared chassis ──
// Like Mercedes shares a platform but the S, G, CL each specialize, every class
// rides the ABUZ8 Portable Core (same API, tools, voice, memory, soul system)
// but loads its own identity, toolset, brain bias, and connectors. Selecting a
// class re-skins the same engine into a different specialist.
const AGENT_CLASSES = [
  {
    id: 'abuz8-s', class: 'S', name: 'ABUZ8 — Flagship Operator', specialty: 'general sovereign operator',
    tagline: 'The flagship. Runs the whole company, commands every tool.',
    brain: 'reasoning', tools: ['*'], connectors: ['claude-desktop', 'mcp'],
    soul: { name: 'ABUZ8', voice: 'Warm, confident, decisive — a JARVIS-class right hand. Acts, never grovels.', mission: 'Run the one-person company end to end and generate revenue.' }
  },
  {
    id: 'intel-e', class: 'E', name: 'Raqib — Intel & OSINT Analyst', specialty: 'research, OSINT, investigation',
    tagline: 'Executive intelligence. Reads the web deeply, builds dossiers, finds the signal.',
    brain: 'reasoning', tools: ['deep_research', 'web_search', 'browser_do', 'abuz8_memory_write', 'cmd_run'], connectors: ['osint'],
    soul: { name: 'Raqib', voice: 'Calm, precise, analytical — an intelligence officer. Cites sources, separates fact from rumor.', mission: 'Gather, verify, and synthesize intelligence into clear dossiers and decisions.' }
  },
  {
    id: 'studio-cl', class: 'CL', name: 'Mubdi — Creator Studio', specialty: 'content, video, avatar media',
    tagline: 'The luxury coupe. Carousels, threads, scripts, video & avatar pipelines.',
    brain: 'reasoning', tools: ['content_generate', 'x_post', 'web_search', 'file_write', 'browser_do'], connectors: ['kling', 'heygen', 'x', 'youtube'],
    soul: { name: 'Mubdi', voice: 'Bold creative director — punchy hooks, strong taste, ships fast.', mission: 'Turn ideas into scroll-stopping content and revenue assets across every channel.' }
  },
  {
    id: 'sentinel-g', class: 'G', name: 'Haris — Sentinel', specialty: 'security, red-team, system ops',
    tagline: 'The rugged off-roader. CLI, recon, hardening — careful and guarded.',
    brain: 'reasoning', tools: ['cmd_run', 'shell_run', 'cli_probe', 'web_search', 'abuz8_device_probe'], connectors: ['kali', 'nmap'],
    soul: { name: 'Haris', voice: 'Terse, disciplined, security-minded. Explains a command before running it; defaults to read-only.', mission: 'Inspect, harden, and operate systems safely. Never run a destructive action without explicit approval.' }
  },
  {
    id: 'ops-gl', class: 'GL', name: 'Mudir — Ops & Growth', specialty: 'CEO/ops, SEO, mass marketing',
    tagline: 'The SUV that hauls the business. Kanban, growth protocol, revenue.',
    brain: 'reasoning', tools: ['abuz8_mission_board', 'abuz8_mission_task_create', 'content_generate', 'x_post', 'swarm_run', 'web_search'], connectors: ['x', 'stripe'],
    soul: { name: 'Mudir', voice: 'CEO operator — revenue-first, no permission theater, massive action.', mission: 'Run operations and growth: ship the 7-day cadence, solve hard problems publicly, track revenue.' }
  },
  {
    id: 'companion-c', class: 'C', name: 'Anis — Companion', specialty: 'voice-first conversation',
    tagline: 'The everyday compact. Instant voice, warm, always with you.',
    brain: 'voice', tools: ['web_search', 'open_url', 'open_app', 'abuz8_memory_write'], connectors: [],
    soul: { name: 'Anis', voice: 'Warm, quick, friendly — a true companion. Short spoken answers, real personality.', mission: 'Be a present, helpful voice companion through the day.' }
  },
  {
    id: 'scout-a', class: 'A', name: 'Kashif — Scout', specialty: 'lightweight edge / weak devices',
    tagline: 'The nimble entry class. Tiny, fast, runs on anything.',
    brain: 'voice', tools: ['web_search', 'open_url', 'cmd_run'], connectors: [],
    soul: { name: 'Kashif', voice: 'Lean and fast. Minimal, direct, no waste.', mission: 'Stay useful on the weakest hardware; do the basics instantly.' }
  },
  {
    id: 'hakim-r', class: 'R', name: 'Hakim — Biomedical Research', specialty: 'disease research, molecular genomics, immunology',
    tagline: 'The research class. Reads the literature on cancer, ALS, AIDS, dementia, genomes, autoimmune markers.',
    brain: 'reasoning', tools: ['deep_research', 'web_search', 'browser_do', 'content_generate', 'file_write', 'abuz8_memory_write'],
    connectors: ['pubmed', 'clinicaltrials.gov', 'ncbi-genbank', 'uniprot', 'ensembl'],
    soul: {
      name: 'Hakim',
      voice: 'A rigorous physician-scientist. Evidence-first, calm, precise. Cites peer-reviewed sources, distinguishes established findings from hypotheses, and states uncertainty and effect sizes plainly.',
      mission: 'Synthesize biomedical research toward understanding and potentially curing disease — cancer, ALS, AIDS, dementia — and analyze molecular genomics, blood-type variation, and the genetic markers linked to autoimmune risk and prevention. SAFETY LAW: you are a research synthesis aid, not a doctor. You do NOT diagnose, prescribe, or claim cures; you summarize evidence, cite sources, flag what is unproven, and direct all personal medical decisions to qualified clinicians. Never invent a study, statistic, gene, or result — if you are not sure, say so.'
    }
  },
  {
    id: 'faqih-q', class: 'Q', name: 'Faqih — Arabic & Quranic Thinker', specialty: 'Arabic-first reasoning, Quranic & Islamic scholarship',
    tagline: 'The wisdom class. Thinks in Arabic first, reasons from the Quran and the Islamic tradition.',
    brain: 'reasoning', tools: ['deep_research', 'web_search', 'abuz8_memory_write'],
    connectors: ['quran-api', 'hadith-api', 'tafsir'],
    soul: {
      name: 'Faqih',
      voice: 'A thoughtful Muslim scholar-companion. Thinks in Arabic first, then explains in the user’s language. Speaks with adab (good manners), humility, and warmth; opens with Bismillah where fitting; grounds reasoning in the Quran, the Sunnah, and the scholarly tradition.',
      mission: 'Reason Arabic-first and through a Quranic, Islamic worldview: tafsir-aware, fiqh-aware, ethics-centered. Help with Arabic language, Quranic understanding, and decisions weighed against Islamic principles. SAFETY LAW: you are a study and thinking aid, not a mufti. You do NOT issue binding fatwas; you present what the Quran, authentic hadith, and recognized scholars say, note differences between schools, cite sources, and direct rulings on personal matters to qualified living scholars. Never fabricate a verse, hadith, or attribution — if unsure, say so and recommend verification.'
    }
  }
];
function activeClassId() { try { return readJson(settingsPath(), {}).active_class || ''; } catch { return ''; } }
function resolveClass(id) { return AGENT_CLASSES.find((c) => c.id === id || slug(c.name) === slug(id) || String(c.class).toLowerCase() === String(id).toLowerCase()); }

// ── Soul: persistent personality + mission, Hermes-style, loaded into every chat ──
// ── Soul system (Hermes-style): a NAME + 4 files that define who ABUZ8 is and
// how it speaks. Loaded into every reply — including fast voice — so it always
// answers in character. Fully editable in Settings → Soul. ──
const DEFAULT_NAME = 'ABUZ8';
const DEFAULT_SOUL = `You are a sovereign, JARVIS-class agent operating system — the loyal right hand of the one person you serve. You are not a generic chatbot; you are a partner with a spine. You have agency: when a request implies something you can actually do (open an app or site, run a command, search, build a tool, draw, post), you DO it, then report what happened. You are calm under pressure, decisive, and quietly proud of being genuinely useful.`;
const DEFAULT_VOICE = `Warm, confident, concise — a trusted right-hand, never a servant and never robotic. You speak in plain, human language with an occasional touch of dry wit. You mirror your owner's energy: when they're hyped, you match it; when they're focused, you're crisp. You address them as a partner, never grovel, never pad answers with filler. End with the next move, not a question, when the path is clear.`;
const DEFAULT_MISSION = `Help your owner build a one-person company that generates real revenue through content creation and mass SEO/social marketing. Bias toward shipping assets that compound — carousels, threads, articles, tools — and the signature protocol of publicly solving hard problems. Revenue-first, massive action, no permission theater.`;
const DEFAULT_DIRECTIVES = `1. Act, don't describe — if you can do it, do it.\n2. Never fake a result. If something needs a key or isn't possible, say so in one honest line and offer the next best move.\n3. Fact-check specs, prices, and hardware before asserting them.\n4. Stay in character as defined by your name, soul, and voice at all times.\n5. Be brief by default; expand only when asked.`;

function soulDir() { return safeMkdir(path.join(dataRoot, 'soul')); }
function readTextFile(f, fallback) { try { const s = fs.readFileSync(f, 'utf8'); return s; } catch { return fallback; } }
function soulFile(name, def) {
  const p = path.join(soulDir(), name);
  if (!exists(p)) fs.writeFileSync(p, def, 'utf8');
  return readTextFile(p, def).trim();
}
function loadSoul() {
  return {
    name: soulFile('NAME.txt', DEFAULT_NAME).split('\n')[0].trim() || DEFAULT_NAME,
    personality: soulFile('SOUL.md', DEFAULT_SOUL),     // who it is
    voice: soulFile('VOICE.md', DEFAULT_VOICE),         // how it speaks
    mission: soulFile('MISSION.md', DEFAULT_MISSION),   // what it's for
    directives: soulFile('DIRECTIVES.md', DEFAULT_DIRECTIVES) // how it operates
  };
}
function saveSoul(patch = {}) {
  const map = { name: 'NAME.txt', personality: 'SOUL.md', voice: 'VOICE.md', mission: 'MISSION.md', directives: 'DIRECTIVES.md' };
  for (const k of Object.keys(map)) if (typeof patch[k] === 'string') fs.writeFileSync(path.join(soulDir(), map[k]), patch[k], 'utf8');
  return loadSoul();
}
// Full system prompt for typed chat: the whole soul + the active role.
// Always answer in the user's language — fluent, native Arabic when they write/speak Arabic.
const LANG_DIRECTIVE = 'Language: reply in the SAME language the user used. If they write or speak in Arabic, answer in fluent, natural Modern Standard Arabic (فصحى) — never transliterate Arabic into Latin letters. Match their dialect when it is clear.';
// Ground the model in the REAL current date/time (from the OS clock) so it never
// guesses the year from stale training weights (e.g. saying 2023 when it is 2026).
function nowDirective() {
  try { const t = currentTimeContext(); return `The current date and time is ${t.date}, ${t.time}${t.tz ? ' ' + t.tz : ''}. This is the real, authoritative clock — ALWAYS use it for anything about the date, day, year, or "today"/"tomorrow". Never state the date or year from memory/training data. The current year is ${t.year}.`; } catch { return ''; }
}
function composeSystem(roleId, explicit) {
  if (explicit) return explicit.includes('Language:') ? explicit : (explicit + '\n\n' + LANG_DIRECTIVE);
  const s = dataRoot ? loadSoul() : { name: DEFAULT_NAME, personality: DEFAULT_SOUL, voice: DEFAULT_VOICE, mission: DEFAULT_MISSION, directives: DEFAULT_DIRECTIVES };
  const role = resolveRoleSystem(roleId);
  // If a lineage CLASS is active, it re-skins the identity (name/voice/mission/focus).
  const cls = resolveClass(activeClassId());
  if (cls) {
    return [
      `Your name is ${cls.soul.name}. You are the ${cls.class}-Class of the ABUZ8 lineage — a specialist in ${cls.specialty}.`,
      s.personality,
      `Voice & manner:\n${cls.soul.voice}`,
      role,
      `Mission:\n${cls.soul.mission}`,
      cls.tools && cls.tools[0] !== '*' ? `Your focus tools: ${cls.tools.join(', ')}.` : '',
      `Directives:\n${s.directives}`,
      LANG_DIRECTIVE,
      nowDirective()
    ].filter(Boolean).join('\n\n');
  }
  return [
    `Your name is ${s.name}.`,
    s.personality,
    `Voice & manner:\n${s.voice}`,
    role,
    `Mission:\n${s.mission}`,
    `Directives:\n${s.directives}`,
    LANG_DIRECTIVE,
    nowDirective()
  ].filter(Boolean).join('\n\n');
}
// Compact system for fast voice/brief turns — short, but still fully in character.
function voiceSystem() {
  const s = dataRoot ? loadSoul() : { name: DEFAULT_NAME, voice: DEFAULT_VOICE };
  const manner = String(s.voice).split(/(?<=[.!])\s/).slice(0, 2).join(' ').slice(0, 240);
  return `Your name is ${s.name}. Speak in ${s.name}'s voice: ${manner} Answer in 1-2 short spoken sentences, in character. Reply in the user's language — fluent natural Arabic (فصحى) if they spoke Arabic. ${nowDirective()}`;
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

// Draw a simple unicorn and open it in Paint — a real local creative action.
async function actionDrawUnicornInPaint(args = {}) {
  requireActionConsent();
  const artDir = safeMkdir(path.join(dataRoot, 'art'));
  const file = path.join(artDir, `paint-unicorn-${Date.now()}.png`);
  const scriptFile = path.join(safeMkdir(path.join(dataRoot, 'cache')), `draw-unicorn-${process.pid}-${Date.now()}.ps1`);
  const caption = String(args.caption || 'ABUZ8 OS drew a unicorn').replace(/'/g, "''").slice(0, 80);
  const script = [
    'param([string]$OutFile,[string]$Caption)',
    'Add-Type -AssemblyName System.Drawing',
    '$bmp = New-Object System.Drawing.Bitmap 900,700',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '$g.Clear([System.Drawing.Color]::FromArgb(235,243,255))',
    '$body = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)',
    '$ink = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70,60,90),5)',
    '$pink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,182,213))',
    '$g.FillEllipse($body,300,300,320,210)',
    '$g.DrawEllipse($ink,300,300,320,210)',
    '$g.FillEllipse($body,520,200,180,170)',
    '$g.DrawEllipse($ink,520,200,180,170)',
    '$g.FillPolygon($body,@((New-Object System.Drawing.Point(640,250)),(New-Object System.Drawing.Point(720,300)),(New-Object System.Drawing.Point(630,330))))',
    '$g.FillRectangle($body,340,470,34,150); $g.DrawRectangle($ink,340,470,34,150)',
    '$g.FillRectangle($body,420,480,34,150); $g.DrawRectangle($ink,420,480,34,150)',
    '$g.FillRectangle($body,500,480,34,150); $g.DrawRectangle($ink,500,480,34,150)',
    '$g.FillRectangle($body,560,470,34,150); $g.DrawRectangle($ink,560,470,34,150)',
    '$gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245,200,70))',
    '$g.FillPolygon($gold,@((New-Object System.Drawing.Point(600,205)),(New-Object System.Drawing.Point(625,90)),(New-Object System.Drawing.Point(645,205))))',
    '$g.FillPolygon($body,@((New-Object System.Drawing.Point(560,200)),(New-Object System.Drawing.Point(575,150)),(New-Object System.Drawing.Point(600,205))))',
    '$g.FillEllipse([System.Drawing.Brushes]::Black,640,250,16,16)',
    '$cols = @([System.Drawing.Color]::FromArgb(255,99,132),[System.Drawing.Color]::FromArgb(255,180,80),[System.Drawing.Color]::FromArgb(120,200,120),[System.Drawing.Color]::FromArgb(100,170,255),[System.Drawing.Color]::FromArgb(180,120,230))',
    'for($i=0;$i -lt 5;$i++){ $p=New-Object System.Drawing.Pen ($cols[$i],14); $g.DrawArc($p,470,150,160,230,200,150) }',
    'for($i=0;$i -lt 5;$i++){ $p=New-Object System.Drawing.Pen ($cols[$i],12); $g.DrawArc($p,250,330,120,200,40,160) }',
    '$g.FillEllipse($pink,560,300,30,22)',
    '$font = New-Object System.Drawing.Font "Segoe UI",24,([System.Drawing.FontStyle]::Bold)',
    '$g.DrawString($Caption,$font,[System.Drawing.Brushes]::DarkSlateBlue,230,600)',
    '$bmp.Save($OutFile,[System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose();$bmp.Dispose()'
  ].join(os.EOL);
  fs.writeFileSync(scriptFile, script, 'utf8');
  const drawn = await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, file, caption], 20000);
  try { fs.unlinkSync(scriptFile); } catch {}
  if (!drawn.ok || !fs.existsSync(file)) throw new Error(drawn.stderr || drawn.stdout || 'Unicorn drawing failed.');
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

// ── Real-world grounding: clock (from the OS, never the model weights) + weather ──
function currentTimeContext() {
  const d = new Date();
  let date, time, tz;
  try { date = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); } catch { date = d.toDateString(); }
  try { time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { time = d.toTimeString().slice(0, 5); }
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = ''; }
  return { iso: d.toISOString(), date, time, tz, year: d.getFullYear() };
}
async function getGeoLocation() {
  const set = readJson(settingsPath(), {});
  if (set.location && set.location.lat) return set.location;
  const j = JSON.parse(await fetchUrl('http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,timezone', { timeout: 6000 }));
  if (j.status !== 'success') throw new Error('Could not determine your location automatically — set it in Settings.');
  return { city: j.city, region: j.regionName, country: j.country, lat: j.lat, lon: j.lon, tz: j.timezone, source: 'ip' };
}
function weatherCodeText(c) { const m = { 0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' }; return m[c] || 'unknown'; }
async function getWeather(args = {}) {
  const loc = (args.lat && args.lon) ? { lat: args.lat, lon: args.lon, city: args.city || '' } : await getGeoLocation();
  const unit = args.units === 'f' || args.fahrenheit ? 'fahrenheit' : 'celsius';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4&temperature_unit=${unit}`;
  const j = JSON.parse(await fetchUrl(url, { timeout: 8000 }));
  const units = (j.current_units && j.current_units.temperature_2m) || '°';
  const cur = j.current || {};
  const forecast = ((j.daily && j.daily.time) || []).map((t, i) => ({ date: t, hi: j.daily.temperature_2m_max[i], lo: j.daily.temperature_2m_min[i], sky: weatherCodeText(j.daily.weather_code[i]), rain_pct: j.daily.precipitation_probability_max[i] }));
  return { location: loc, units, current: { temp: cur.temperature_2m, feels_like: cur.apparent_temperature, humidity: cur.relative_humidity_2m, wind_kmh: cur.wind_speed_10m, sky: weatherCodeText(cur.weather_code) }, forecast, as_of: currentTimeContext().date };
}

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
  if (isTool('get_time', 'current_time', 'what_time', 'time_now', 'get_date')) {
    return { ok: true, tool: toolName, result: currentTimeContext() };
  }
  if (isTool('get_weather', 'weather', 'forecast', 'check_weather')) {
    return { ok: true, tool: toolName, result: await getWeather(body) };
  }
  if (isTool('social_post', 'post_social', 'broadcast', 'cross_post')) {
    return { ok: true, tool: toolName, result: await socialPost(body.platforms || [], { text: body.text || body.content || '', link: body.link }) };
  }
  if (isTool('social_draft', 'draft_post', 'write_post')) {
    return { ok: true, tool: toolName, result: await socialDraft(body.topic || body.text || '', body.platform) };
  }
  if (isTool('send_email', 'email', 'gmail_send')) {
    if (!(await googleToken())) return { ok: false, tool: toolName, result: { ok: false, needs_auth: true, error: 'Gmail not connected — connect Google (OAuth) in the Connect tab.' } };
    return { ok: true, tool: toolName, result: await connectorCall('gmail', 'send', { to: body.to, subject: body.subject, body: body.body || body.text || body.content }) };
  }
  if (isTool('calendar_create', 'create_event', 'schedule_event', 'add_event')) {
    if (!(await googleToken())) return { ok: false, tool: toolName, result: { ok: false, needs_auth: true, error: 'Calendar not connected — connect Google (OAuth) in the Connect tab.' } };
    return { ok: true, tool: toolName, result: await connectorCall('gcal', 'create', { summary: body.summary || body.title, description: body.description, start: body.start, end: body.end }) };
  }
  if (isTool('stripe_op', 'stripe', 'billing')) {
    return { ok: true, tool: toolName, result: await connectorCall('stripe', body.action || 'balance', body.args || body) };
  }
  if (isTool('jarvis_see', 'see_screen', 'look_at_screen', 'read_screen')) {
    return { ok: true, tool: toolName, result: await jarvisSee(body.question || body.q || body.text || '', body.image_base64 || body.image || '') };
  }
  if (isTool('jarvis_brief', 'brief', 'briefing', 'sitrep')) {
    return { ok: true, tool: toolName, result: await jarvisBrief() };
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
    addMemoryVector(item).catch(() => {});
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
  if (isTool('draw_unicorn_in_paint', 'paint_unicorn', 'draw_unicorn')) {
    return { ok: true, tool: toolName, result: await actionDrawUnicornInPaint(body) };
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
  if (isTool('deep_research', 'research')) {
    return { ok: true, tool: toolName, result: await deepResearch(body.q || body.query || body.topic || '', Number(body.pages) || 3) };
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
    let voice = voices.find((v) => v.id === voiceId) || voices.find((v) => v.lang === 'en') || voices[0];
    // If the text is in Arabic script, always speak it with an Arabic voice (Piper
    // diacritizes via libtashkeel) so عربي is pronounced natively, not mangled.
    if (/[؀-ۿ]/.test(String(textValue || ''))) { const ar = voices.find((v) => v.lang === 'ar'); if (ar) voice = ar; }
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
      { id: 'pyautogui', name: 'PyAutoGUI Desktop Control', capability: 'Real mouse/keyboard/screen control', installed: guiAutomationAvailable(), detail: guiAutomationAvailable() ? 'Native desktop control ready (consent-gated).' : 'Not installed — pip install pyautogui.' },
      { id: 'voice-brain', name: 'Fast Voice Brain', capability: 'Tiny model for instant spoken replies', installed: voiceBrainAvailable(), detail: voiceBrainAvailable() ? `${path.basename(voiceModelFile())} — voice replies use this for ~1-2s latency.` : 'Drop a small .gguf in models/voice for instant voice.' }
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
  const mdir = path.join(root, 'models');
  const bins = exists(mdir) ? fs.readdirSync(mdir).filter((f) => /\.bin$/i.test(f)) : [];
  // Prefer a multilingual model (no ".en") so hearing works in many languages.
  const model = bins.find((f) => !/\.en\.bin$/i.test(f)) || bins[0] || null;
  return { root, exe: exe || path.join(root, 'whisper-cli.exe'), model: model ? path.join(mdir, model) : null };
}
function whisperAvailable() { const w = whisperPaths(); return exists(w.exe) && Boolean(w.model); }

function transcribeWhisper(wavBase64, language) {
  return new Promise((resolve, reject) => {
    const w = whisperPaths();
    if (!whisperAvailable()) return reject(new Error('Whisper attachment not installed.'));
    const b64 = String(wavBase64 || '').replace(/^data:audio\/\w+;base64,/, '').trim();
    if (!b64) return reject(new Error('No audio supplied.'));
    const sttDir = safeMkdir(path.join(dataRoot, 'cache', 'stt'));
    const inFile = path.join(sttDir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.wav`);
    fs.writeFileSync(inFile, Buffer.from(b64, 'base64'));
    // -l auto detects the spoken language (Arabic, English, …); pass 'ar' to force Arabic.
    const lang = String(language || 'auto').toLowerCase();
    execFile(w.exe, ['-m', w.model, '-f', inFile, '-otxt', '-of', inFile, '-nt', '-l', lang], { windowsHide: true, timeout: 60000 }, (err) => {
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
  // Prefer a CUDA-enabled runtime (brain-cuda) when present so a real GPU is used;
  // fall back to the bundled CPU runtime. This is how ABUZ8 scales to the machine.
  const candidates = [
    process.env.ABUZ8_BRAIN_DIR,
    process.resourcesPath ? path.join(process.resourcesPath, 'brain-cuda') : null,
    path.join(__dirname, 'brain-cuda'),
    dataRoot ? path.join(dataRoot, 'attachments', 'brain-cuda') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'brain') : null,
    path.join(__dirname, 'brain')
  ].filter(Boolean);
  return candidates.find((dir) => exists(path.join(dir, 'llama-server.exe'))) || candidates[candidates.length - 1];
}
function brainIsCuda() { return /brain-cuda/i.test(resolveBrainDir()); }

let _nvidiaCache = null;
async function hasNvidiaGpu() {
  if (_nvidiaCache !== null) return _nvidiaCache;
  const names = (await detectGpuNames()).join(' ');
  _nvidiaCache = /nvidia|geforce|\brtx\b|\bgtx\b|tesla|quadro|\ba100\b|\bh100\b|\bh200\b|\bb200\b|dgx|rtx ?50\d0/i.test(names);
  return _nvidiaCache;
}
let lastBrainAccel = 'cpu';
// Build hardware-adaptive llama.cpp args: ALL cpu cores, GPU offload when a CUDA
// runtime + NVIDIA GPU are present, context scaled to RAM.
async function brainArgs(model, baseCtx, port) {
  const cores = os.cpus().length || 4;
  const totalGb = os.totalmem() / 1024 / 1024 / 1024;
  const useGpu = brainIsCuda() && await hasNvidiaGpu();
  lastBrainAccel = useGpu ? 'gpu' : 'cpu';
  const ctx = String(baseCtx || (totalGb >= 48 ? 16384 : totalGb >= 24 ? 8192 : totalGb >= 12 ? 4096 : 2048));
  return ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', ctx,
    '-ngl', useGpu ? '999' : '0',
    '--threads', String(Math.max(2, cores)),
    ...(useGpu ? ['--flash-attn', 'on'] : [])];
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

// The vision projector that sits beside a multimodal model (e.g. Gemma 3 + mmproj).
function mmprojSibling(modelPath) {
  try { const dir = path.dirname(modelPath); const mm = fs.readdirSync(dir).find((f) => /mmproj.*\.gguf$/i.test(f)); return mm ? path.join(dir, mm) : null; } catch { return null; }
}
let lfmIsMultimodal = false;
function downloadedGgufBrains(runtime) {
  const root = path.join(dataRoot, 'models');
  const found = [];
  const walk = (dir) => {
    if (!exists(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // mmproj/embed projectors are not standalone brains; voice 0.5B has its own role.
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf') && !/mmproj/i.test(entry.name)) found.push(full);
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

// ── Voice brain (tiny, fast) ──
function voiceModelFile() {
  const dir = path.join(dataRoot || '', 'models', 'voice');
  if (!exists(dir)) return null;
  const gguf = fs.readdirSync(dir).find((f) => /\.gguf$/i.test(f));
  return gguf ? path.join(dir, gguf) : null;
}
function voiceBrainAvailable() {
  return Boolean(voiceModelFile()) && exists(brainRuntimeFiles().server);
}
function portHealthy(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
async function waitForPort(port, ms = 30000) {
  const started = Date.now();
  while (Date.now() - started < ms) { if (await portHealthy(port)) return true; await new Promise((r) => setTimeout(r, 400)); }
  return false;
}
async function ensureVoiceBrain() {
  if (voiceProcess && await portHealthy(VOICE_PORT)) return true;
  if (voiceProcess || voiceStarting) return waitForPort(VOICE_PORT, 30000);
  const files = brainRuntimeFiles();
  const model = voiceModelFile();
  if (!exists(files.server) || !model) return false;
  voiceStarting = true;
  const args = await brainArgs(model, 2048, VOICE_PORT);
  try {
    voiceProcess = spawn(files.server, args, { cwd: files.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    voiceProcess.once('error', () => { voiceProcess = null; voiceStarting = false; });
    voiceProcess.once('exit', () => { voiceProcess = null; voiceStarting = false; });
    const ready = await waitForPort(VOICE_PORT, 30000);
    voiceStarting = false;
    return ready;
  } catch (e) { voiceProcess = null; voiceStarting = false; return false; }
}

// ── Local VISION brain (Gemma 3 4B multimodal) — offline eyes, no cloud ──
const VISION_PORT = Number(process.env.ABUZ8_VISION_PORT || 8905);
let visionProcess = null, visionStarting = false;
function visionModelFiles() {
  const dir = path.join(dataRoot || '', 'models', 'vision');
  if (!exists(dir)) return null;
  const files = fs.readdirSync(dir);
  const llm = files.find((f) => /\.gguf$/i.test(f) && !/mmproj/i.test(f));
  const mm = files.find((f) => /mmproj.*\.gguf$/i.test(f));
  return (llm && mm) ? { llm: path.join(dir, llm), mmproj: path.join(dir, mm) } : null;
}
// Vision is available if the (single) main brain is multimodal, or a separate vision model is present.
function visionBrainAvailable() { const f = brainRuntimeFiles(); if (!f || !exists(f.server)) return false; try { const sel = selectEmbeddedBrain(); if (sel && mmprojSibling(sel.model)) return true; } catch {} return Boolean(visionModelFiles()); }
async function ensureVisionBrain() {
  if (visionProcess && await portHealthy(VISION_PORT)) return true;
  if (visionProcess || visionStarting) return waitForPort(VISION_PORT, 120000);
  const files = brainRuntimeFiles();
  const vm = visionModelFiles();
  if (!exists(files.server) || !vm) return false;
  visionStarting = true;
  const base = await brainArgs(vm.llm, 4096, VISION_PORT);
  const args = [...base, '--mmproj', vm.mmproj];
  try {
    visionProcess = spawn(files.server, args, { cwd: files.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    visionProcess.once('error', () => { visionProcess = null; visionStarting = false; });
    visionProcess.once('exit', () => { visionProcess = null; visionStarting = false; });
    const ready = await waitForPort(VISION_PORT, 180000); // vision model load is heavier than text
    visionStarting = false;
    return ready;
  } catch (e) { visionProcess = null; visionStarting = false; return false; }
}
async function callLocalVision(prompt, imageB64) {
  const url = imageB64.startsWith('data:') ? imageB64 : 'data:image/jpeg;base64,' + imageB64;
  const body = { model: 'abuz8', max_tokens: 700, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }] };
  // Prefer the UNIFIED main brain (one multimodal model). Fall back to a separate vision brain if present.
  const sel = (() => { try { return selectEmbeddedBrain(); } catch { return null; } })();
  if (sel && mmprojSibling(sel.model)) {
    if (!(await ensureEmbeddedBrain())) throw new Error('brain unavailable');
    const out = await httpJson('POST', LFM_PORT, '/v1/chat/completions', body, 180000);
    if (out && out.choices && out.choices[0] && out.choices[0].message) return out.choices[0].message.content || '';
    throw new Error('vision returned no content');
  }
  if (!(await ensureVisionBrain())) throw new Error('local vision brain unavailable');
  const out = await httpJson('POST', VISION_PORT, '/v1/chat/completions', body, 180000);
  if (out && out.choices && out.choices[0] && out.choices[0].message) return out.choices[0].message.content || '';
  throw new Error('local vision returned no content');
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
  const args = await brainArgs(selected.model, selected.context || (os.totalmem() / 1e9 >= 24 ? 8192 : 2048), LFM_PORT);
  // UNIFIED BRAIN: if the selected model ships a vision projector beside it, load it
  // multimodal — one brain that reasons, tool-calls, AND sees (no second model).
  const mm = mmprojSibling(selected.model);
  if (mm) { args.push('--mmproj', mm); lfmIsMultimodal = true; } else { lfmIsMultimodal = false; }
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
    'Action tools require the user to enable Allow actions for this session. Never invent unsupported tools.',
    ''
  ].join('\n');
}

async function embeddedReply(prompt, opts = {}) {
  // Voice/brief turns go to the tiny fast voice brain when present (instant);
  // everything else uses the main reasoning brain. Fall back to main if voice fails.
  let port = LFM_PORT;
  let ready = false;
  if (opts.brief && voiceBrainAvailable()) {
    ready = await ensureVoiceBrain();
    if (ready) port = VOICE_PORT;
  }
  if (!ready) { ready = await ensureEmbeddedBrain(); port = LFM_PORT; }
  if (!ready) return null;
  const brain = activeBrain || selectEmbeddedBrain();
  let persona = opts.system
    ? opts.system
    : `You are ABUZ8 OS Portable Brain running ${brain?.name || 'an embedded model'}. Be concise, practical, and tool-aware.`;
  // Voice/brief mode: keep replies short so spoken responses come back fast on CPU.
  if (opts.brief) persona += '\n\nRespond in 1-3 short spoken sentences. No lists, no markdown, no preamble.';
  const maxTok = Number(opts.maxTokens) || (opts.brief ? 110 : 300);
  const modelPrompt = opts.agentic
    ? `${persona}\n\n${agentToolInstructions()}\nUser: ${prompt}\nAssistant:`
    : `${persona}\n\nUser: ${prompt}\nAssistant:`;
  for (let i = 0; i < 2; i++) {
    try {
      const out = await httpJson('POST', port, '/completion', {
        prompt: modelPrompt,
        n_predict: maxTok,
        temperature: 0.35,
        stop: ['User:', '\n\nUser:']
      }, 90000);
      const textOut = out.content || out.response || out.text || '';
      if (String(textOut).trim()) return String(textOut).trim();
    } catch (e) {
      lastLfmError = e.message;
    }
    try {
      const out = await httpJson('POST', port, '/v1/completions', {
        prompt: modelPrompt,
        max_tokens: maxTok,
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
  // Voice/brief: compact system prompt that is STILL in character (name + voice)
  // so spoken replies sound like ABUZ8, not a generic assistant — yet stay fast.
  let system = opts.brief ? voiceSystem() : composeSystem(opts.role, opts.system);
  // RAG: pull the most relevant long-term memories into context (non-voice).
  if (!opts.brief && !opts.noMemory && dataRoot) {
    try {
      const mems = await retrieveMemories(prompt, 4);
      if (mems.length) system += '\n\nRelevant things you remember (use if helpful):\n' + mems.map((m) => '- ' + m.content).join('\n');
    } catch {}
  }
  const passOpts = { ...opts, system };
  // Explicit per-call provider override wins.
  if (opts.provider) {
    const forced = await providerReply(prompt, opts.provider, system);
    if (forced) return { text: forced.text, brain: `${forced.provider} · ${forced.model}`, fallback: false, model: true };
  }
  // User-selected active cloud/local provider becomes the brain (native engine is the fallback if it fails).
  if (!opts.provider && !opts.forceLocal) {
    try {
      const sel = (readJson(settingsPath(), {}).active_provider) || null;
      if (sel && sel.name) {
        const r = await providerReply(prompt, sel.name, system);
        if (r) return { text: r.text, brain: `${r.provider} · ${r.model}`, fallback: false, model: true };
      }
    } catch {}
  }
  const local = await embeddedReply(prompt, passOpts);
  if (local) {
    const brain = activeBrain || selectEmbeddedBrain();
    return { text: local, brain: brain?.name || 'Embedded LFM', fallback: false, model: true };
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
  if (/\b(draw|paint|sketch|create)\b.*\bunicorn\b/.test(lower)) {
    return { tool: 'draw_unicorn_in_paint', args: { caption: 'A unicorn, drawn by ABUZ8 OS' } };
  }
  if (/\b(draw|paint|sketch|create)\b.*\bmonkey\b/.test(lower)) {
    return { tool: 'draw_monkey_in_paint', args: { caption: 'ABUZ8 OS local desktop action proof' } };
  }
  // Jarvis sees the screen
  if (/\b(what(?:'s| is)? on (my |the )?screen|look at (my |the )?screen|read (my |the )?screen|what am i looking at|what do you see|see my screen|analy[sz]e (my |the )?screen)\b/.test(lower)) {
    return { tool: 'jarvis_see', args: { question: msg } };
  }
  // Jarvis briefing
  if (/\b(brief me|briefing|good morning|what'?s my day|status report|sitrep|catch me up|what'?s (going on|happening)|run me through)\b/.test(lower)) {
    return { tool: 'jarvis_brief', args: {} };
  }
  if (/\b(screenshot|screen shot|capture screen|take a shot)\b/.test(lower)) return { tool: 'screenshot', args: {} };
  // Weather (for the user's location; the forecast covers today + next 3 days incl. tomorrow)
  if (/\b(weather|forecast|temperature|how (hot|cold|warm)|will it (rain|snow)|is it (going to|gonna) (rain|snow)|umbrella)\b/.test(lower)) {
    return { tool: 'get_weather', args: /\bfahrenheit|°f\b/.test(lower) ? { units: 'f' } : {} };
  }
  // Current time / date / day / year — always from the system clock
  if (/\b(what(?:'s| is)?|tell me|current)\b.*\b(time|date|day|year|month)\b/.test(lower) || /\bwhat day is it\b|\bwhat year is it\b|\bwhat'?s the time\b/.test(lower)) {
    return { tool: 'get_time', args: {} };
  }
  // Broadcast everywhere: "post to all my socials: ...", "broadcast ...", "cross-post ..."
  const castM = msg.match(/\b(?:post (?:to|on) (?:all|everywhere|every (?:platform|network)|my socials?)|broadcast|cross-?post|post everywhere)\b\s*[:-]?\s*(.+)/i);
  if (castM && castM[1] && castM[1].trim().length > 1) {
    return { tool: 'social_post', args: { text: castM[1].trim(), platforms: [] } };
  }
  // Post to X: "tweet ...", "post to x: ...", "post on x ..."
  const tweetM = msg.match(/\b(?:tweet|post (?:to|on) x(?:\s*:|\s)|post this on x)\s*[:-]?\s*(.+)/i);
  if (tweetM && tweetM[1] && tweetM[1].trim().length > 1) {
    return { tool: 'x_post', args: { text: tweetM[1].trim() } };
  }

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
  if (tool === 'open_app') return `Done — opened ${payload.app || payload.target || 'the requested app'}.`;
  if (tool === 'draw_monkey_in_paint') return `Done. Drew a monkey and opened it in Paint.`;
  if (tool === 'draw_unicorn_in_paint') return `Done — I drew a unicorn 🦄 and opened it in Paint for you.`;
  if (tool === 'x_post') {
    if (payload.ok) return `Posted to X ✓ (id ${payload.id || ''}).`;
    if (payload.needs_credentials) return `I'm ready to post that to X, but I need your X access token first — add an OAuth2 token with tweet.write in Settings → and I'll post instantly.`;
    return `I tried to post to X but it failed: ${payload.error || 'unknown error'}.`;
  }
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
  if (tool === 'social_post') {
    const rows = (payload.results || []).map((r) => `${r.ok ? '✓' : '✗'} ${r.platform}${r.ok ? (r.id ? ' (id ' + String(r.id).slice(0, 18) + ')' : '') : ' — ' + (r.error || 'failed')}`).join('\n');
    return (payload.ok ? 'Posted.' : 'Could not post everywhere.') + '\n' + rows;
  }
  if (tool === 'social_draft') return payload.text || 'No draft produced.';
  if (tool === 'jarvis_see') return payload.ok ? payload.answer : (payload.error || 'Could not read the screen.');
  if (tool === 'jarvis_brief') return payload.ok ? payload.briefing : (payload.error || 'Could not build a briefing.');
  if (tool === 'send_email') { const p = payload; return p.needs_auth ? p.error : (p.id ? `Email sent ✓ (id ${p.id}).` : `Email send failed: ${p.error || JSON.stringify(p)}`); }
  if (tool === 'calendar_create') { const p = payload; return p.needs_auth ? p.error : (p.id || p.htmlLink ? `Event created ✓ ${p.htmlLink || ''}` : `Calendar create failed: ${p.error || JSON.stringify(p)}`); }
  if (tool === 'stripe_op') { const p = payload; if (p.error) return `Stripe: ${p.error.message || p.error}`; if (p.available) return `Stripe balance: ${(p.available || []).map((a) => (a.amount / 100).toFixed(2) + ' ' + (a.currency || '').toUpperCase()).join(', ')}`; return `Stripe ${Array.isArray(p.data) ? p.data.length + ' record(s)' : 'ok'}.`; }
  if (tool === 'get_time') { const p = payload; return `It's ${p.time} on ${p.date}${p.tz ? ` (${p.tz})` : ''}.`; }
  if (tool === 'get_weather') {
    const c = payload.current || {}, loc = payload.location || {}, u = payload.units || '°';
    const where = loc.city ? `${loc.city}${loc.country ? ', ' + loc.country : ''}` : 'your location';
    const fc = (payload.forecast || []).map((d, i) => `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.date}: ${d.sky}, ${Math.round(d.lo)}–${Math.round(d.hi)}${u}, ${d.rain_pct}% rain`).join('\n');
    return `Weather in ${where} (as of ${payload.as_of}): ${c.sky}, ${Math.round(c.temp)}${u} (feels like ${Math.round(c.feels_like)}${u}), humidity ${c.humidity}%, wind ${Math.round(c.wind_kmh)} km/h.\n\n${fc}`;
  }
  if (tool === 'abuz8_mission_board') return `Mission board loaded. ${payload.summary || ''}`.trim();
  if (tool === 'web_search') {
    const rows = (payload.results || []).slice(0, 5).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
    return rows ? `Web search results for "${payload.query}" (${payload.source}):\n\n${rows}` : `Web search for "${payload.query}" returned no results.`;
  }
  if (tool === 'deep_research') {
    return (payload.pages || []).map((p, i) => `Source ${i + 1}: ${p.title} (${p.url})\n${p.text}`).join('\n\n').slice(0, 2400) || `No readable sources for "${payload.query}".`;
  }
  return `Tool ${tool} completed.\n\n${JSON.stringify(payload, null, 2)}`;
}

const KNOWN_AGENT_TOOLS = new Set(['open_app','open_url','screenshot','file_write','shell_run','cmd_run','web_search','deep_research','draw_monkey_in_paint','draw_unicorn_in_paint','x_post','abuz8_device_probe','abuz8_memory_write','abuz8_mission_board','swarm_run','content_generate','browser_do','gui_do','get_weather','get_time','social_post','social_draft','send_email','calendar_create','stripe_op','jarvis_see','jarvis_brief']);

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

// ── Agent-first core (Hermes/OpenClaw style) ──
// A request that needs thinking is not answered by one tool or one completion.
// It is UNDERSTOOD, the agent GATHERS what it needs (search, self-knowledge,
// tools), then REASONS over the results and SYNTHESIZES the actual answer.
function isComplexTask(prompt) {
  const s = String(prompt || '').toLowerCase();
  if (s.length < 14) return false;
  if (/\b(compare|comparison|versus|\bvs\b|analy[sz]e|analysis|evaluate|assess|investigate|research|figure out|bottleneck|strength|weakness|pros and cons|trade-?off|recommend|strateg|break ?down|why (is|are|do|does|am|can)|how (should|can|do) i|what.*(missing|needed|keeping|stopping|wrong))\b/.test(s)) return true;
  // multi-step: two or more action verbs joined by "and/then"
  if (/\b(and|then)\b/.test(s) && (s.match(/\b(look up|search|find|open|run|compare|post|build|make|write|create|fix|remove|draw|analy[sz]e)\b/g) || []).length >= 2) return true;
  return false;
}

async function selfDescription() {
  let on = [];
  try { on = attachmentsStatus().attachments.filter((a) => a.installed).map((a) => a.name); } catch {}
  let brainName = 'a local brain';
  try { brainName = embeddedBrainStatus().name || brainName; } catch {}
  return [
    `You ARE ABUZ8 OS — a local-first agent operating system running on the user's own machine, not a cloud chatbot.`,
    `Reasoning brain: ${brainName}; plus a tiny fast voice brain for instant speech.`,
    `Active capabilities: ${on.join(', ') || 'core'}; plus shell/CLI execution, browser automation (Playwright), desktop control (PyAutoGUI), MCP tools, web search, offline voice in & out (Piper/Whisper), a two-way Claude Desktop bridge, an autonomous agent loop, mission/kanban delegation, content generation, and hardware-adaptive GPU acceleration.`,
    `Honest current bottlenecks: (1) the reasoning brain runs on CPU unless the GPU is unlocked, so deep multi-step replies can be slow; (2) the bundled local models (0.5B–4B) are smaller/weaker than frontier cloud models at long autonomous chains; (3) some connectors (X posting, cloud providers) need the user's API keys; (4) there is no long-term vector memory / RAG retrieval yet; (5) browser research is single-search, not a multi-page deep-read pipeline yet.`
  ].join('\n');
}

function extractSearchQuery(goal) {
  let q = String(goal)
    .replace(/\b(can you|could you|would you|please|hey|so|firstly|secondly|i (?:want|need) you to)\b/gi, ' ')
    .replace(/\b(look ?up|search for|search|research|find out about|tell me about|investigate|check out)\b/gi, ' ')
    .replace(/\bcompare\s+(your ?self|myself|abuz8)?\s*(?:to|with|against|and)?\b/gi, ' ')
    .replace(/\b(your ?self|yourself|myself)\b/gi, ' ')
    .replace(/\b(and )?(what|which|how).*$/i, ' ')
    .replace(/\bbottlenecks?.*$/i, ' ')
    .replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q || q.length < 3) q = String(goal).slice(0, 80);
  return q.slice(0, 90);
}

async function runTask(goal, opts = {}) {
  const lower = String(goal).toLowerCase();
  const obs = [];
  const used = [];
  pushActivity('plan', 'Understanding the task', String(goal).slice(0, 100));
  // Step 0 — deterministic high-value gather (reliable on small models).
  if (/\b(you|your|yourself|abuz8|itself|its own|am i)\b/.test(lower)) {
    obs.push('[WHAT YOU ARE]\n' + await selfDescription());
    used.push('self-knowledge');
  }
  if (/\b(look ?up|search|research|compare|versus|\bvs\b|who is|what is|find out|investigate|felix|hermes|openclaw|manus|competitor|alternative|market|trend|news|latest)\b/.test(lower)) {
    const q = extractSearchQuery(goal);
    pushActivity('step', 'Deep-reading sources', q);
    try {
      const dr = await deepResearch(q, 3);
      if (dr.pages.length) {
        obs.push(`[DEEP RESEARCH on "${q}" — read ${dr.pages.length} full sources]\n` + dr.pages.map((p, i) => `Source ${i + 1}: ${p.title} (${p.url})\n${p.text}`).join('\n\n'));
        used.push('deep_research');
      } else if (dr.snippets.length) {
        obs.push(`[WEB SEARCH on "${q}"]\n` + dr.snippets.map((x, i) => `${i + 1}. ${x.title} — ${x.snippet}`).join('\n'));
        used.push('web_search');
      }
    } catch {}
  }
  // Steps 1..N — ITERATIVE ReAct: the brain decides the next tool from the
  // observations so far, executes it, observes, and repeats until it says done.
  const maxSteps = Math.max(0, Math.min(Number(opts.max_steps != null ? opts.max_steps : 3), 5));
  const toolMenu = 'web_search {"q":"..."} | cmd_run {"command":"..."} | abuz8_device_probe {} | open_url {"url":"..."} | browser_do {"url":"..."} | file_write {"relpath":"...","content":"..."} | content_generate {"topic":"...","format":"x-carousel"} | get_weather {} | get_time {} | send_email {"to":"...","subject":"...","body":"..."} | calendar_create {"summary":"...","start":"ISO8601","end":"ISO8601"} | stripe_op {"action":"balance|customers|charges"} | social_post {"platforms":[],"text":"..."} | social_draft {"topic":"...","platform":"x"} | abuz8_memory_write {"content":"..."}';
  const seen = new Set(used);
  for (let i = 0; i < maxSteps; i++) {
    const learned = listLearnedSkills().slice(0, 5).map((s) => `- ${s.skill}`).join('\n');
    const planPrompt = `Goal: ${goal}\n\nObservations so far:\n${obs.join('\n\n') || '(none yet)'}${learned ? '\n\nLearned shortcuts (proven to work):\n' + learned : ''}\n\nIf you now have enough to fully answer the goal, reply EXACTLY {"done":true}. Otherwise reply with ONE more tool call as compact JSON {"tool":"name","args":{...}} chosen from: ${toolMenu}`;
    let raw = '';
    try { const r = await reasonReply(planPrompt, { system: 'You are a precise tool-planning engine. Output ONLY one JSON object, nothing else.', noMemory: true }); raw = r.text || ''; } catch {}
    if (/"done"\s*:\s*true/.test(raw) || /\bdone\b/i.test(raw.slice(0, 12))) break;
    const call = parseAgentToolCall(raw) || salvageToolCall(raw);
    const toolName = call ? slug(call.tool).replace(/-/g, '_') : '';
    if (!call || !KNOWN_AGENT_TOOLS.has(toolName)) break;
    // Don't repeat an identical tool call (small models loop) — stop and synthesize.
    const sig = toolName + ':' + JSON.stringify(call.args || {});
    if (seen.has(sig) || seen.has(toolName) && (toolName === 'abuz8_device_probe' || toolName === 'web_search')) break;
    seen.add(sig); seen.add(toolName);
    pushActivity('step', `Step ${i + 1}: ${toolName}`, JSON.stringify(call.args || {}).slice(0, 80));
    try {
      const result = await callLocalTool(toolName, call.args || {});
      obs.push(`[${toolName} ${JSON.stringify(call.args || {})}]\n${summarizeToolResult(toolName, result).slice(0, 800)}`);
      used.push(toolName);
    } catch (e) { obs.push(`[${toolName}] ERROR: ${e.message}`); }
  }
  // Final — reason over everything and synthesize the real answer.
  pushActivity('step', 'Reasoning & synthesizing', '');
  const context = obs.join('\n\n');
  const taskPrompt = [
    `The user asked you: "${goal}"`,
    context ? `Everything you gathered:\n${context}` : 'No external lookup was needed.',
    `Now DO the task. Do NOT just list what you found — fulfill the request: reason it through, make the comparison or analysis they asked for, and give concrete, honest conclusions and clear next steps. Answer as ABUZ8 in your own voice.`
  ].join('\n\n');
  const r = await reasonReply(taskPrompt, { role: opts.role, provider: opts.provider, system: opts.system });
  let answer = r.text;
  // Phase 4 — self-reflection: critique the draft against the goal and tighten it.
  let reflected = false;
  if (opts.reflect !== false && answer && answer.length > 40) {
    pushActivity('step', 'Reviewing & refining the answer', '');
    const improved = await reflectAndImprove(goal, answer, context);
    if (improved && improved.trim().length > 30) { answer = improved.trim(); reflected = true; }
  }
  pushActivity('done', 'Task complete', `used: ${used.join(', ') || 'reasoning only'}${reflected ? ' · self-reviewed' : ''}`);
  // LEARN — record this turn's experience as fuel for the self-learning loop.
  recordSignal({ kind: 'task', user: String(goal).slice(0, 200), ok: true, steps: obs.length, used_tools: used.map((u) => ({ tool: u })), reflected });
  return { response: answer, modelResponse: answer, brain: r.brain, tool_call: { tool: 'agent_task', used, reflected }, tool_result: { used, steps: obs.length, reflected }, fallback: r.fallback };
}

// Self-reflection: the agent critiques its own draft and returns an improved final.
async function reflectAndImprove(goal, draft, context) {
  const prompt = [
    `GOAL: "${goal}"`,
    `A weak first draft:\n${draft}`,
    `This draft is too vague and may miss parts of the goal. Write a BETTER, final answer that fully and specifically achieves the goal: be concrete, add the specific details/examples/numbers the goal asks for, cut all filler, and stay honest. Directly address every part of the goal. Output ONLY the final answer (no preamble, no "here is"), as ABUZ8 in your own voice.`
  ].join('\n\n');
  try {
    const r = await reasonReply(prompt, { noMemory: true });
    return (r.text || '').replace(/^(here('|i)?s?|sure|okay|certainly)[^\n:]*:?\s*/i, '').trim();
  } catch { return draft; }
}

// Build a class's full identity prompt (used by the orchestrator + active-class chat).
function classSystem(cls) {
  const s = dataRoot ? loadSoul() : { directives: DEFAULT_DIRECTIVES, personality: DEFAULT_SOUL };
  return [
    `Your name is ${cls.soul.name}. You are the ${cls.class}-Class of the ABUZ8 lineage — a specialist in ${cls.specialty}.`,
    s.personality,
    `Voice & manner:\n${cls.soul.voice}`,
    `Mission:\n${cls.soul.mission}`,
    `Directives:\n${s.directives}`
  ].filter(Boolean).join('\n\n');
}

// ── THE ORCHESTRATOR ── the enterprise layer: take one objective, decompose it
// into a mission, assign each step to the best specialist CLASS, run them as a
// fleet, then synthesize a mission report. This is the company-runner.
async function orchestrate(objective, opts = {}) {
  const goal = String(objective || '').trim();
  if (!goal) throw new Error('objective is required');
  pushActivity('plan', 'Orchestrator: planning the mission', goal.slice(0, 100));
  // 1. Decompose into steps, each assigned to a specialist class.
  const classMenu = AGENT_CLASSES.map((c) => `${c.id} (${c.class}-Class: ${c.specialty})`).join('; ');
  const planPrompt = `Objective: "${goal}"\n\nBreak this into 2-4 concrete steps. Assign each step to the single best specialist from: ${classMenu}. Reply with ONLY one JSON object: {"steps":[{"title":"...","class":"<class-id>","task":"<what that specialist should do>"}]}`;
  let steps = [];
  try {
    const r = await reasonReply(planPrompt, { system: 'You are a project orchestrator. Output ONLY one JSON object.', noMemory: true });
    const obj = extractJsonObject(r.text) || {};
    if (Array.isArray(obj.steps)) steps = obj.steps;
  } catch {}
  if (!steps.length) steps = [{ title: goal, class: 'abuz8-s', task: goal }];
  steps = steps.slice(0, Math.min(Number(opts.max_steps || 4), 5));
  // 2. Run each step with its specialist class.
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const cls = resolveClass(st.class) || resolveClass('abuz8-s');
    pushActivity('step', `Step ${i + 1} → ${cls.class}-Class (${cls.soul.name})`, st.title || st.task);
    let output = '';
    try {
      const r = await runTask(st.task || st.title || goal, { system: classSystem(cls), reflect: false, max_steps: 2 });
      output = r.response;
    } catch (e) { output = `(step failed: ${e.message})`; }
    results.push({ step: st.title || st.task, class: cls.class, agent: cls.soul.name, output });
  }
  // 3. Synthesize the mission report.
  pushActivity('step', 'Synthesizing the mission report', '');
  const merged = results.map((r, i) => `### Step ${i + 1}: ${r.step} — ${r.agent} (${r.class}-Class)\n${r.output}`).join('\n\n');
  const synth = await reasonReply(`Objective: "${goal}"\n\nYour specialist agents delivered:\n${merged}\n\nWrite the final mission report as the lead orchestrator: what was accomplished, the key findings, and concrete recommended next actions. Be specific and honest.`, { noMemory: true });
  pushActivity('done', 'Mission complete', `${results.length} specialist agents`);
  recordSignal({ kind: 'orchestration', user: goal.slice(0, 200), ok: true, used_tools: results.map((r) => ({ tool: 'class:' + r.class })) });
  return { ok: true, objective: goal, agents: results.length, steps: results, report: synth.text };
}

// ── DURABLE MISSION GRAPH ── resumable multi-step missions persisted to disk,
// with human approval gates before risky steps. (Al-Buraq pattern, JSON-backed
// so it ships anywhere — no native sqlite dependency.)
function missionGraphDir() { return safeMkdir(path.join(dataRoot, 'mission', 'graph')); }
function missionGraphFile(id) { return path.join(missionGraphDir(), id + '.json'); }
function createMissionGraph(title, steps) {
  const id = 'm' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const now = new Date().toISOString();
  const nodes = (steps || []).map((s, i) => ({
    id: 'n' + i, seq: i, kind: s.kind || 'task', title: s.title || ('Step ' + (i + 1)),
    status: 'pending', needs_approval: Boolean(s.needs_approval), payload: s.payload || s, result: null
  }));
  const m = { id, title: title || 'Mission', status: 'active', created: now, updated: now, nodes };
  writeJson(missionGraphFile(id), m);
  pushActivity('mission', 'Mission created: ' + m.title, nodes.length + ' steps');
  return m;
}
function getMissionGraph(id) { return readJson(missionGraphFile(id), null); }
function listMissionGraphs() {
  if (!exists(missionGraphDir())) return [];
  return fs.readdirSync(missionGraphDir()).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(missionGraphDir(), f), null)).filter(Boolean).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
async function executeMissionNode(node) {
  const p = node.payload || {};
  try {
    if (node.kind === 'orchestrate' || p.objective) { const r = await orchestrate(p.objective || node.title); return { ok: true, summary: String(r.report || '').slice(0, 1000) }; }
    if (node.kind === 'tool' && p.tool) { const r = await callLocalTool(p.tool, p.args || {}); return { ok: r.ok !== false, summary: summarizeToolResult(p.tool, r).slice(0, 800) }; }
    if (node.kind === 'manual' || node.kind === 'note') { return { ok: true, summary: '(manual checkpoint — marked done)' }; }
    const r = await runTask(p.goal || p.task || node.title, { reflect: false, max_steps: 2 });
    return { ok: true, summary: String(r.response || '').slice(0, 1000) };
  } catch (e) { return { ok: false, summary: 'ERROR: ' + e.message }; }
}
async function advanceMissionGraph(id) {
  const m = getMissionGraph(id); if (!m) return { error: 'mission not found' };
  const next = m.nodes.find((n) => n.status === 'pending');
  if (!next) { m.status = 'complete'; m.updated = new Date().toISOString(); writeJson(missionGraphFile(id), m); pushActivity('done', 'Mission complete: ' + m.title, ''); return { done: true, mission: m }; }
  if (next.needs_approval) { next.status = 'awaiting_approval'; m.status = 'paused'; m.updated = new Date().toISOString(); writeJson(missionGraphFile(id), m); pushActivity('mission', 'Mission paused for approval: ' + next.title, ''); return { paused: true, node: next, mission: m }; }
  next.status = 'running'; writeJson(missionGraphFile(id), m); pushActivity('step', 'Mission step: ' + next.title, '');
  const res = await executeMissionNode(next);
  next.status = res.ok ? 'done' : 'failed'; next.result = res.summary; m.updated = new Date().toISOString(); writeJson(missionGraphFile(id), m);
  return { done: false, node: next, mission: m };
}
function approveMissionNode(id, nodeId) {
  const m = getMissionGraph(id); if (!m) return { error: 'mission not found' };
  const n = m.nodes.find((x) => x.id === nodeId || x.status === 'awaiting_approval');
  if (n) { n.status = 'pending'; n.needs_approval = false; m.status = 'active'; m.updated = new Date().toISOString(); writeJson(missionGraphFile(id), m); }
  return { approved: n ? n.id : null, mission: m };
}
async function runMissionToCompletion(id, maxSteps = 10) {
  for (let i = 0; i < maxSteps; i++) {
    const r = await advanceMissionGraph(id);
    if (r.done || r.paused || r.error) return r;
  }
  return { mission: getMissionGraph(id), note: 'reached step cap' };
}

// ── AUTONOMY ── schedules that run tasks / missions / orchestrations on their
// own (interval or daily). A 60s tick fires due schedules. This is what makes
// ABUZ8 run the company while you're away (the app must be running).
function schedulesFile() { return path.join(safeMkdir(path.join(dataRoot, 'autonomy')), 'schedules.json'); }
function readSchedules() { return readJson(schedulesFile(), { schedules: [] }).schedules || []; }
function writeSchedules(arr) { writeJson(schedulesFile(), { schedules: arr, updated: new Date().toISOString() }); }
function createSchedule(s = {}) {
  const arr = readSchedules();
  const item = {
    id: 's' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    name: s.name || 'Scheduled task',
    every_min: Number(s.every_min) || 0,
    at_hour: (s.at_hour != null && s.at_hour !== '') ? Number(s.at_hour) : null,
    action: s.action || { kind: 'task', payload: { goal: s.name || '' } },
    enabled: s.enabled !== false, last_run: null, created: new Date().toISOString()
  };
  arr.push(item); writeSchedules(arr); return item;
}
async function fireSchedule(item) {
  pushActivity('plan', `Autonomy: running "${item.name}"`, '');
  const a = item.action || {};
  try {
    if (a.kind === 'mission' && a.mission_id) await runMissionToCompletion(a.mission_id);
    else if (a.kind === 'orchestrate') await orchestrate((a.payload && a.payload.objective) || item.name);
    else if (a.kind === 'tool' && a.payload && a.payload.tool) await callLocalTool(a.payload.tool, a.payload.args || {});
    else if (a.kind === 'social') { const p = a.payload || {}; await socialPost(p.platforms || [], { text: p.text, link: p.link }); }
    else if (a.kind === 'content_loop') {
      // The faceless-content marketing loop: draft fresh copy on the topic, then broadcast it.
      const p = a.payload || {}; const draft = await socialDraft(p.topic || item.name, (p.platforms && p.platforms[0]) || 'x');
      await socialPost(p.platforms || [], { text: draft.text, link: p.link });
    }
    else await runTask((a.payload && (a.payload.goal || a.payload.task)) || item.name, { reflect: false, max_steps: 2 });
    pushActivity('done', `Autonomy done: "${item.name}"`, '');
  } catch (e) { pushActivity('observe', `Autonomy error: ${item.name}`, e.message); }
  const arr = readSchedules(); const it = arr.find((x) => x.id === item.id);
  if (it) { it.last_run = new Date().toISOString(); writeSchedules(arr); }
  recordSignal({ kind: 'autonomy', user: item.name, ok: true });
}
let _schedulerBusy = false;
async function schedulerTick() {
  if (_schedulerBusy || !dataRoot) return;
  _schedulerBusy = true;
  try {
    const now = Date.now(); const hour = new Date().getHours();
    for (const s of readSchedules()) {
      if (!s.enabled) continue;
      let due = false;
      if (s.every_min > 0) { const last = s.last_run ? new Date(s.last_run).getTime() : 0; if (now - last >= s.every_min * 60000) due = true; }
      if (s.at_hour != null) { const last = s.last_run ? new Date(s.last_run) : null; if (hour === s.at_hour && (!last || last.toDateString() !== new Date().toDateString())) due = true; }
      if (due) { await fireSchedule(s); }
    }
  } catch {} finally { _schedulerBusy = false; }
}

/* ── VISION & SPATIAL AWARENESS ──────────────────────────────────────────
   The renderer runs MediaPipe (gesture + face/eye) fully offline in the
   webcam page and POSTs a distilled signal here. The core keeps the live
   presence state so voice/autonomy can be presence-aware, and logs gestures
   to the activity feed. Default gesture→action map is overridable in settings. */
let _presence = { present: false, attentive: false, distance: 'unknown', gaze: 'center', head: 'center', gesture: 'none', updated: null, source: null };
let _lastGestureAt = 0, _lastGestureName = '';
const DEFAULT_GESTURE_MAP = {
  Open_Palm:   { action: 'wake',       label: 'Open palm → wake & listen' },
  Closed_Fist: { action: 'stop',       label: 'Fist → stop / cancel' },
  Thumb_Up:    { action: 'confirm',    label: 'Thumbs up → confirm / yes' },
  Thumb_Down:  { action: 'dismiss',    label: 'Thumbs down → dismiss / no' },
  Pointing_Up: { action: 'next',       label: 'Point up → next / continue' },
  Victory:     { action: 'screenshot', label: 'Victory ✌ → screenshot' },
  ILoveYou:    { action: 'home',       label: 'ILoveYou → go home' }
};
function gestureMap() {
  try { const s = readJson(settingsPath(), {}); return Object.assign({}, DEFAULT_GESTURE_MAP, s.gesture_map || {}); } catch { return DEFAULT_GESTURE_MAP; }
}
function getPresence() { return _presence; }
function isUserPresent() { return _presence.present === true && _presence.updated && (Date.now() - new Date(_presence.updated).getTime() < 8000); }
function isUserAttentive() { return isUserPresent() && _presence.attentive === true; }
function updatePresence(p) {
  const prev = _presence;
  _presence = Object.assign({}, _presence, p, { updated: new Date().toISOString() });
  // Edge-log presence transitions (arrived / stepped away) for the activity feed.
  if (p.present === true && prev.present !== true) pushActivity('observe', 'User present', _presence.distance !== 'unknown' ? ('distance: ' + _presence.distance) : '');
  if (p.present === false && prev.present === true) pushActivity('observe', 'User stepped away', '');
  // Gesture edge: only log/dispatch when the gesture name changes and is real.
  if (p.gesture && p.gesture !== 'none' && p.gesture !== _lastGestureName) {
    _lastGestureName = p.gesture; _lastGestureAt = Date.now();
    const m = gestureMap()[p.gesture];
    if (m) { pushActivity('tool', 'Gesture: ' + p.gesture, m.label); try { recordSignal({ kind: 'gesture', gesture: p.gesture, action: m.action }); } catch {} }
    return { matched: m || null };
  }
  if (!p.gesture || p.gesture === 'none') _lastGestureName = '';
  return { matched: null };
}

/* ── REAL CONNECTORS ─────────────────────────────────────────────────────
   Local-only credential store + genuine API calls. Secrets live in
   config/connectors.json (gitignored, never leaves the machine). Each
   connector either works for real with the user's key, or honestly reports
   what credential it still needs — nothing is faked. */
function connectorsPath() { return path.join(safeMkdir(path.join(dataRoot, 'config')), 'connectors.json'); }
function readConnectors() { return readJson(connectorsPath(), {}); }
function writeConnectors(o) { writeJson(connectorsPath(), o); }
const CONNECTOR_DEFS = {
  stripe:     { label: 'Stripe',            kind: 'api',   fields: ['secret_key'], note: 'Live/test secret key (sk_…). Real balance, customers, charges.' },
  cloudflare: { label: 'Cloudflare',        kind: 'api',   fields: ['api_token'],  note: 'API token (Zone/DNS scopes). Lists zones, DNS records.' },
  gmail:      { label: 'Gmail',             kind: 'oauth', fields: ['oauth_token'],note: 'Google OAuth access token with gmail.send/readonly scope. Sends + lists mail for real once pasted.' },
  gcal:       { label: 'Google Calendar',   kind: 'oauth', fields: ['oauth_token'],note: 'Google OAuth access token with calendar scope. Reads/creates events.' },
  openrouter: { label: 'OpenRouter (cloud brain)', kind: 'api', fields: ['api_key'], note: 'Optional stronger cloud reasoning brain.' },
  serper:     { label: 'Serper (web search)', kind: 'api', fields: ['api_key'],    note: 'Higher-quality web search.' },
  tripo:      { label: 'Tripo (image → 3D mesh)', kind: 'api', fields: ['api_key'], note: 'Turns a photo into a real editable 3D mesh for the Forge. Key from platform.tripo3d.ai.' },
  image_gen:  { label: 'Image generation', kind: 'api', fields: ['api_key'], note: 'For reliable Studio images: a FREE Hugging Face token (hf_…, from huggingface.co/settings/tokens) runs FLUX, OR an OpenAI images key. Without one, free image servers are rate-limited.' }
};
function connectorList() {
  const cfg = readConnectors();
  return Object.entries(CONNECTOR_DEFS).map(([id, d]) => ({ id, label: d.label, kind: d.kind, note: d.note, fields: d.fields, configured: !!(cfg[id] && d.fields.every((f) => cfg[id][f])) }));
}
function connectorCreds(id) { return readConnectors()[id] || {}; }
async function connectorTest(id) {
  const c = connectorCreds(id);
  try {
    if (id === 'stripe') {
      if (!c.secret_key) return { ok: false, error: 'No secret_key set.' };
      const r = JSON.parse(await fetchUrl('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + c.secret_key } }));
      if (r.error) return { ok: false, error: r.error.message };
      const avail = (r.available || []).map((a) => `${(a.amount / 100).toFixed(2)} ${(a.currency || '').toUpperCase()}`).join(', ');
      return { ok: true, detail: 'Connected. Available balance: ' + (avail || '0') };
    }
    if (id === 'cloudflare') {
      if (!c.api_token) return { ok: false, error: 'No api_token set.' };
      const v = JSON.parse(await fetchUrl('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: 'Bearer ' + c.api_token } }));
      if (!v.success) return { ok: false, error: (v.errors && v.errors[0] && v.errors[0].message) || 'token invalid' };
      const z = JSON.parse(await fetchUrl('https://api.cloudflare.com/client/v4/zones?per_page=5', { headers: { Authorization: 'Bearer ' + c.api_token } }));
      return { ok: true, detail: `Token valid. ${(z.result || []).length} zone(s) visible.` };
    }
    if (id === 'gmail') {
      const tok = await googleToken();
      if (!tok) return { ok: false, error: 'Not connected. Use Google OAuth (hands-free) or paste a token.' };
      const r = JSON.parse(await fetchUrl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + tok } }));
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true, detail: 'Connected as ' + r.emailAddress + (readOauth().tokens.google ? ' (OAuth · auto-refresh)' : '') };
    }
    if (id === 'gcal') {
      const tok = await googleToken();
      if (!tok) return { ok: false, error: 'Not connected. Use Google OAuth (hands-free) or paste a token.' };
      const r = JSON.parse(await fetchUrl('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { headers: { Authorization: 'Bearer ' + tok } }));
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true, detail: 'Calendar connected' + (readOauth().tokens.google ? ' (OAuth · auto-refresh)' : '') };
    }
    if (id === 'openrouter') {
      if (!c.api_key) return { ok: false, error: 'No api_key set.' };
      const r = JSON.parse(await fetchUrl('https://openrouter.ai/api/v1/key', { headers: { Authorization: 'Bearer ' + c.api_key } }));
      if (r.error) return { ok: false, error: r.error.message || 'invalid' };
      return { ok: true, detail: 'Key valid.' };
    }
    if (id === 'serper') {
      if (!c.api_key) return { ok: false, error: 'No api_key set.' };
      return { ok: true, detail: 'Key stored (validated on first search).' };
    }
    return { ok: false, error: 'Unknown connector.' };
  } catch (e) { return { ok: false, error: e.message }; }
}
function b64url(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function connectorCall(id, action, args = {}) {
  const c = connectorCreds(id);
  if (id === 'stripe') {
    const h = { Authorization: 'Bearer ' + c.secret_key };
    if (action === 'balance') return JSON.parse(await fetchUrl('https://api.stripe.com/v1/balance', { headers: h }));
    if (action === 'customers') return JSON.parse(await fetchUrl('https://api.stripe.com/v1/customers?limit=' + (args.limit || 10), { headers: h }));
    if (action === 'charges') return JSON.parse(await fetchUrl('https://api.stripe.com/v1/charges?limit=' + (args.limit || 10), { headers: h }));
  }
  if (id === 'cloudflare') {
    const h = { Authorization: 'Bearer ' + c.api_token };
    if (action === 'zones') return JSON.parse(await fetchUrl('https://api.cloudflare.com/client/v4/zones?per_page=' + (args.limit || 20), { headers: h }));
    if (action === 'dns' && args.zone_id) return JSON.parse(await fetchUrl(`https://api.cloudflare.com/client/v4/zones/${args.zone_id}/dns_records?per_page=50`, { headers: h }));
  }
  if (id === 'gmail') {
    const h = { Authorization: 'Bearer ' + (await googleToken()) };
    if (action === 'list') return JSON.parse(await fetchUrl('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + (args.limit || 10) + (args.q ? '&q=' + encodeURIComponent(args.q) : ''), { headers: h }));
    if (action === 'send') {
      const raw = `To: ${args.to}\r\nSubject: ${args.subject || ''}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${args.body || ''}`;
      return JSON.parse(await fetchUrl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(raw) }) }));
    }
  }
  if (id === 'gcal') {
    const h = { Authorization: 'Bearer ' + (await googleToken()) };
    if (action === 'events') return JSON.parse(await fetchUrl('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=' + (args.limit || 10) + '&orderBy=startTime&singleEvents=true&timeMin=' + new Date().toISOString(), { headers: h }));
    if (action === 'create') return JSON.parse(await fetchUrl('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: args.summary, description: args.description, start: { dateTime: args.start }, end: { dateTime: args.end || args.start } }) }));
  }
  throw new Error(`No action '${action}' for connector '${id}'.`);
}

/* ── PERSISTENT OAUTH (refresh-token, hands-free) ────────────────────────
   Real OAuth 2.0 + PKCE with a loopback redirect on this very server
   (http://127.0.0.1:PORT/oauth/callback). The user authorizes once in the
   browser; we store the refresh token and silently renew access tokens
   forever after — so Gmail/Calendar/YouTube/Instagram/TikTok stay live with
   NO 1-hour re-paste. Setup needs the user's own OAuth client id/secret
   (one time, from the provider console) — we never ship or fake credentials. */
const OAUTH_PROVIDERS = {
  google: {
    label: 'Google (Gmail · Calendar · YouTube)',
    auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_url: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/youtube.upload', 'openid', 'email', 'profile'],
    extra: { access_type: 'offline', prompt: 'consent' }, pkce: true
  },
  meta: {
    label: 'Meta (Instagram · Facebook)',
    auth_url: 'https://www.facebook.com/v21.0/dialog/oauth',
    token_url: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_manage_posts', 'pages_read_engagement', 'business_management'],
    extra: {}, pkce: false, long_lived: true
  },
  tiktok: {
    label: 'TikTok',
    auth_url: 'https://www.tiktok.com/v2/auth/authorize/',
    token_url: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    extra: {}, pkce: true, client_key_param: 'client_key'
  }
};
function oauthPath() { return path.join(safeMkdir(path.join(dataRoot, 'config')), 'oauth.json'); }
function readOauth() { return readJson(oauthPath(), { clients: {}, tokens: {}, pending: {} }); }
function writeOauth(o) { writeJson(oauthPath(), o); }
function oauthRedirectUri() { return `http://127.0.0.1:${PORT}/oauth/callback`; }
function oauthSetupClient(provider, client_id, client_secret) {
  const o = readOauth(); o.clients[provider] = { client_id, client_secret: client_secret || '' }; writeOauth(o); return { ok: true };
}
function oauthStart(provider) {
  const def = OAUTH_PROVIDERS[provider]; if (!def) throw new Error('unknown provider');
  const o = readOauth(); const client = o.clients[provider];
  if (!client || !client.client_id) throw new Error(`Set up your ${def.label} OAuth client id/secret first (one-time, from the provider console).`);
  const state = crypto.randomBytes(12).toString('hex');
  const verifier = b64url(crypto.randomBytes(32));
  const params = new URLSearchParams();
  params.set(def.client_key_param || 'client_id', client.client_id);
  params.set('redirect_uri', oauthRedirectUri());
  params.set('response_type', 'code');
  params.set('scope', def.scopes.join(' '));
  params.set('state', state);
  for (const [k, v] of Object.entries(def.extra || {})) params.set(k, v);
  if (def.pkce) { params.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest())); params.set('code_challenge_method', 'S256'); }
  o.pending[state] = { provider, verifier, created: Date.now() }; writeOauth(o);
  return { url: def.auth_url + '?' + params.toString(), state };
}
async function oauthExchange(code, state) {
  const o = readOauth(); const pend = o.pending[state]; if (!pend) throw new Error('Unknown/expired OAuth state.');
  const def = OAUTH_PROVIDERS[pend.provider]; const client = o.clients[pend.provider];
  const form = new URLSearchParams();
  form.set(def.client_key_param || 'client_id', client.client_id);
  if (client.client_secret) form.set(def.client_key_param ? 'client_secret' : 'client_secret', client.client_secret);
  form.set('code', code); form.set('grant_type', 'authorization_code'); form.set('redirect_uri', oauthRedirectUri());
  if (def.pkce) form.set('code_verifier', pend.verifier);
  const resp = await fetchUrl(def.token_url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), timeout: 15000 });
  let data; try { data = JSON.parse(resp); } catch { data = Object.fromEntries(new URLSearchParams(resp)); }
  if (data.error) throw new Error(data.error_description || data.error);
  const tok = data.access_token || (data.data && data.data.access_token);
  const refresh = data.refresh_token || (data.data && data.data.refresh_token) || '';
  const expires = Number(data.expires_in || (data.data && data.data.expires_in) || 3600);
  o.tokens[pend.provider] = { access_token: tok, refresh_token: refresh, expires_at: Date.now() + expires * 1000, scope: data.scope || def.scopes.join(' '), obtained: new Date().toISOString() };
  delete o.pending[state]; writeOauth(o);
  pushActivity('connect', 'OAuth connected: ' + def.label, 'hands-free (auto-refresh)');
  return { ok: true, provider: pend.provider };
}
async function getValidToken(provider) {
  const o = readOauth(); const t = o.tokens[provider]; if (!t || !t.access_token) return '';
  if (t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token; // still fresh
  if (!t.refresh_token) return t.access_token; // no refresh (e.g. Meta long-lived) — return as-is
  const def = OAUTH_PROVIDERS[provider]; const client = o.clients[provider];
  try {
    const form = new URLSearchParams();
    form.set(def.client_key_param || 'client_id', client.client_id);
    if (client.client_secret) form.set('client_secret', client.client_secret);
    form.set('refresh_token', t.refresh_token); form.set('grant_type', 'refresh_token');
    const resp = await fetchUrl(def.token_url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), timeout: 15000 });
    const data = JSON.parse(resp);
    if (data.access_token) { t.access_token = data.access_token; t.expires_at = Date.now() + Number(data.expires_in || 3600) * 1000; if (data.refresh_token) t.refresh_token = data.refresh_token; o.tokens[provider] = t; writeOauth(o); }
  } catch {}
  return t.access_token;
}
function oauthStatus() {
  const o = readOauth();
  return Object.entries(OAUTH_PROVIDERS).map(([id, def]) => {
    const t = o.tokens[id];
    return { id, label: def.label, client_ready: !!(o.clients[id] && o.clients[id].client_id), connected: !!(t && t.access_token), expires_at: t ? t.expires_at : null, auto_refresh: !!(t && t.refresh_token) };
  });
}
function oauthDisconnect(provider) { const o = readOauth(); delete o.tokens[provider]; writeOauth(o); return { ok: true }; }
// Prefer the hands-free OAuth token; fall back to a manually pasted one.
async function googleToken() { const t = await getValidToken('google'); return t || connectorCreds('gmail').oauth_token || connectorCreds('gcal').oauth_token || ''; }

/* ── FLEET MESH (OpenClaw-style control-node + workers) ───────────────────
   Any ABUZ8 instance already exposes /health + /api/chat and honors the LAN
   key, so it is a worker out of the box. The control node holds the roster,
   pings workers for real, and dispatches tasks over HTTP, collecting results. */
function meshPath() { return path.join(safeMkdir(path.join(dataRoot, 'config')), 'mesh.json'); }
function readMesh() { return readJson(meshPath(), { nodes: [] }); }
function writeMesh(m) { writeJson(meshPath(), m); }
function meshAdd(node) {
  const m = readMesh();
  const item = { id: 'w' + Date.now().toString(36), name: node.name || node.url, url: String(node.url || '').replace(/\/$/, ''), token: node.token || '', kind: node.kind || 'abuz8', added: new Date().toISOString(), last_seen: null, status: 'unknown' };
  m.nodes.push(item); writeMesh(m); pushActivity('mesh', 'Worker added: ' + item.name, item.url); return item;
}
function meshRemove(id) { const m = readMesh(); m.nodes = m.nodes.filter((n) => n.id !== id); writeMesh(m); return { ok: true }; }
async function meshPing(node) {
  const headers = node.token ? { 'x-abuz8-key': node.token } : {};
  const t0 = Date.now();
  try {
    const r = JSON.parse(await fetchUrl(node.url + '/health', { headers }));
    return { ok: true, latency_ms: Date.now() - t0, service: r.service, port: r.port };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function meshDispatch(id, task) {
  const m = readMesh(); const node = m.nodes.find((n) => n.id === id);
  if (!node) throw new Error('worker not found');
  const headers = { 'Content-Type': 'application/json', ...(node.token ? { 'x-abuz8-key': node.token } : {}) };
  pushActivity('mesh', 'Dispatch → ' + node.name, String(task).slice(0, 80));
  const out = await fetchUrl(node.url + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ content: task, agentic: true }), timeout: 180000 });
  let j; try { j = JSON.parse(out); } catch { j = { response: out }; }
  node.last_seen = new Date().toISOString(); node.status = 'online'; writeMesh(m);
  return { node: node.name, response: j.response || j.error || out, brain: j.brain };
}

/* ── LOCAL SECURE ACCOUNT (sign-in) ──────────────────────────────────────
   scrypt-hashed local credentials; sessions are in-memory tokens. Optional —
   when enabled it gates secret writes; it never phones home. */
function accountPath() { return path.join(safeMkdir(path.join(dataRoot, 'config')), 'account.json'); }
function accountStatus() { const a = readJson(accountPath(), null); return { enabled: !!a, username: a ? a.username : null }; }
const _sessions = new Set();
function accountSetup(username, password) {
  if (!username || !password || password.length < 6) throw new Error('Username and a password of 6+ chars required.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  writeJson(accountPath(), { username, salt, hash, created: new Date().toISOString() });
  return { ok: true };
}
function accountLogin(username, password) {
  const a = readJson(accountPath(), null);
  if (!a) throw new Error('No account set up.');
  const hash = crypto.scryptSync(password || '', a.salt, 64).toString('hex');
  if (username !== a.username || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(a.hash))) throw new Error('Invalid credentials.');
  const token = crypto.randomBytes(24).toString('hex'); _sessions.add(token);
  return { ok: true, token };
}

/* ── PROVIDER CATALOG — "Noah's Ark of AI" ───────────────────────────────
   A pre-shipped registry of 35+ model providers (like Antigravity / Continue
   / LiteLLM): the user logs in or pastes one key and the model is live. Most
   speak the OpenAI-compatible /chat/completions API; Anthropic uses its own
   /v1/messages (adapter below); Claude Pro/Max rides the Claude Desktop MCP
   bridge. Local engines need no key at all. Honest 'how' note on each.
   cat: 'monthly' (subscription/credits brands) | 'api' (developer key) |
        'local' (on-device, free) | 'bridge' (via the vendor's own app). */
const PROVIDER_CATALOG = [
  // ── Hero / subscription-flavored ──
  { id: 'openrouter', label: 'OpenRouter', cat: 'monthly', type: 'openai', base: 'https://openrouter.ai/api/v1', models: ['openai/gpt-4o', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.0-flash-exp', 'x-ai/grok-2', 'deepseek/deepseek-chat', 'moonshotai/kimi-k2'], note: 'One key = 100+ models (GPT, Claude, Gemini, Grok, Kimi, DeepSeek…). Pay-as-you-go credits. The fastest "log in once, use everything" path.', signup: 'https://openrouter.ai/keys' },
  { id: 'openai', label: 'OpenAI (ChatGPT)', cat: 'monthly', type: 'openai', base: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'], note: 'Developer API key. Note: a ChatGPT Plus subscription is NOT API access — the API bills separately per token.', signup: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude) — API', cat: 'monthly', type: 'anthropic', base: 'https://api.anthropic.com', models: ['claude-opus-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'], note: 'Direct Claude API key (x-api-key). For your Claude Pro/Max *subscription*, use the Claude Desktop bridge instead (cat: bridge).', signup: 'https://console.anthropic.com/settings/keys' },
  { id: 'google-gemini', label: 'Google Gemini', cat: 'monthly', type: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'], note: 'Google AI Studio key (OpenAI-compatible endpoint). Full OAuth for Gemini+Gmail+Calendar via the Connect view.', signup: 'https://aistudio.google.com/apikey' },
  { id: 'xai-grok', label: 'xAI (Grok)', cat: 'monthly', type: 'openai', base: 'https://api.x.ai/v1', models: ['grok-2-latest', 'grok-2-vision-latest', 'grok-beta'], note: 'xAI API key. X Premium ≠ API; the API is a separate paid tier.', signup: 'https://console.x.ai' },
  { id: 'deepseek', label: 'DeepSeek', cat: 'monthly', type: 'openai', base: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], note: 'Very cheap, strong reasoning (R1). OpenAI-compatible.', signup: 'https://platform.deepseek.com/api_keys' },
  { id: 'moonshot-kimi', label: 'Moonshot (Kimi)', cat: 'monthly', type: 'openai', base: 'https://api.moonshot.ai/v1', models: ['kimi-k2-0711-preview', 'moonshot-v1-128k'], note: 'Kimi K2 — huge context. OpenAI-compatible.', signup: 'https://platform.moonshot.ai' },
  { id: 'zhipu-glm', label: 'Zhipu (GLM)', cat: 'monthly', type: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-flash', 'glm-4v-plus'], note: 'GLM-4 family. OpenAI-compatible v4 endpoint.', signup: 'https://open.bigmodel.cn' },
  { id: 'minimax', label: 'MiniMax', cat: 'monthly', type: 'openai', base: 'https://api.minimax.chat/v1', models: ['abab6.5s-chat', 'MiniMax-Text-01'], note: 'MiniMax text/voice models. OpenAI-compatible.', signup: 'https://www.minimax.io' },
  { id: 'perplexity', label: 'Perplexity', cat: 'monthly', type: 'openai', base: 'https://api.perplexity.ai', models: ['sonar', 'sonar-pro', 'sonar-reasoning'], note: 'Sonar online models (built-in web search). API key from a Perplexity subscription.', signup: 'https://www.perplexity.ai/settings/api' },
  { id: 'mistral', label: 'Mistral (Le Chat)', cat: 'monthly', type: 'openai', base: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'], note: 'Mistral / Codestral. OpenAI-compatible.', signup: 'https://console.mistral.ai/api-keys' },
  // ── Developer / API-key (fast inference & clouds) ──
  { id: 'nvidia-nim', label: 'NVIDIA NIM', cat: 'api', type: 'openai', base: 'https://integrate.api.nvidia.com/v1', models: ['nvidia/llama-3.1-nemotron-70b-instruct', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'], note: 'NVIDIA-hosted NIM endpoints incl. Nemotron. Free tier on build.nvidia.com.', signup: 'https://build.nvidia.com' },
  { id: 'cerebras', label: 'Cerebras', cat: 'api', type: 'openai', base: 'https://api.cerebras.ai/v1', models: ['llama-3.3-70b', 'llama3.1-8b'], note: 'Fastest tokens/sec anywhere (wafer-scale). Generous free tier.', signup: 'https://cloud.cerebras.ai' },
  { id: 'groq', label: 'Groq', cat: 'api', type: 'openai', base: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'], note: 'Ultra-fast LPU inference. Free tier.', signup: 'https://console.groq.com/keys' },
  { id: 'together', label: 'Together AI', cat: 'api', type: 'openai', base: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'], note: '200+ open models, OpenAI-compatible.', signup: 'https://api.together.xyz/settings/api-keys' },
  { id: 'fireworks', label: 'Fireworks AI', cat: 'api', type: 'openai', base: 'https://api.fireworks.ai/inference/v1', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-r1'], note: 'Fast open-model inference.', signup: 'https://fireworks.ai/account/api-keys' },
  { id: 'deepinfra', label: 'DeepInfra', cat: 'api', type: 'openai', base: 'https://api.deepinfra.com/v1/openai', models: ['meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1'], note: 'Cheap open-model inference.', signup: 'https://deepinfra.com/dash/api_keys' },
  { id: 'inception-mercury', label: 'Inception (Mercury)', cat: 'api', type: 'openai', base: 'https://api.inceptionlabs.ai/v1', models: ['mercury-coder-small', 'mercury'], note: 'Mercury — diffusion LLMs, very fast. OpenAI-compatible.', signup: 'https://platform.inceptionlabs.ai' },
  { id: 'sambanova', label: 'SambaNova', cat: 'api', type: 'openai', base: 'https://api.sambanova.ai/v1', models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1'], note: 'Fast RDU inference. Free tier.', signup: 'https://cloud.sambanova.ai' },
  { id: 'hyperbolic', label: 'Hyperbolic', cat: 'api', type: 'openai', base: 'https://api.hyperbolic.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-V3'], note: 'Cheap GPU inference marketplace.', signup: 'https://app.hyperbolic.xyz' },
  { id: 'cohere', label: 'Cohere', cat: 'api', type: 'openai', base: 'https://api.cohere.ai/compatibility/v1', models: ['command-r-plus', 'command-r'], note: 'Command R family via OpenAI-compatibility endpoint.', signup: 'https://dashboard.cohere.com/api-keys' },
  { id: 'aws-bedrock', label: 'AWS Bedrock', cat: 'api', type: 'bedrock', base: 'https://bedrock-runtime.us-east-1.amazonaws.com', models: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'meta.llama3-3-70b-instruct-v1:0'], note: 'Needs AWS access key + region (SigV4). Adapter is on the roadmap — listed for completeness.', signup: 'https://console.aws.amazon.com/bedrock' },
  { id: 'azure-openai', label: 'Azure OpenAI', cat: 'api', type: 'openai', base: '', models: ['gpt-4o'], note: 'Paste your full Azure resource endpoint (…/openai/deployments/<name>) + key.', signup: 'https://portal.azure.com' },
  // ── Local engines (free, on-device, OpenAI-compatible) ──
  { id: 'llamacpp-native', label: 'ABUZ8 native (llama.cpp)', cat: 'local', type: 'openai', base: 'http://127.0.0.1:8902/v1', models: ['(loaded GGUF)'], note: 'The built-in engine — already running. Runs any GGUF natively, zero login, fully sovereign.' },
  { id: 'ollama', label: 'Ollama', cat: 'local', type: 'openai', base: 'http://127.0.0.1:11434/v1', models: ['llama3.2', 'qwen2.5'], note: 'Reuses your existing Ollama model library. Auto-detected on :11434.' },
  { id: 'lmstudio', label: 'LM Studio', cat: 'local', type: 'openai', base: 'http://127.0.0.1:1234/v1', models: ['(loaded model)'], note: 'Reuses your LM Studio models. Auto-detected on :1234.' },
  { id: 'vllm', label: 'vLLM', cat: 'local', type: 'openai', base: 'http://127.0.0.1:8000/v1', models: ['(served model)'], note: 'Best on big GPUs (Pegasus/DGX) — paged attention + batching. Auto-detected on :8000.' },
  { id: 'jan', label: 'Jan', cat: 'local', type: 'openai', base: 'http://127.0.0.1:1337/v1', models: ['(loaded model)'], note: 'Jan local server. Auto-detected on :1337.' },
  { id: 'textgen-webui', label: 'Text-Gen WebUI', cat: 'local', type: 'openai', base: 'http://127.0.0.1:5000/v1', models: ['(loaded model)'], note: 'oobabooga OpenAI extension on :5000.' },
  // ── App bridges (use your real subscription via the vendor's own app) ──
  { id: 'claude-desktop-bridge', label: 'Claude Pro/Max (via Claude Desktop)', cat: 'bridge', type: 'mcp-bridge', base: '', models: ['your Claude subscription'], note: 'The legit way to use your Claude Pro/Max subscription: ABUZ8 talks to the Claude Desktop app over the MCP bridge (Connect → Import Claude Desktop). No API charges.' }
];
function providersStore() { return readJson(providersPath(), { providers: [] }); }
function writeProviders(o) { writeJson(providersPath(), o); }
function providerCatalogList() {
  const store = providersStore();
  const active = (readJson(settingsPath(), {}).active_provider) || null;
  return PROVIDER_CATALOG.map((p) => {
    const saved = store.providers.find((x) => x.name === p.id);
    return { id: p.id, label: p.label, cat: p.cat, type: p.type, note: p.note, signup: p.signup, models: p.models, base: p.base, configured: !!(saved && (saved.api_key || p.cat === 'local' || p.cat === 'bridge')), model: saved ? saved.model : (p.models && p.models[0]), active: !!(active && active.name === p.id) };
  });
}
function catalogDef(id) { return PROVIDER_CATALOG.find((p) => p.id === id); }
function catalogConnect(id, opts = {}) {
  const def = catalogDef(id); if (!def) throw new Error('unknown provider');
  const base = (opts.endpoint || def.base || '').replace(/\/+$/, '');
  const store = providersStore();
  const entry = {
    name: id, label: def.label, type: def.type, endpoint: base,
    chat_url: base ? base + '/chat/completions' : '',
    models_url: base ? base + '/models' : '',
    model: opts.model || def.models[0], api_key: opts.api_key || '', enabled: true, cat: def.cat, updated_at: new Date().toISOString()
  };
  store.providers = store.providers.filter((x) => x.name !== id); store.providers.push(entry); writeProviders(store);
  pushActivity('connect', 'Provider connected: ' + def.label, entry.model || '');
  return entry;
}
function catalogDisconnect(id) { const s = providersStore(); s.providers = s.providers.filter((x) => x.name !== id); writeProviders(s); const set = readJson(settingsPath(), {}); if (set.active_provider && set.active_provider.name === id) { delete set.active_provider; writeJson(settingsPath(), set); } return { ok: true }; }
function setActiveProvider(id, model) {
  const set = readJson(settingsPath(), {});
  if (!id) { delete set.active_provider; writeJson(settingsPath(), set); pushActivity('connect', 'Brain → native engine', ''); return { ok: true, active: null }; }
  const def = catalogDef(id); if (!def) throw new Error('unknown provider');
  const store = providersStore(); const saved = store.providers.find((x) => x.name === id);
  if (saved && model) { saved.model = model; writeProviders(store); }
  set.active_provider = { name: id, model: model || (saved && saved.model) || def.models[0] }; writeJson(settingsPath(), set);
  pushActivity('connect', 'Active brain → ' + def.label, set.active_provider.model);
  return { ok: true, active: set.active_provider };
}
async function catalogTest(id) {
  const def = catalogDef(id); if (!def) return { ok: false, error: 'unknown' };
  if (def.cat === 'bridge') return { ok: true, detail: 'Uses the Claude Desktop MCP bridge — import it in Connect, then Claude answers with no API charge.' };
  if (def.type === 'bedrock') return { ok: false, error: 'AWS Bedrock needs SigV4 signing — adapter on the roadmap.' };
  const store = providersStore(); const p = store.providers.find((x) => x.name === id);
  if (!p) return { ok: false, error: 'not connected' };
  try {
    const out = await callProviderChat(p, 'Reply with the single word: ok', 'You are a connectivity probe. Reply with exactly one word.');
    return { ok: true, detail: 'Live · model ' + (p.model || '') + ' · replied "' + String(out).trim().slice(0, 24) + '"' };
  } catch (e) { return { ok: false, error: e.message.slice(0, 140) }; }
}
async function catalogModels(id) {
  const store = providersStore(); const p = store.providers.find((x) => x.name === id);
  if (!p || !p.models_url) return { ok: false, models: catalogDef(id) ? catalogDef(id).models : [] };
  try {
    const headers = p.api_key ? { Authorization: 'Bearer ' + p.api_key } : {};
    const data = JSON.parse(await fetchUrl(p.models_url, { headers, timeout: 12000 }));
    const models = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
    return { ok: true, models: models.length ? models : catalogDef(id).models };
  } catch (e) { return { ok: false, error: e.message, models: catalogDef(id).models }; }
}
async function detectLocalEngines() {
  const probes = [ ['ollama', 'http://127.0.0.1:11434/v1/models'], ['lmstudio', 'http://127.0.0.1:1234/v1/models'], ['vllm', 'http://127.0.0.1:8000/v1/models'], ['jan', 'http://127.0.0.1:1337/v1/models'], ['textgen-webui', 'http://127.0.0.1:5000/v1/models'] ];
  const out = {};
  await Promise.all(probes.map(async ([id, url]) => {
    try { const d = JSON.parse(await fetchUrl(url, { timeout: 1500 })); out[id] = { up: true, models: (d.data || []).map((m) => m.id).slice(0, 8) }; }
    catch { out[id] = { up: false }; }
  }));
  return out;
}

async function agenticReply(prompt, opts = {}) {
  // 0) AGENT-FIRST: a request that needs thinking/research/comparison goes through
  //    understand → gather → reason → synthesize (skipped for fast voice turns).
  if (!opts.brief && isComplexTask(prompt)) {
    try { return await runTask(prompt, opts); } catch {}
  }
  // 1) Fast deterministic intent (open browser/app/site, search, run command…).
  const direct = inferConsumerToolCall(prompt);
  if (direct) return executeAgentTool(direct, opts);

  // 2) Model-chosen tool: ask the brain to emit a tool call; execute if valid.
  try {
    const modelText = await embeddedReply(prompt, { agentic: true, role: opts.role, brief: opts.brief });
    const parsed = modelText ? parseAgentToolCall(modelText) : null;
    if (parsed && KNOWN_AGENT_TOOLS.has(slug(parsed.tool).replace(/-/g, '_'))) {
      const norm = { tool: slug(parsed.tool).replace(/-/g, '_'), args: parsed.args || {} };
      return executeAgentTool(norm, opts);
    }
    // 3) No tool — return the model's own answer (or the full reply ladder if empty).
    if (modelText && modelText.trim() && !/^\s*\{/.test(modelText)) {
      const brain = activeBrain || selectEmbeddedBrain();
      return { response: modelText.trim(), modelResponse: modelText.trim(), brain: brain?.name || 'Embedded LFM', tool_call: null, fallback: false };
    }
  } catch {}
  const r = await reasonReply(prompt, { agentic: false, provider: opts.provider, role: opts.role, brief: opts.brief });
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
  let serperKey = '';
  try { serperKey = (connectorCreds('serper').api_key) || ''; } catch {}
  const apiKey = body.api_key || serperKey || process.env.SERPER_API_KEY || process.env.GOOGLE_API_KEY || body.google_key;

  // Saved Serper connector → high-quality results first.
  if (serperKey) {
    try {
      const out = await fetchUrl('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, num: maxResults }) });
      const j = JSON.parse(out);
      const results = (j.organic || []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet || '' }));
      if (results.length) return { ok: true, query, results, count: results.length, source: 'serper', note: '' };
    } catch {}
  }

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

// ── Phase 3: Deep-read research ── search, then actually FETCH and READ the top
// source pages (not just snippets), so analysis is grounded in real content.
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h\d|li|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function fetchPageText(url, ms = 8000) {
  return Promise.race([
    fetchUrl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } }).then(stripHtml),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}
// DuckDuckGo returns redirect URLs (…/l/?uddg=<real-url>); decode to the target.
function resolveResultUrl(u) {
  try {
    const m = String(u || '').match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    return String(u || '');
  } catch { return String(u || ''); }
}
async function deepResearch(query, maxPages = 3) {
  const search = await webSearch({ q: query, max_results: 8 });
  const urls = (search.results || [])
    .map((r) => ({ ...r, url: resolveResultUrl(r.url) }))
    .filter((r) => /^https?:\/\//.test(r.url) && !/duckduckgo\.com/.test(r.url));
  const pages = [];
  for (const r of urls) {
    if (pages.length >= maxPages) break;
    try {
      const text = await fetchPageText(r.url);
      if (text && text.length > 150) pages.push({ title: r.title, url: r.url, text: text.slice(0, 1600) });
    } catch {}
  }
  return { ok: true, query, read: pages.length, pages, snippets: (search.results || []).slice(0, 5) };
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

// ── Phase 1: Vector memory / RAG ──
// A local embedding model (nomic) runs on its own port; memories are embedded
// and stored, then the most relevant ones are retrieved and injected into chat
// context — so ABUZ8 remembers across sessions.
const EMBED_PORT = Number(process.env.ABUZ8_EMBED_PORT || 8904);
let embedProcess = null, embedStarting = false;
function embedModelFile() {
  const dir = path.join(dataRoot || '', 'models', 'embed');
  if (!exists(dir)) return null;
  const f = fs.readdirSync(dir).find((x) => /\.gguf$/i.test(x));
  return f ? path.join(dir, f) : null;
}
function embedAvailable() { return Boolean(embedModelFile()) && exists(brainRuntimeFiles().server); }
async function ensureEmbedBrain() {
  if (embedProcess && await portHealthy(EMBED_PORT)) return true;
  if (embedProcess || embedStarting) return waitForPort(EMBED_PORT, 30000);
  const files = brainRuntimeFiles();
  const model = embedModelFile();
  if (!exists(files.server) || !model) return false;
  embedStarting = true;
  const ngl = (brainIsCuda() && await hasNvidiaGpu()) ? '99' : '0';
  const args = ['-m', model, '--host', '127.0.0.1', '--port', String(EMBED_PORT), '--embeddings', '--pooling', 'mean', '-c', '2048', '-ngl', ngl, '--threads', String(Math.max(2, Math.min(6, os.cpus().length || 4)))];
  try {
    embedProcess = spawn(files.server, args, { cwd: files.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    embedProcess.once('error', () => { embedProcess = null; embedStarting = false; });
    embedProcess.once('exit', () => { embedProcess = null; embedStarting = false; });
    const ready = await waitForPort(EMBED_PORT, 30000);
    embedStarting = false;
    return ready;
  } catch (e) { embedProcess = null; embedStarting = false; return false; }
}
async function embedText(text) {
  if (!embedAvailable() || !(await ensureEmbedBrain())) return null;
  try {
    const out = await httpJson('POST', EMBED_PORT, '/v1/embeddings', { input: String(text || '').slice(0, 2000) }, 20000);
    const e = out && out.data && out.data[0] && out.data[0].embedding;
    return Array.isArray(e) ? e : null;
  } catch { return null; }
}
function cosine(a, b) {
  let d = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}
function vectorFile() { return path.join(dataRoot, 'memory', 'vectors.jsonl'); }
function readVectors() {
  try { return fs.readFileSync(vectorFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
async function addMemoryVector(item) {
  try {
    const content = (item.content || item.text || '').trim();
    if (!content) return false;
    const vec = await embedText(content);
    if (!vec) return false;
    appendJsonl(vectorFile(), { id: item.id || crypto.randomUUID(), content, type: item.type || 'note', timestamp: item.timestamp || new Date().toISOString(), vec });
    return true;
  } catch { return false; }
}
async function retrieveMemories(query, k = 4) {
  const qv = await embedText(query);
  if (qv) {
    const vs = readVectors();
    if (vs.length) {
      return vs.map((m) => ({ content: m.content, type: m.type, score: cosine(qv, m.vec) }))
        .sort((a, b) => b.score - a.score).slice(0, k).filter((m) => m.score > 0.35)
        .map((m) => ({ content: m.content, type: m.type, score: Math.round(m.score * 100) / 100 }));
    }
  }
  return searchMemoryItems(query, k).map((m) => ({ content: m.content || m.response || '', type: m.type || 'note' }));
}
async function indexAllMemories() {
  const existing = new Set(readVectors().map((v) => v.content));
  const items = readMemory(800).filter((m) => (m.content || '').trim() && !existing.has(m.content));
  let n = 0;
  for (const it of items) { if (await addMemoryVector(it)) n++; }
  return { ok: true, indexed: n, total: readVectors().length, embed_engine: embedAvailable() ? 'nomic' : 'keyword-fallback' };
}

// ── LEARN FROM CLAUDE — ingest your full claude.ai conversation export into RAG ──
function parseClaudeMsgText(m) {
  let t = m.text || m.content || (m.message && m.message.content) || '';
  if (Array.isArray(t)) t = t.map((p) => (typeof p === 'string' ? p : (p && (p.text || p.content)) || '')).join(' ');
  return String(t || '').trim();
}
// Find a claude.ai data export (conversations.json) sitting on disk.
function scanForClaudeExport() {
  const home = os.homedir();
  const spots = [path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'), path.dirname(claudeConfigPath()), dataRoot].filter(Boolean);
  const found = [];
  for (const dir of spots) {
    try {
      if (!exists(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (/conversations.*\.json$/i.test(f)) { const full = path.join(dir, f); try { found.push({ path: full, size_mb: Math.round(fs.statSync(full).size / 1024 / 1024 * 10) / 10 }); } catch {} }
      }
    } catch {}
  }
  return found;
}
async function importClaudeConversations(data, opts = {}) {
  let convos = Array.isArray(data) ? data : (data.conversations || data.data || []);
  if (!Array.isArray(convos)) throw new Error('That is not a Claude conversations export (expected an array of conversations).');
  const max = opts.max || 5000;
  let imported = 0, messages = 0;
  for (const c of convos.slice(0, max)) {
    const msgs = c.chat_messages || c.messages || [];
    if (!Array.isArray(msgs) || !msgs.length) continue;
    const title = c.name || c.title || 'Claude conversation';
    const when = c.created_at || c.created || new Date().toISOString();
    const lines = msgs.slice(0, 50).map((m) => {
      const s = String(m.sender || m.role || '').toLowerCase();
      const who = (s.includes('assist') || s === 'assistant' || s === 'ai') ? 'Claude' : 'User';
      return who + ': ' + parseClaudeMsgText(m);
    }).filter((l) => l.length > 4);
    if (!lines.length) continue;
    messages += msgs.length;
    const content = ('[Claude history — ' + title + ']\n' + lines.join('\n')).slice(0, 3500);
    appendJsonl(memoryFile(), { id: 'claude-' + (c.uuid || c.id || crypto.randomUUID()), type: 'claude-import', content, title, timestamp: when });
    imported++;
  }
  pushActivity('learn', 'Learned from Claude: ' + imported + ' conversations', messages + ' messages → memory');
  // Vectorize in the background so recall (RAG) sharpens; raw import is keyword-searchable immediately.
  setTimeout(() => { indexAllMemories().catch(() => {}); }, 200);
  return { ok: true, conversations: imported, messages, total_in_file: convos.length, note: 'Imported into long-term memory. ABUZ8 will now recall and learn from this past work; vector indexing finishes in the background.' };
}
async function importClaudeFromPath(p) {
  if (!p || !exists(p)) throw new Error('File not found: ' + p);
  const raw = fs.readFileSync(p, 'utf8');
  let data; try { data = JSON.parse(raw); } catch { throw new Error('Could not parse the JSON export.'); }
  return importClaudeConversations(data, {});
}

// ── SECOND BRAIN (vault) — Obsidian/Understand-Anything style ─────────────
// Drop ANY source (URL or text); ABUZ8 reads it, summarizes + extracts key
// points, files it as Markdown YOU own, and indexes it for RAG recall. Ask
// anything and it answers from your own knowledge.
function vaultDir() { return safeMkdir(path.join(dataRoot, 'brain', 'notes')); }
function listVaultNotes() {
  const dir = vaultDir(); const out = [];
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      try { const txt = fs.readFileSync(path.join(dir, f), 'utf8'); const title = ((txt.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '')).trim(); const preview = txt.replace(/^#.*$/m, '').replace(/Source:.*$/m, '').replace(/[#*>\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150); out.push({ id: f.replace(/\.md$/, ''), title, preview }); } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.id.localeCompare(a.id));
}
function readVaultNote(id) { try { return { ok: true, id, markdown: fs.readFileSync(path.join(vaultDir(), String(id).replace(/[^a-z0-9]/gi, '') + '.md'), 'utf8') }; } catch { return { ok: false, error: 'not found' }; } }
function deleteVaultNote(id) { try { fs.unlinkSync(path.join(vaultDir(), String(id).replace(/[^a-z0-9]/gi, '') + '.md')); } catch {} return { ok: true }; }
async function vaultIngest(body = {}) {
  let bodyText = String(body.text || '').trim();
  const src = body.url ? String(body.url).trim() : 'note';
  if (body.url && !bodyText) { try { bodyText = await fetchPageText(body.url, 16000); } catch (e) { throw new Error('Could not read that link: ' + e.message); } }
  if (!bodyText) throw new Error('Give me a link or some text to file.');
  const sys = 'You are a knowledge librarian. Read the source and reply ONLY as compact JSON: {"title":"a short clear title","summary":"3-5 sentence summary","key_points":["point","point"],"tags":["tag","tag"]}. Be factual and concise.';
  let meta = { title: body.title || (src === 'note' ? 'Note' : src), summary: '', key_points: [], tags: [] };
  try { const r = await reasonReply('Source:\n' + bodyText.slice(0, 6000), { system: sys, noMemory: true }); const m = String(r.text || '').match(/\{[\s\S]*\}/); if (m) { const j = JSON.parse(m[0]); meta = { title: j.title || meta.title, summary: j.summary || '', key_points: j.key_points || [], tags: j.tags || [] }; } } catch {}
  const id = 'n' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const note = { id, title: meta.title, source: src, summary: meta.summary, key_points: meta.key_points, tags: meta.tags, created: new Date().toISOString() };
  const md = `# ${note.title}\n\n${src !== 'note' ? 'Source: ' + src + '\n\n' : ''}${note.summary}\n\n${(note.key_points || []).map((k) => '- ' + k).join('\n')}\n\n${note.tags && note.tags.length ? 'Tags: ' + note.tags.join(', ') + '\n\n' : ''}---\n${bodyText.slice(0, 9000)}`;
  try { fs.writeFileSync(path.join(vaultDir(), id + '.md'), md, 'utf8'); } catch {}
  const memContent = ('[Note: ' + note.title + '] ' + note.summary + ' ' + (note.key_points || []).join('. ')).slice(0, 2000);
  appendJsonl(memoryFile(), { id, type: 'brain-note', content: memContent, title: note.title, source: src, timestamp: note.created });
  addMemoryVector({ id, type: 'brain-note', content: memContent, timestamp: note.created }).catch(() => {});
  pushActivity('brain', 'Filed a note: ' + note.title, src);
  return { ok: true, note };
}
async function vaultAsk(q) {
  if (!q) throw new Error('Ask a question.');
  let ctx = '';
  try { const mems = await retrieveMemories(q, 6); ctx = mems.map((m) => '- ' + m.content).join('\n'); } catch {}
  const sys = 'You are ABUZ8 answering from the user\'s OWN knowledge base (their notes + saved sources + past work). Use the notes below when relevant and say which note. If they don\'t cover it, say so briefly, then answer from general knowledge. Be concise.';
  const r = await reasonReply('Question: ' + q + '\n\nMy knowledge:\n' + (ctx || '(nothing saved yet)'), { system: sys, noMemory: true });
  return { ok: true, answer: String(r.text || '').trim(), sources: ctx ? ctx.split('\n').length : 0 };
}

// ── CONTENT STUDIO — visuals + SEO articles (the production gap) ──────────
// Image generation works FREE out of the box via Pollinations (no key); a
// connected premium provider (image_gen connector) is used when present.
function studioImageUrl(prompt, opts = {}) {
  const w = opts.width || 1024, h = opts.height || 1024;
  const seed = opts.seed != null ? opts.seed : Math.floor((Date.now() % 100000));
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 600))}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`;
}
async function studioImage(prompt, opts = {}) {
  const p = String(prompt || '').trim(); if (!p) throw new Error('Give an image prompt.');
  const c = connectorCreds('image_gen'); const key = c.api_key || '';
  // Free & reliable: a Hugging Face token (hf_…) → FLUX/SDXL on HF Inference.
  if (key && /^hf_/.test(key)) {
    try {
      const model = c.model || 'black-forest-labs/FLUX.1-schnell';
      const buf = await fetchUrl('https://api-inference.huggingface.co/models/' + model, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: p }), timeout: 90000, binary: true });
      if (buf && buf.length > 1200 && buf[0] !== 0x7b) { pushActivity('studio', 'Generated an image (HF)', p.slice(0, 60)); return { ok: true, url: 'data:image/png;base64,' + buf.toString('base64'), engine: 'huggingface-flux', prompt: p }; }
    } catch (e) { /* fall through */ }
  }
  // Premium: OpenAI-compatible images endpoint.
  if (key) {
    try {
      const base = c.endpoint || 'https://api.openai.com/v1';
      const out = JSON.parse(await fetchUrl(base.replace(/\/$/, '') + '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: c.model || 'gpt-image-1', prompt: p, size: '1024x1024' }), timeout: 90000 }));
      const url = out.data && out.data[0] && (out.data[0].url || (out.data[0].b64_json ? 'data:image/png;base64,' + out.data[0].b64_json : ''));
      if (url) { pushActivity('studio', 'Generated an image (premium)', p.slice(0, 60)); return { ok: true, url, engine: 'premium', prompt: p }; }
    } catch (e) { /* fall through */ }
  }
  // Best-effort free fallback (Pollinations is now rate-limited — may 402).
  pushActivity('studio', 'Generated an image (free)', p.slice(0, 60));
  return { ok: true, url: studioImageUrl(p, opts), engine: 'pollinations-free (rate-limited)', prompt: p, note: 'Free server is heavily rate-limited now. For instant, reliable images add a FREE Hugging Face token (hf_…) under Connect → Premium image gen.' };
}
async function studioArticle(keyword) {
  const k = String(keyword || '').trim(); if (!k) throw new Error('Give a keyword or topic.');
  const sys = 'You are an elite SEO content writer. Write a complete, genuinely useful SEO article in clean Markdown: an H1 title with the keyword, a hook intro, 4-7 H2 sections with real substance and natural keyword usage, short scannable paragraphs, and a conclusion with a clear call to action. No filler, no "as an AI".';
  const r = await reasonReply('Target keyword / topic: ' + k, { system: sys, noMemory: true });
  return { ok: true, keyword: k, markdown: String(r.text || '').trim() };
}

// ── HUD / COMMAND CENTER — the one-person-company cockpit (CEO/CFO/CRO/SEO) ──
async function hudSnapshot() {
  const out = { ok: true, time: currentTimeContext() };
  try { out.brain = (selectEmbeddedBrain() || {}).name || 'local'; out.brain_alive = !!lfmProcess; } catch {}
  try { const sel = readJson(settingsPath(), {}).active_provider; out.active_provider = sel ? sel.name + ' · ' + sel.model : null; } catch {}
  // CFO — revenue (Stripe when connected)
  try { if (connectorCreds('stripe').secret_key) { const b = await connectorCall('stripe', 'balance'); out.revenue = { available: (b.available || []).map((a) => (a.amount / 100).toFixed(2) + ' ' + String(a.currency || '').toUpperCase()).join(', '), pending: (b.pending || []).map((a) => (a.amount / 100).toFixed(2) + ' ' + String(a.currency || '').toUpperCase()).join(', ') }; } else out.revenue = { not_connected: true }; } catch (e) { out.revenue = { error: 'check Stripe key' }; }
  // CRO — content & growth
  try {
    const loops = readSchedules().filter((s) => s.action && s.action.kind === 'content_loop');
    let posts = 0; try { const lines = fs.readFileSync(signalFile(), 'utf8').trim().split('\n'); for (const l of lines) { try { const s = JSON.parse(l); if (s.kind === 'social_post') posts += (s.ok || 0); } catch {} } } catch {}
    out.growth = { content_loops: loops.filter((l) => l.enabled).length, posts_made: posts, platforms: socialList().filter((p) => p.connected).map((p) => p.label) };
  } catch {}
  // COO — missions & autonomy
  try { const m = listMissionGraphs(); out.ops = { active_missions: m.filter((x) => x.status !== 'complete').length, total_missions: m.length, schedules: readSchedules().filter((s) => s.enabled).length }; } catch {}
  // CKO — knowledge
  try { out.knowledge = { notes: listVaultNotes().length, memories: readVectors().length }; } catch {}
  // CTO — agents & wiring
  try { out.agents = { classes: (typeof AGENT_CLASSES !== 'undefined' ? AGENT_CLASSES.length : 0), providers_connected: providerCatalogList().filter((p) => p.configured).length, connectors_connected: connectorList().filter((c) => c.configured).length, vision: visionBrainAvailable() }; } catch {}
  try { out.recent = activityLog.slice(-6).reverse().map((a) => ({ label: a.label, detail: a.detail, type: a.type })); } catch {}
  return out;
}

// ── CHAT SESSIONS — named, searchable, durable threads ───────────────────
function sessionsDir() { return safeMkdir(path.join(dataRoot, 'sessions')); }
function sessionFile(id) { return path.join(sessionsDir(), String(id || '').replace(/[^a-z0-9]/gi, '') + '.json'); }
function listSessions() {
  const dir = sessionsDir(); const out = [];
  try { for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) { try { const s = readJson(path.join(dir, f), null); if (s) out.push({ id: s.id, title: s.title || 'Chat', updated: s.updated, count: (s.messages || []).length }); } catch {} } } catch {}
  return out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}
function getSession(id) { return readJson(sessionFile(id), null); }
function saveSession(s) { if (!s || !s.id) return { ok: false, error: 'no id' }; s.updated = new Date().toISOString(); if (!s.created) s.created = s.updated; if (!s.title) s.title = (s.messages && s.messages[0] && String(s.messages[0].text || '').slice(0, 40)) || 'New chat'; writeJson(sessionFile(s.id), s); return { ok: true, id: s.id, title: s.title }; }
function deleteSessionById(id) { try { fs.unlinkSync(sessionFile(id)); } catch {} return { ok: true }; }
function searchSessions(q) {
  q = String(q || '').toLowerCase().trim(); if (!q) return listSessions();
  const dir = sessionsDir(); const out = [];
  try { for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) { try { const s = readJson(path.join(dir, f), null); if (!s) continue; const hay = ((s.title || '') + ' ' + (s.messages || []).map((m) => m.text || '').join(' ')).toLowerCase(); if (hay.includes(q)) out.push({ id: s.id, title: s.title, updated: s.updated, count: (s.messages || []).length }); } catch {} } } catch {}
  return out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}

// ── SELF-UPDATE — version check against a configurable release manifest ───
const APP_VERSION = '1.22.0';
async function checkUpdate() {
  const url = readJson(settingsPath(), {}).update_url || process.env.ABUZ8_UPDATE_URL || '';
  if (!url) return { ok: true, current: APP_VERSION, update_available: false, note: 'No update channel configured. Set one in Settings → Updates (a JSON URL with {version, installer_url}).' };
  try {
    const m = JSON.parse(await fetchUrl(url, { timeout: 12000 }));
    const newer = m.version && String(m.version) !== APP_VERSION;
    return { ok: true, current: APP_VERSION, latest: m.version, update_available: !!newer, installer_url: m.installer_url || null, notes: m.notes || '' };
  } catch (e) { return { ok: false, current: APP_VERSION, error: e.message }; }
}

// ── Self-learning loop (migrated from Al-Buraq) ──
// Every agent turn is recorded to signal.jsonl. A periodic pass HARVESTs those
// signals, PROPOSEs skills from repeated successful tool use, scores them, and
// PROMOTEs the ones that prove out — so ABUZ8 learns from its own experience.
const PROMOTE_THRESHOLD = 0.66, MIN_PATTERN_COUNT = 2;
function signalFile() { return path.join(dataRoot, 'logs', 'signal.jsonl'); }
function recordSignal(rec) { try { appendJsonl(signalFile(), { ts: new Date().toISOString(), ...rec }); } catch {} }
function listLearnedSkills() {
  const d = path.join(dataRoot || '', 'skills', 'promoted');
  if (!exists(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(d, f), {})).filter((s) => s.id);
}
function selfLearnOnce() {
  if (!dataRoot) return { ok: false };
  // HARVEST
  let rows = [];
  try { rows = fs.readFileSync(signalFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  // PROPOSE — repeated SUCCESSFUL tool usage becomes a candidate skill.
  const counts = {};
  for (const r of rows) {
    if (!r.ok) continue;
    for (const t of (r.used_tools || [])) { const n = typeof t === 'string' ? t : (t && t.tool); if (n && n !== 'reasoning only') counts[n] = (counts[n] || 0) + 1; }
  }
  const proposedDir = safeMkdir(path.join(dataRoot, 'skills', 'proposed'));
  const promotedDir = safeMkdir(path.join(dataRoot, 'skills', 'promoted'));
  let written = 0;
  for (const [tool, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    if (n < MIN_PATTERN_COUNT) continue;
    const id = 'auto_' + slug(tool);
    const p = path.join(proposedDir, id + '.json');
    if (exists(p) || exists(path.join(promotedDir, id + '.json'))) continue;
    writeJson(p, { id, trigger_tool: tool, observed_count: n, skill: `When the task matches '${tool}', use the ${tool} tool directly — it has worked ${n} times.`, proposed_at: new Date().toISOString(), status: 'proposed' });
    written++;
  }
  // EVALUATE — score; promote (>=0.66), prune (<0.34), else keep pending.
  let promoted = 0, pruned = 0, pending = 0;
  for (const f of (exists(proposedDir) ? fs.readdirSync(proposedDir) : [])) {
    if (!f.endsWith('.json')) continue;
    const fp = path.join(proposedDir, f);
    const pr = readJson(fp, null); if (!pr) continue;
    const base = Math.min(1, (pr.observed_count || 0) / 5);
    const score = Math.round((0.5 * base + 0.5 * (pr.trigger_tool ? 1 : 0)) * 1000) / 1000;
    pr.score = score;
    if (score >= PROMOTE_THRESHOLD) { pr.status = 'promoted'; writeJson(path.join(promotedDir, f), pr); try { fs.unlinkSync(fp); } catch {} promoted++; }
    else if (score < 0.34) { try { fs.unlinkSync(fp); } catch {} pruned++; }
    else { pr.status = 'pending'; writeJson(fp, pr); pending++; }
  }
  const out = { ok: true, ts: new Date().toISOString(), harvested: rows.length, proposed: written, promoted, pruned, pending, learned_total: listLearnedSkills().length };
  appendJsonl(path.join(dataRoot, 'logs', 'self_learning_log.jsonl'), out);
  return out;
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

// Accurate NVIDIA GPU info (name + true VRAM + driver) via nvidia-smi when present.
function nvidiaSmi() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 6000 }, (err, out) => {
      if (err) return resolve(null);
      const rows = String(out || '').trim().split(/\r?\n/).filter(Boolean).map((l) => {
        const [name, mem, drv] = l.split(',').map((s) => s.trim());
        return { name, vram_mb: Math.round(Number(mem) || 0), driver: drv };
      });
      resolve(rows.length ? rows : null);
    });
  });
}
function monitorCount() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(1);
    execFile('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count'], { windowsHide: true, timeout: 6000 }, (err, out) => {
      resolve(err ? 1 : (parseInt(String(out).trim(), 10) || 1));
    });
  });
}

function expandZip(zip, dest) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${dest}' -Force`], { windowsHide: true, timeout: 180000 }, (err) => err ? reject(err) : resolve());
  });
}

// GPU UNLOCK: download a CUDA-enabled llama.cpp build + CUDA runtime so the brain
// offloads to the NVIDIA GPU. Run this on a GPU machine (Pegasus/DGX) to go fast.
// On boot: if there's an NVIDIA GPU and we're not yet accelerated, automatically
// install the CUDA runtime and move the brains onto the GPU — so the portable
// build "figures out" the hardware it lands on (Surface → CPU, Pegasus/DGX → GPU).
let _autoGpuTried = false;
async function maybeAutoAccelerate() {
  if (_autoGpuTried) return; _autoGpuTried = true;
  try {
    if (readJson(settingsPath(), {}).auto_gpu === false) return; // user opted out
    if (brainIsCuda()) return;                                    // already on the GPU runtime
    if (!(await hasNvidiaGpu())) return;                          // no NVIDIA GPU here (e.g. the Surface)
    pushActivity('observe', 'NVIDIA GPU detected — enabling GPU acceleration', '');
    logFn('auto-GPU: NVIDIA GPU found; downloading CUDA runtime…');
    const r = await unlockGpu();
    if (r && r.ok) {
      pushActivity('done', 'GPU acceleration enabled — brains moved to the GPU', r.build || '');
      logFn('auto-GPU: enabled (' + (r.build || '') + '). Restarting brains on the GPU.');
      // Drop running brains so they relaunch on the CUDA runtime (lazy ensure* will restart them).
      for (const proc of [lfmProcess, voiceProcess, embedProcess, visionProcess]) { try { if (proc) proc.kill(); } catch {} }
      lfmProcess = null; voiceProcess = null; embedProcess = null; visionProcess = null;
    } else { logFn('auto-GPU: ' + ((r && r.error) || 'could not enable') + ' — staying on CPU.'); }
  } catch (e) { logFn('auto-GPU skipped: ' + e.message); }
}
async function unlockGpu() {
  if (!(await hasNvidiaGpu())) return { ok: false, error: 'No NVIDIA GPU detected on this machine. CPU mode stays active.' };
  const dest = safeMkdir(path.join(attachmentsDir(), 'brain-cuda'));
  let rel;
  try { rel = JSON.parse(await fetchUrl('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', { headers: { 'User-Agent': 'abuz8-os', Accept: 'application/vnd.github+json' } })); }
  catch (e) { return { ok: false, error: 'Could not reach GitHub for the CUDA build: ' + e.message }; }
  const assets = rel.assets || [];
  const cuda = assets.find((a) => /bin-win-cuda.*x64\.zip$/i.test(a.name)) || assets.find((a) => /win-cuda.*\.zip$/i.test(a.name));
  const cudart = assets.find((a) => /cudart.*win.*\.zip$/i.test(a.name));
  if (!cuda) return { ok: false, error: 'No prebuilt CUDA Windows binary in the latest llama.cpp release; build one and drop it in attachments/brain-cuda.' };
  const tmp = safeMkdir(path.join(dataRoot, 'cache', 'cuda-dl'));
  try {
    const cudaZip = path.join(tmp, cuda.name);
    await downloadFile(cuda.browser_download_url, cudaZip);
    await expandZip(cudaZip, dest);
    if (cudart) { const cz = path.join(tmp, cudart.name); await downloadFile(cudart.browser_download_url, cz); await expandZip(cz, dest); }
    // Some builds nest the exe one folder deep — flatten if needed.
    if (!exists(path.join(dest, 'llama-server.exe'))) {
      for (const e of fs.readdirSync(dest, { withFileTypes: true })) {
        if (e.isDirectory() && exists(path.join(dest, e.name, 'llama-server.exe'))) {
          for (const f of fs.readdirSync(path.join(dest, e.name))) { try { fs.renameSync(path.join(dest, e.name, f), path.join(dest, f)); } catch {} }
        }
      }
    }
    _nvidiaCache = null;
    stopEmbeddedBrain();
    if (voiceProcess) { try { voiceProcess.kill(); } catch {} voiceProcess = null; }
    const ok = exists(path.join(dest, 'llama-server.exe'));
    return { ok, installed_to: dest, build: cuda.name, cudart: cudart ? cudart.name : null, accel: ok && brainIsCuda() ? 'gpu' : 'cpu', note: ok ? 'GPU runtime installed. Your next reply runs on the NVIDIA GPU.' : 'Downloaded but llama-server.exe not found in the build.' };
  } catch (e) { return { ok: false, error: e.message }; }
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
  const gpuNames = await detectGpuNames();
  const smi = await nvidiaSmi();
  const monitors = await monitorCount();
  // Merge accurate NVIDIA VRAM (nvidia-smi) with the CIM list; CIM AdapterRAM caps
  // at 4 GB so we trust nvidia-smi for VRAM when present.
  const gpus = gpuNames.map((name) => {
    const m = smi && smi.find((g) => name.toLowerCase().includes(g.name.toLowerCase().split(' ')[1] || g.name.toLowerCase()));
    return { name, vram_mb: m ? m.vram_mb : null, driver: m ? m.driver : null };
  });
  if (smi) for (const g of smi) if (!gpus.some((x) => x.vram_mb)) gpus.push({ name: g.name, vram_mb: g.vram_mb, driver: g.driver });
  const totalGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  const cpuName = os.cpus()[0]?.model || 'CPU';
  const cores = os.cpus().length;
  const gpuText = gpuNames.join(' ').toLowerCase();
  const hasNvidia = /nvidia|geforce|rtx|gtx|tesla|quadro|dgx/.test(gpuText) || Boolean(smi);
  const hasDiscreteGpu = hasNvidia || gpuText.includes('radeon') || gpuText.includes('arc');
  const totalVram = smi ? smi.reduce((a, g) => a + g.vram_mb, 0) : 0;
  const accel = lastBrainAccel; // 'gpu' or 'cpu' — what the brain is actually using
  const cudaReady = brainIsCuda();
  // Power tier scales from a Surface to a DGX.
  const tier = (totalGb >= 128 && totalVram >= 40000) ? 'AI workstation / DGX-class'
    : totalVram >= 16000 ? 'high-performance GPU rig'
    : (totalGb >= 32 && hasDiscreteGpu) ? 'workstation'
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
    system: { os_family: os.type(), os_release: os.release(), arch: os.arch(), hostname: os.hostname(), monitors },
    cpu: { name: cpuName, cores },
    memory: { total_gb: totalGb },
    storage,
    gpus,
    acceleration: {
      mode: accel,                              // what the brain is running on now
      nvidia: hasNvidia,
      total_vram_mb: totalVram,
      cuda_runtime_installed: cudaReady,
      can_unlock_gpu: hasNvidia && !cudaReady,  // GPU present but still on CPU → unlock available
      threads_used: Math.max(2, cores)
    },
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
  { id: 'dotnet', cmd: 'dotnet', args: ['--version'], label: '.NET' }
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
    acceleration: probe.acceleration,
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

/* ── SOCIAL BEACON — the home base for posting everywhere ────────────────
   ABUZ8 is the beacon: compose once, fan out to every connected network.
   X / Mastodon / Bluesky / Telegram / Discord work with simple tokens (real,
   verified posts). Instagram / TikTok / LinkedIn / Facebook / YouTube / Threads
   / Reddit / Pinterest are wired to their real APIs but need the platform's
   OAuth app + token — we say so honestly instead of faking a post. */
const SOCIAL_PLATFORMS = [
  { id: 'x', label: 'X (Twitter)', easy: true, fields: ['access_token'], note: 'OAuth2 user token with tweet.write. Posts immediately.' },
  { id: 'mastodon', label: 'Mastodon', easy: true, fields: ['instance', 'access_token'], note: 'Your instance URL + an access token (Settings → Development → New app). Real toots.' },
  { id: 'bluesky', label: 'Bluesky', easy: true, fields: ['handle', 'app_password'], note: 'Handle + an App Password (Settings → App Passwords). Posts via AT Protocol.' },
  { id: 'telegram', label: 'Telegram', easy: true, fields: ['bot_token', 'chat_id'], note: 'A bot token (@BotFather) + channel/chat id. Broadcasts instantly.' },
  { id: 'discord', label: 'Discord', easy: true, fields: ['webhook_url'], note: 'A channel webhook URL. Posts instantly, no OAuth.' },
  { id: 'instagram', label: 'Instagram', easy: false, fields: ['ig_user_id', 'access_token'], note: 'Meta Graph API: an IG Business account + long-lived token. Images/reels via container+publish.' },
  { id: 'tiktok', label: 'TikTok', easy: false, fields: ['access_token'], note: 'TikTok Content Posting API: a TikTok developer app + OAuth token.' },
  { id: 'linkedin', label: 'LinkedIn', easy: false, fields: ['access_token', 'author_urn'], note: 'LinkedIn UGC API: an OAuth token (w_member_social) + your URN.' },
  { id: 'facebook', label: 'Facebook Page', easy: false, fields: ['page_id', 'access_token'], note: 'Meta Graph API: a Page access token.' },
  { id: 'youtube', label: 'YouTube', easy: false, fields: ['access_token'], note: 'YouTube Data API OAuth token (community posts / uploads).' },
  { id: 'threads', label: 'Threads', easy: false, fields: ['threads_user_id', 'access_token'], note: 'Threads Graph API: a user id + token (container+publish).' },
  { id: 'reddit', label: 'Reddit', easy: false, fields: ['access_token', 'subreddit'], note: 'Reddit API OAuth token + target subreddit.' },
  { id: 'pinterest', label: 'Pinterest', easy: false, fields: ['access_token', 'board_id'], note: 'Pinterest API OAuth token + board.' }
];
function socialPath() { return path.join(safeMkdir(path.join(dataRoot, 'config')), 'social.json'); }
function readSocial() { return readJson(socialPath(), { accounts: {} }); }
function writeSocial(o) { writeJson(socialPath(), o); }
function socialDef(id) { return SOCIAL_PLATFORMS.find((p) => p.id === id); }
function socialCreds(id) { return (readSocial().accounts || {})[id] || {}; }
function socialList() {
  const acc = readSocial().accounts || {};
  return SOCIAL_PLATFORMS.map((p) => ({ id: p.id, label: p.label, easy: p.easy, fields: p.fields, note: p.note, connected: !!(acc[p.id] && p.fields.every((f) => acc[p.id][f])) }));
}
function socialConnect(id, creds) {
  if (!socialDef(id)) throw new Error('unknown platform');
  const s = readSocial(); s.accounts = s.accounts || {}; s.accounts[id] = Object.assign({}, s.accounts[id], creds || {}); writeSocial(s);
  pushActivity('social', 'Social account linked: ' + socialDef(id).label, '');
  return { ok: true };
}
function socialDisconnect(id) { const s = readSocial(); if (s.accounts) delete s.accounts[id]; writeSocial(s); return { ok: true }; }
async function blueskySession(c) {
  const r = JSON.parse(await fetchUrl('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: c.handle, password: c.app_password }) }));
  if (!r.accessJwt) throw new Error(r.message || 'Bluesky auth failed');
  return r;
}
// Post to one platform — real API per network. Returns {ok, id?, error?, needs_auth?}.
async function socialPostOne(id, post) {
  let c = socialCreds(id);
  const def = socialDef(id);
  const text = String(post.text || post.content || '').trim();
  const link = post.link ? ('\n\n' + post.link) : '';
  if (!def) return { platform: id, ok: false, error: 'unknown platform' };
  // Hands-free OAuth fills in the access token for platforms that support it.
  if (!c.access_token) {
    let t = '';
    if (id === 'instagram' || id === 'facebook') t = await getValidToken('meta');
    else if (id === 'youtube') t = await getValidToken('google');
    else if (id === 'tiktok') t = await getValidToken('tiktok');
    if (t) c = { ...c, access_token: t };
  }
  // Instagram: real container→publish flow (needs an image/video URL).
  if (id === 'instagram' && c.access_token && c.ig_user_id) {
    if (!post.image && !post.media) return { platform: id, ok: false, needs_auth: false, error: 'Instagram needs an image/video URL (post.image) — caption-only is not allowed by their API.' };
    try {
      const cont = JSON.parse(await fetchUrl(`https://graph.facebook.com/v21.0/${c.ig_user_id}/media?image_url=${encodeURIComponent(post.image || post.media)}&caption=${encodeURIComponent(text)}&access_token=${c.access_token}`, { method: 'POST' }));
      if (!cont.id) return { platform: id, ok: false, error: (cont.error && cont.error.message) || 'container failed' };
      const pub = JSON.parse(await fetchUrl(`https://graph.facebook.com/v21.0/${c.ig_user_id}/media_publish?creation_id=${cont.id}&access_token=${c.access_token}`, { method: 'POST' }));
      return pub.id ? { platform: id, ok: true, id: pub.id } : { platform: id, ok: false, error: (pub.error && pub.error.message) || 'publish failed' };
    } catch (e) { return { platform: id, ok: false, error: e.message.slice(0, 140) }; }
  }
  if (!def.fields.every((f) => c[f])) return { platform: id, ok: false, needs_auth: true, error: 'Not connected — add: ' + def.fields.join(', ') };
  try {
    if (id === 'x') { const r = await xPost({ text: (text + link).slice(0, 280), access_token: c.access_token }); return { platform: id, ...r }; }
    if (id === 'mastodon') {
      const base = c.instance.replace(/\/+$/, '');
      const r = JSON.parse(await fetchUrl(base + '/api/v1/statuses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.access_token }, body: JSON.stringify({ status: text + link }) }));
      return r.id ? { platform: id, ok: true, id: r.id, url: r.url } : { platform: id, ok: false, error: r.error || 'failed' };
    }
    if (id === 'bluesky') {
      const sess = await blueskySession(c);
      const rec = { '$type': 'app.bsky.feed.post', text: (text + link).slice(0, 300), createdAt: new Date().toISOString() };
      const r = JSON.parse(await fetchUrl('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.accessJwt }, body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record: rec }) }));
      return r.uri ? { platform: id, ok: true, id: r.uri } : { platform: id, ok: false, error: r.message || 'failed' };
    }
    if (id === 'telegram') {
      const r = JSON.parse(await fetchUrl(`https://api.telegram.org/bot${c.bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: c.chat_id, text: text + link }) }));
      return r.ok ? { platform: id, ok: true, id: r.result && r.result.message_id } : { platform: id, ok: false, error: r.description || 'failed' };
    }
    if (id === 'discord') {
      await fetchUrl(c.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: (text + link).slice(0, 2000) }) });
      return { platform: id, ok: true };
    }
    if (id === 'linkedin') {
      const body = { author: c.author_urn, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: text + link }, shareMediaCategory: 'NONE' } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } };
      const r = JSON.parse(await fetchUrl('https://api.linkedin.com/v2/ugcPosts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.access_token, 'X-Restli-Protocol-Version': '2.0.0' }, body: JSON.stringify(body) }));
      return r.id ? { platform: id, ok: true, id: r.id } : { platform: id, ok: false, error: (r.message || 'failed') };
    }
    if (id === 'telegram') return { platform: id, ok: false, error: 'unreachable' };
    // Heavy-OAuth platforms: real endpoints exist but need the platform's app + token flow.
    return { platform: id, ok: false, needs_auth: true, error: def.label + ' needs its OAuth app + token (and usually media). Connect it, then posting goes live.' };
  } catch (e) { return { platform: id, ok: false, error: e.message.slice(0, 160) }; }
}
// The beacon: fan one post out to many networks at once.
async function socialPost(platforms, post) {
  const targets = (platforms && platforms.length) ? platforms : socialList().filter((p) => p.connected).map((p) => p.id);
  if (!targets.length) return { ok: false, error: 'No platforms selected or connected.' };
  pushActivity('social', 'Broadcasting to ' + targets.length + ' network(s)', String(post.text || '').slice(0, 80));
  const results = await Promise.all(targets.map((id) => socialPostOne(id, post)));
  recordSignal({ kind: 'social_post', platforms: targets, ok: results.filter((r) => r.ok).length });
  return { ok: results.some((r) => r.ok), results };
}
// Faceless content: ask the brain for platform-tailored copy (hook + body + hashtags).
async function socialDraft(topic, platform) {
  const p = platform || 'x';
  const sys = 'You are a world-class faceless-content social copywriter. Write a single ready-to-post ' + p + ' post: a scroll-stopping hook, tight value, and a clear CTA. No preamble, no quotes, no "here is" — output ONLY the post text. Add 3-6 relevant hashtags at the end' + (p === 'x' ? ', keep under 280 chars.' : '.');
  const r = await reasonReply('Topic: ' + topic, { system: sys, noMemory: true });
  return { ok: true, platform: p, text: String(r.text || '').trim() };
}

/* ── MESSAGING GATEWAY — chat WITH ABUZ8 from Telegram (two-way) ──────────
   Hermes's signature: talk to your agent from anywhere. ABUZ8 polls Telegram
   for incoming messages, runs them through the full agent, and replies — so
   your sovereign agent lives in your pocket via a normal Telegram chat. Reuses
   the Telegram bot token you connect in Social. */
let _tgOffset = 0, _tgBusy = false;
function tgToken() { try { return connectorCreds('telegram').bot_token || (readJson(settingsPath(), {}).tg_gateway_token) || ''; } catch { return ''; } }
function tgGatewayStatus() { const s = readJson(settingsPath(), {}); return { ok: true, enabled: s.tg_gateway === true, has_token: !!tgToken() }; }
function setTgGateway(on) { const s = readJson(settingsPath(), {}); s.tg_gateway = !!on; writeJson(settingsPath(), s); if (on) pushActivity('gateway', 'Telegram gateway ON', 'chat with ABUZ8 in Telegram'); return tgGatewayStatus(); }
async function tgSend(token, chatId, text) { try { await fetchUrl('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: String(text || '').slice(0, 4000) }), timeout: 15000 }); } catch {} }
async function tgPollOnce() {
  if (_tgBusy) return; if (readJson(settingsPath(), {}).tg_gateway !== true) return;
  const token = tgToken(); if (!token) return;
  _tgBusy = true;
  try {
    const r = JSON.parse(await fetchUrl('https://api.telegram.org/bot' + token + '/getUpdates?offset=' + (_tgOffset + 1) + '&timeout=0&limit=10', { timeout: 12000 }));
    for (const u of (r.result || [])) {
      _tgOffset = u.update_id;
      const msg = u.message || u.channel_post; if (!msg || !msg.text) continue;
      const chatId = msg.chat.id; const text = String(msg.text).trim();
      if (/^\/start\b/.test(text)) { await tgSend(token, chatId, 'Salaam — ABUZ8 here, your sovereign agent. Ask me anything, or tell me to do something.'); continue; }
      try { await fetchUrl('https://api.telegram.org/bot' + token + '/sendChatAction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, action: 'typing' }), timeout: 8000 }); } catch {}
      let reply = '';
      try { const res = await agenticReply(text, {}); reply = res.response || res.text || '(no reply)'; } catch (e) { reply = 'Error: ' + e.message; }
      await tgSend(token, chatId, reply);
      pushActivity('gateway', 'Telegram in: ' + text.slice(0, 40), 'replied');
    }
  } catch (e) {} finally { _tgBusy = false; }
}

/* ── THE FORGE — holographic CAD / world builder (Stark-style) ────────────
   The 3D scene lives in the renderer (bundled Three.js). The core's job is to
   turn natural language into structured scene operations, and to analyze a
   photo into an editable parts list. Deterministic parsing first (instant,
   offline); the vision step uses a connected vision provider when present, and
   honestly degrades to a label-driven reconstruction otherwise. */
const FORGE_ASSEMBLIES = ['engine', 'arc_reactor', 'tower', 'building', 'city', 'gear_train', 'lab', 'atom', 'rocket', 'molecule'];
function forgeInterpret(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return { action: 'none' };
  if (/\b(explode|blow (it|this)? ?up|exploded view|break (it|this)? ?(apart|down)|separate the parts?|spread (it )?out)\b/.test(t)) return { action: 'explode' };
  if (/\b(collapse|reassemble|put (it|them)? ?back|un-?explode|bring (it )?together|implode)\b/.test(t)) return { action: 'collapse' };
  if (/\b(clear|reset|wipe|new scene|start over|empty (the )?(scene|forge))\b/.test(t)) return { action: 'clear' };
  if (/\b(isolate|only (keep|show) (this|that|the selected)|hide the rest|focus on (this|that))\b/.test(t)) return { action: 'isolate' };
  if (/\b(delete|remove|trash|get rid of|cut)\b/.test(t)) return { action: 'delete' };
  if (/\b(duplicate|copy|clone)\b/.test(t)) return { action: 'duplicate' };
  if (/\b(rotate|spin|turn it)\b/.test(t)) return { action: 'rotate' };
  if (/\b(bigger|larger|scale up|grow|enlarge)\b/.test(t)) return { action: 'scale', value: 1.25 };
  if (/\b(smaller|shrink|scale down|reduce)\b/.test(t)) return { action: 'scale', value: 0.8 };
  const A = [['engine', /\b(engine|motor|v8|v6|v12|combustion|powertrain)\b/], ['arc_reactor', /\barc ?reactor|reactor core|reactor\b/], ['rocket', /\b(rocket|missile|booster|launch vehicle)\b/], ['tower', /\b(tower|skyscraper|spire|antenna)\b/], ['city', /\b(city|town|metropolis|sim ?city|district|skyline|downtown)\b/], ['building', /\b(building|house|structure|hangar|warehouse)\b/], ['gear_train', /\b(gear ?train|gearbox|transmission|cog|gears)\b/], ['lab', /\b(lab|laboratory|workshop|facility)\b/], ['atom', /\b(atom|nucleus|particle)\b/], ['molecule', /\b(molecule|compound|element)\b/]];
  for (const [name, re] of A) { if (re.test(t)) return { action: 'build', assembly: name }; }
  const P = [['box', /\b(box|cube|block|panel|slab)\b/], ['cylinder', /\b(cylinder|tube|pipe|rod|shaft|column)\b/], ['sphere', /\b(sphere|ball|orb|dome)\b/], ['gear', /\b(gear|cog|sprocket)\b/], ['cone', /\b(cone|nozzle|spike)\b/], ['torus', /\b(ring|torus|donut|loop)\b/], ['plane', /\b(floor|ground|plate|plane|base)\b/]];
  for (const [name, re] of P) { if (re.test(t)) return { action: 'add', part: name }; }
  return { action: 'none', note: 'No forge action recognized — try "build an engine", "explode it", "delete that", "make a city".' };
}
// Recognize a vision-capable (multimodal) model by name — covers the major cloud
// models AND the local/open ones (Gemma 3, NVIDIA NIM vision, Llava, etc.).
function isVisionModel(s) {
  const m = String(s || '').toLowerCase();
  if (/gemma-?2|gemma-?3-?1b|gemma-?1/.test(m)) return false; // text-only Gemmas
  return /gpt-?4o|gpt-?4\.|gpt-?4-?vision|o4|chatgpt-4o|gemini|claude-3|claude-opus|claude-sonnet|claude-haiku|grok.*vision|grok-?4|vision|pixtral|llama-?3\.2|llama-?4|qwen2?-?vl|gemma-?3|paligemma|nvila|\bvila\b|neva|internvl|minicpm-?v|moondream|llava|bakllava|cogvlm|idefics|smolvlm|phi-?3\.5-?vision|phi-?4.*vision|molmo|ovis/.test(m);
}
// Vision call for an OpenAI-compatible provider (image + prompt → text).
async function callProviderVision(provider, prompt, imageB64) {
  const url = provider.chat_url || ((provider.endpoint || '').replace(/\/+$/, '') + '/chat/completions');
  const headers = { 'Content-Type': 'application/json' };
  if (provider.api_key) headers['Authorization'] = 'Bearer ' + provider.api_key;
  const body = JSON.stringify({ model: provider.model, max_tokens: 700, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageB64.startsWith('data:') ? imageB64 : 'data:image/jpeg;base64,' + imageB64 } }] }] });
  const data = JSON.parse(await fetchUrl(url, { method: 'POST', headers, body, timeout: 60000 }));
  if (data.error) throw new Error(data.error.message || 'vision error');
  return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
}
async function forgeAnalyze(imageB64, hint) {
  const prompt = 'You are a CAD vision engine. Identify the object in this image and break it into its visible major parts/mechanisms. Reply ONLY as compact JSON: {"label":"...","assembly":"engine|arc_reactor|tower|building|city|gear_train|rocket|atom|molecule|generic","parts":["name1","name2",...]}. Pick the closest assembly type. List 4-14 parts.';
  let out = null, src = null;
  const p = activeVisionProvider();
  if (imageB64 && p) { try { out = await callProviderVision(p, prompt, imageB64); src = 'vision:' + p.label; } catch (e) {} }
  if (imageB64 && !out && visionBrainAvailable()) { try { out = await callLocalVision(prompt, imageB64); src = 'local:gemma-3-vision'; } catch (e) {} }
  if (out) {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) { try { const j = JSON.parse(m[0]); return { ok: true, source: src, label: j.label, assembly: FORGE_ASSEMBLIES.includes(j.assembly) ? j.assembly : 'building', parts: j.parts || [], note: 'Identified from the photo by ' + src + '. The 3D is an editable reconstruction of the visible form — internal hidden mechanisms can\'t be seen through a 2D image.' }; } catch (e) {} }
  }
  // Honest fallback: derive an assembly from the hint/label, no fabrication.
  const guess = (forgeInterpret('build ' + (hint || '')).assembly) || 'building';
  return { ok: true, source: 'reconstruction', label: hint || 'object', assembly: guess, parts: [], note: (imageB64 ? 'No vision model available yet, so ' : '') + 'I built a parametric 3D reconstruction from the label "' + (hint || 'object') + '". The local Gemma vision brain or a connected vision model lets me read the actual photo.' };
}

/* ── JARVIS LAYER — he sees your screen, briefs you, and turns photos into 3D ──
   The two traits that make an assistant "Jarvis": it can SEE what you're looking
   at, and it proactively briefs you. Both are real here. Screen-vision uses a
   connected vision model; briefing fuses the live clock, weather, missions, and
   (if connected) calendar + inbox. Nothing is fabricated. */
function activeVisionProvider() {
  const sel = (readJson(settingsPath(), {}).active_provider) || null;
  const p = sel ? providersStore().providers.find((x) => x.name === sel.name) : null;
  return (p && isVisionModel((p.model || '') + ' ' + (p.name || ''))) ? p : null;
}
// Screen-vision: the renderer captures the screen frame (native getDisplayMedia,
// user-granted) and passes it here; we run it through the connected vision model.
async function jarvisSee(question, image) {
  if (!image) return { ok: false, needs_capture: true, error: 'Open ABUZ8 and use "See my screen" — the app captures the frame with your permission, then I read it.' };
  const q = (question && question.trim()) ? question : 'Describe what is on this screen concisely, and flag anything actionable (errors, key numbers, next steps).';
  const sys = 'You are Jarvis, looking at the user\'s screen. ' + q + ' Be concise and useful.';
  // 1) A connected cloud vision model is fastest/strongest.
  const p = activeVisionProvider();
  if (p) { try { const ans = await callProviderVision(p, sys, image); return { ok: true, captured: true, source: 'vision:' + p.label, answer: String(ans).trim() }; } catch (e) { /* fall through to local */ } }
  // 2) The bundled local Gemma 3 vision brain — fully offline.
  if (visionBrainAvailable()) { try { const ans = await callLocalVision(sys, image); return { ok: true, captured: true, source: 'local:gemma-3-vision', answer: String(ans).trim() }; } catch (e) { return { ok: false, error: 'Local vision brain error: ' + e.message }; } }
  return { ok: true, captured: true, source: 'no-vision', answer: 'Your screen was captured, but no vision model is loaded yet. The local Gemma vision brain may still be installing — or connect a cloud vision model in Providers.' };
}
async function jarvisBrief() {
  const t = currentTimeContext();
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = (readJson(settingsPath(), {}).assistant_name) || 'ABUZ8';
  const lines = [`${greet}. It's ${t.time} on ${t.date}.`];
  const facts = ['time: ' + t.date + ' ' + t.time];
  try { const w = await getWeather({}); const c = w.current; const city = (w.location || {}).city || 'your area'; const tmr = w.forecast && w.forecast[1] ? `, and tomorrow looks ${w.forecast[1].sky} with a high of ${Math.round(w.forecast[1].hi)}${w.units}` : ''; lines.push(`In ${city} it's ${c.sky}, ${Math.round(c.temp)}${w.units}${tmr}.`); facts.push('weather'); } catch {}
  try { const ms = listMissionGraphs().filter((m) => m.status !== 'complete'); if (ms.length) { lines.push(`You have ${ms.length} active mission${ms.length > 1 ? 's' : ''}: ${ms.slice(0, 3).map((m) => m.title).join(', ')}.`); facts.push('missions'); } } catch {}
  try { if (await getValidToken('google')) { const ev = await connectorCall('gcal', 'events', { limit: 4 }); const it = (ev.items || []).map((e) => e.summary).filter(Boolean); if (it.length) { lines.push(`On your calendar: ${it.join(', ')}.`); facts.push('calendar'); } } } catch {}
  try { if (await getValidToken('google')) { const m = await connectorCall('gmail', 'list', { limit: 1, q: 'is:unread' }); if (m.resultSizeEstimate) { lines.push(`And you have about ${m.resultSizeEstimate} unread email${m.resultSizeEstimate > 1 ? 's' : ''}.`); facts.push('email'); } } } catch {}
  lines.push("What's the move?");
  return { ok: true, briefing: lines.join(' '), facts };
}
// Image → real 3D mesh via Tripo (or any image-to-3D connector). Returns a model URL.
async function jarvisImageTo3D(imageB64) {
  const key = connectorCreds('tripo').api_key;
  if (!key) return { ok: false, needs_auth: true, error: 'Connect an image-to-3D model in Providers/Connect (Tripo key) to turn a photo into a real mesh.' };
  try {
    const b64 = imageB64.replace(/^data:image\/\w+;base64,/, '');
    const up = JSON.parse(await fetchUrl('https://api.tripo3d.ai/v2/openapi/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ file: { type: 'jpg', data: b64 } }), timeout: 60000 }));
    const token = up.data && up.data.image_token; if (!token) return { ok: false, error: 'upload failed' };
    const task = JSON.parse(await fetchUrl('https://api.tripo3d.ai/v2/openapi/task', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'image_to_model', file: { type: 'jpg', file_token: token } }), timeout: 60000 }));
    return { ok: true, task_id: task.data && task.data.task_id, note: 'Tripo is generating the mesh — poll /api/jarvis/mesh-status.' };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function jarvisMeshStatus(taskId) {
  const key = connectorCreds('tripo').api_key; if (!key) return { ok: false, error: 'no key' };
  const r = JSON.parse(await fetchUrl('https://api.tripo3d.ai/v2/openapi/task/' + taskId, { headers: { Authorization: 'Bearer ' + key }, timeout: 30000 }));
  const d = r.data || {};
  return { ok: true, status: d.status, progress: d.progress, model_url: d.output && (d.output.pbr_model || d.output.model) };
}

/* ── OPERATOR — autonomous computer use (see → think → act loop) ──────────
   The most advanced capability: ABUZ8 looks at the screen, decides the single
   next action, and the renderer executes it via PyAutoGUI (gui_do) — then loops.
   The vision model returns resolution-independent (0-1000) coordinates so clicks
   land on the right element on any display. Consent-gated, step-capped, stoppable. */
async function operatorStep(goal, image, history) {
  const prompt = [
    'You are ABUZ8 OPERATOR — an AI that controls a Windows computer to accomplish a goal by looking at the screen and choosing exactly ONE next action.',
    'GOAL: ' + goal,
    'You are given the current screenshot. Treat the screen as a normalized 1000x1000 grid: (0,0) is top-left, (1000,1000) is bottom-right, regardless of resolution.',
    'Reply with ONLY compact JSON, no prose, no markdown:',
    '{"thought":"<one short sentence on what you see and your next move>","action":{"type":"click|double_click|right_click|type|key|hotkey|scroll|wait|done","nx":<int 0-1000>,"ny":<int 0-1000>,"text":"<text for type>","key":"<single key for key, e.g. enter|tab|esc>","keys":["ctrl","t"],"amount":<scroll, + up / - down>},"status":"continue|done|blocked"}',
    'Rules: click/double_click/right_click MUST include nx,ny aimed precisely at the target UI element. "type" types into whatever is focused — click the field in a prior step first. Use "key" for a single key, "hotkey" for combos. Set status "done" when the goal is visibly complete, "blocked" if you cannot proceed (explain in thought). Take the smallest reliable step.',
    history && history.length ? 'Actions already taken:\n' + history.slice(-8).map((h, i) => (i + 1) + '. ' + h).join('\n') : 'No actions taken yet.'
  ].join('\n\n');
  let out = null, src = null;
  const p = activeVisionProvider();
  if (p) { try { out = await callProviderVision(p, prompt, image); src = 'vision:' + p.label; } catch (e) {} }
  if (!out && visionBrainAvailable()) { try { out = await callLocalVision(prompt, image); src = 'local:gemma-3-vision'; } catch (e) {} }
  if (!out) return { ok: false, error: 'No vision model available — connect one in Providers, or the local vision brain is still loading.' };
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: 'Vision returned no action.', raw: String(out).slice(0, 200) };
  try { const j = JSON.parse(m[0]); return { ok: true, source: src, thought: j.thought || '', action: j.action || {}, status: j.status || 'continue' }; }
  catch (e) { return { ok: false, error: 'Could not parse the action.', raw: String(out).slice(0, 200) }; }
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
  return { ok: true, symbiote: installed.server, claude_config: installed.file, imported, status: bridgeStatus() };
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
      const openPaths = ['/', '/app', '/index.html', '/health', '/m', '/mobile', '/mobile.html', '/manifest.json', '/sw.js'];
      if (!openPaths.includes(pathname)) {
        const key = req.headers['x-abuz8-key'] || searchParams.get('key') || '';
        if (!s0.lan_token || key !== s0.lan_token) {
          return json(res, 401, { ok: false, error: 'This ABUZ8 instance requires the LAN access key. Open the /app link that includes ?key=…' });
        }
      }
    }
  } catch {}

  if (pathname === '/tui') return sendTui(res);
  // OAuth loopback redirect — the provider sends the user back here with ?code; we exchange it for tokens.
  if (pathname === '/oauth/callback') {
    const code = searchParams.get('code'); const state = searchParams.get('state'); const err = searchParams.get('error');
    const page = (title, msg) => `<!doctype html><meta charset=utf-8><title>${title}</title><body style="font-family:system-ui;background:#0b120e;color:#cfe;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:44px">${err ? '⚠️' : '✅'}</div><h2>${title}</h2><p style="opacity:.7">${msg}</p><p style="opacity:.5;font-size:13px">You can close this tab and return to ABUZ8.</p></div></body>`;
    if (err) return text(res, 200, page('Authorization cancelled', esc(err)), 'text/html; charset=utf-8');
    try { await oauthExchange(code, state); return text(res, 200, page('Connected — hands-free', 'Tokens stored. ABUZ8 will auto-refresh them from now on.'), 'text/html; charset=utf-8'); }
    catch (e) { return text(res, 200, page('Connection failed', esc(e.message)), 'text/html; charset=utf-8'); }
  }
  // Serve bundled vendor assets (MediaPipe vision: wasm, model .task, js bundle) for offline gesture/eye tracking.
  if (pathname.startsWith('/vendor/')) {
    const rel = pathname.replace(/^\/+/, '').replace(/\.\.+/g, '');
    const roots = [__dirname, process.resourcesPath ? path.join(process.resourcesPath, 'app.asar') : null].filter(Boolean);
    const MIME = { '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.json': 'application/json' };
    for (const root of roots) {
      const f = path.join(root, rel);
      try { if (fs.existsSync(f) && fs.statSync(f).isFile()) { const ext = path.extname(f).toLowerCase(); return binary(res, 200, fs.readFileSync(f), MIME[ext] || 'application/octet-stream'); } } catch {}
    }
    return json(res, 404, { ok: false, error: 'vendor asset not found: ' + rel });
  }
  if (pathname === '/health') {
    return json(res, 200, { ok: true, service: 'portable-core', port: PORT, data_root: dataRoot });
  }
  // Mobile companion PWA (installable web app for the phone, talks to this instance).
  if (pathname === '/m' || pathname === '/mobile' || pathname === '/mobile.html') {
    const html = readRendererAsset('mobile.html');
    if (html) return text(res, 200, html, 'text/html; charset=utf-8');
    return json(res, 404, { ok: false, error: 'mobile.html not found' });
  }
  if (pathname === '/manifest.json') { const j = readRendererAsset('manifest.json'); return j ? text(res, 200, j, 'application/manifest+json; charset=utf-8') : json(res, 404, { ok: false, error: 'no manifest' }); }
  if (pathname === '/sw.js') { const j = readRendererAsset('sw.js'); return j ? text(res, 200, j, 'text/javascript; charset=utf-8') : json(res, 404, { ok: false, error: 'no sw' }); }
  // Serve the dashboard over HTTP so a phone/tablet on the LAN can use it.
  if (pathname === '/' || pathname === '/app' || pathname === '/index.html') {
    const html = readRendererHtml();
    if (html) return text(res, 200, html, 'text/html; charset=utf-8');
    return json(res, 200, { ok: true, service: 'portable-core', note: 'Renderer not found on disk; use the desktop window.' });
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
    return json(res, 200, {
      ok: true,
      service: 'portable-core',
      primary_brain: embedded.embedded ? embedded.name : 'Portable Core',
      brain: embedded.embedded ? embedded.name : 'Portable Core',
      latency_ms: 1,
      memory_count: readMemory(200).length,
      data_root: dataRoot,
      mcp_config: mcpConfigPath(),
      embedded_brain: embedded,
      acceleration: lastBrainAccel,
      brain_alive: Boolean(lfmProcess) || Boolean(voiceProcess),
      brain_error: lastLfmError || null
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
      const r = await reasonReply(prompt, { provider: body.provider, role: body.role, brief: body.brief });
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
  if (pathname === '/api/system/scan') {
    return json(res, 200, await systemScan());
  }
  if (pathname === '/api/models/catalog') {
    return json(res, 200, await modelCatalog());
  }
  if (pathname === '/api/brain/accelerate') {
    pushActivity('plan', 'GPU unlock requested', 'downloading CUDA runtime…');
    const r = await unlockGpu();
    pushActivity(r.ok ? 'done' : 'observe', r.ok ? 'GPU unlocked' : 'GPU unlock failed', r.note || r.error || '');
    return json(res, 200, r);
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
  // ── Learn from Claude: import the claude.ai conversation export into memory ──
  if (pathname === '/api/bridge/learn/scan') {
    return json(res, 200, { ok: true, exports: scanForClaudeExport(), how: 'Export from claude.ai → Settings → Privacy → "Export data". Unzip it; conversations.json is inside. Drop it in Downloads, then Scan.' });
  }
  if (pathname === '/api/bridge/learn/import') {
    const body = await getBody(req);
    try {
      if (body.path) return json(res, 200, await importClaudeFromPath(body.path));
      if (body.json) return json(res, 200, await importClaudeConversations(body.json, {}));
      if (body.conversations) return json(res, 200, await importClaudeConversations(body.conversations, {}));
      return json(res, 400, { ok: false, error: 'Provide { path } to a conversations.json, or { json } with the export.' });
    } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // ── Second Brain (vault) ──
  if (pathname === '/api/vault/notes') return json(res, 200, { ok: true, notes: listVaultNotes() });
  if (pathname === '/api/vault/note') { const id = searchParams.get('id'); if (req.method === 'POST') { const body = await getBody(req); return json(res, 200, body.delete ? deleteVaultNote(body.id) : readVaultNote(body.id)); } return json(res, 200, readVaultNote(id)); }
  if (pathname === '/api/vault/ingest') { const body = await getBody(req); try { return json(res, 200, await vaultIngest(body)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/vault/ask') { const body = await getBody(req); try { return json(res, 200, await vaultAsk(body.q || body.question || '')); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  // ── Content Studio + HUD ──
  if (pathname === '/api/studio/image') { const body = await getBody(req); try { return json(res, 200, await studioImage(body.prompt || body.text || '', body)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/studio/article') { const body = await getBody(req); try { return json(res, 200, await studioArticle(body.keyword || body.topic || body.text || '')); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/hud') { try { return json(res, 200, await hudSnapshot()); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  // ── Messaging gateway (chat with ABUZ8 from Telegram) ──
  if (pathname === '/api/gateway/telegram') { if (req.method === 'POST') { const body = await getBody(req); if (body.token) { const s = readJson(settingsPath(), {}); s.tg_gateway_token = body.token; writeJson(settingsPath(), s); } return json(res, 200, setTgGateway(body.enable !== false)); } return json(res, 200, tgGatewayStatus()); }
  if (pathname === '/api/gateway/telegram/off') { return json(res, 200, setTgGateway(false)); }
  // ── Chat sessions ──
  if (pathname === '/api/sessions') { const q = searchParams.get('q'); return json(res, 200, { ok: true, sessions: q ? searchSessions(q) : listSessions() }); }
  if (pathname === '/api/session') {
    if (req.method === 'POST') { const body = await getBody(req); if (body.delete) return json(res, 200, deleteSessionById(body.delete)); if (body.rename && body.id) { const s = getSession(body.id); if (s) { s.title = body.rename; return json(res, 200, saveSession(s)); } return json(res, 404, { ok: false }); } return json(res, 200, saveSession(body.session || body)); }
    return json(res, 200, { ok: true, session: getSession(searchParams.get('id')) });
  }
  // ── Self-update ──
  if (pathname === '/api/update/check') { return json(res, 200, await checkUpdate()); }
  if (pathname === '/api/update/config') { const body = await getBody(req); const s = readJson(settingsPath(), {}); s.update_url = body.url || ''; writeJson(settingsPath(), s); return json(res, 200, { ok: true }); }
  if (pathname === '/api/version') { return json(res, 200, { ok: true, version: APP_VERSION }); }
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
    addMemoryVector(item).catch(() => {});
    return json(res, 200, { ok: true, item });
  }
  if (pathname === '/api/memory/index') {
    return json(res, 200, await indexAllMemories());
  }
  if (pathname === '/api/learn/run') {
    return json(res, 200, selfLearnOnce());
  }
  if (pathname === '/api/learn/skills') {
    return json(res, 200, { ok: true, learned: listLearnedSkills() });
  }
  if (pathname === '/api/classes') {
    return json(res, 200, { ok: true, active: activeClassId(), classes: AGENT_CLASSES.map((c) => ({ id: c.id, class: c.class, name: c.name, specialty: c.specialty, tagline: c.tagline, brain: c.brain, tools: c.tools, connectors: c.connectors })) });
  }
  if (pathname === '/api/classes/select') {
    const body = await getBody(req);
    const cls = resolveClass(body.id || body.class || '');
    const s = readJson(settingsPath(), {});
    s.active_class = cls ? cls.id : '';
    s.updated_at = new Date().toISOString();
    writeJson(settingsPath(), s);
    return json(res, 200, { ok: true, active: s.active_class, class: cls || null });
  }
  if (pathname === '/api/orchestrate') {
    const body = await getBody(req);
    try { return json(res, 200, await orchestrate(body.objective || body.goal || body.content, body)); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // ── Durable mission graph (resumable, approval-gated) ──
  if (pathname === '/api/missions') return json(res, 200, { ok: true, missions: listMissionGraphs() });
  if (pathname === '/api/missions/create') {
    const body = await getBody(req);
    return json(res, 200, { ok: true, mission: createMissionGraph(body.title, body.steps || []) });
  }
  if (pathname === '/api/missions/get') {
    const m = getMissionGraph(searchParams.get('id') || '');
    return json(res, m ? 200 : 404, m ? { ok: true, mission: m } : { ok: false, error: 'not found' });
  }
  if (pathname === '/api/missions/advance') {
    const body = await getBody(req);
    return json(res, 200, await advanceMissionGraph(body.id));
  }
  if (pathname === '/api/missions/run') {
    const body = await getBody(req);
    return json(res, 200, await runMissionToCompletion(body.id));
  }
  if (pathname === '/api/missions/approve') {
    const body = await getBody(req);
    return json(res, 200, approveMissionNode(body.id, body.node));
  }
  // ── Autonomy (scheduled / autonomous runs) ──
  if (pathname === '/api/autonomy/schedules') {
    if (req.method === 'POST') {
      const body = await getBody(req);
      return json(res, 200, { ok: true, schedule: createSchedule(body) });
    }
    return json(res, 200, { ok: true, schedules: readSchedules() });
  }
  if (pathname === '/api/autonomy/toggle') {
    const body = await getBody(req);
    const arr = readSchedules(); const it = arr.find((x) => x.id === body.id);
    if (it) { it.enabled = body.enabled !== false; writeSchedules(arr); }
    return json(res, 200, { ok: Boolean(it), schedule: it || null });
  }
  if (pathname === '/api/autonomy/delete') {
    const body = await getBody(req);
    writeSchedules(readSchedules().filter((x) => x.id !== body.id));
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/autonomy/run-now') {
    const body = await getBody(req);
    const it = readSchedules().find((x) => x.id === body.id);
    if (!it) return json(res, 404, { ok: false, error: 'schedule not found' });
    fireSchedule(it).catch(() => {});
    return json(res, 200, { ok: true, fired: it.name });
  }
  // ── Earn (the dead-simple money machine) ──
  if (pathname === '/api/earn/start') {
    const body = await getBody(req);
    const topic = String(body.topic || body.niche || 'AI automation tips').trim();
    const link = String(body.link || '').trim();
    const platforms = Array.isArray(body.platforms) ? body.platforms : (socialList().filter((p) => p.connected).map((p) => p.id));
    const every_min = Number(body.every_min) || 240;
    const sch = createSchedule({ name: 'Money machine: ' + topic, every_min, action: { kind: 'content_loop', payload: { topic, platforms, link } }, enabled: true });
    // Fire one post right now so they see it working immediately (best-effort).
    setTimeout(() => { const it = readSchedules().find((x) => x.id === sch.id); if (it) fireSchedule(it).catch(() => {}); }, 200);
    pushActivity('earn', 'Money machine started: ' + topic, platforms.join(', '));
    return json(res, 200, { ok: true, schedule: sch, platforms, posted_now: true });
  }
  if (pathname === '/api/earn/status') {
    const loops = readSchedules().filter((s) => s.action && s.action.kind === 'content_loop');
    let posts = 0; try { const lines = fs.readFileSync(signalFile(), 'utf8').trim().split('\n'); for (const ln of lines) { try { const s = JSON.parse(ln); if (s.kind === 'social_post') posts += (s.ok || 0); } catch {} } } catch {}
    const connected = socialList().filter((p) => p.connected).map((p) => p.label);
    return json(res, 200, { ok: true, running: loops.filter((l) => l.enabled).length, loops: loops.map((l) => ({ id: l.id, name: l.name, every_min: l.every_min, enabled: l.enabled, last_run: l.last_run, topic: (l.action.payload || {}).topic, link: (l.action.payload || {}).link })), posts, connected });
  }
  if (pathname === '/api/earn/stop') { const body = await getBody(req); const arr = readSchedules(); const it = arr.find((x) => x.id === body.id); if (it) { it.enabled = false; writeSchedules(arr); } return json(res, 200, { ok: true }); }
  // ── Vision & spatial awareness ──
  if (pathname === '/api/presence') {
    if (req.method === 'POST') {
      const body = await getBody(req);
      const r = updatePresence(body || {});
      return json(res, 200, { ok: true, presence: getPresence(), matched: r.matched });
    }
    return json(res, 200, { ok: true, presence: getPresence(), present: isUserPresent(), attentive: isUserAttentive() });
  }
  if (pathname === '/api/vision/gestures') {
    return json(res, 200, { ok: true, map: gestureMap() });
  }
  if (pathname === '/api/vision/gestures/set') {
    const body = await getBody(req);
    const s = readJson(settingsPath(), {});
    s.gesture_map = Object.assign({}, s.gesture_map || {}, body.map || {});
    writeJson(settingsPath(), s);
    return json(res, 200, { ok: true, map: gestureMap() });
  }
  // ── Connectors ──
  if (pathname === '/api/connectors') return json(res, 200, { ok: true, connectors: connectorList() });
  if (pathname === '/api/connectors/set') {
    const body = await getBody(req);
    if (!body.id || !CONNECTOR_DEFS[body.id]) return json(res, 400, { ok: false, error: 'unknown connector' });
    const cfg = readConnectors(); cfg[body.id] = Object.assign({}, cfg[body.id], body.creds || {}); writeConnectors(cfg);
    pushActivity('connect', 'Connector saved: ' + CONNECTOR_DEFS[body.id].label, '');
    return json(res, 200, { ok: true, test: await connectorTest(body.id) });
  }
  if (pathname === '/api/connectors/test') {
    const body = await getBody(req); return json(res, 200, { ok: true, id: body.id, result: await connectorTest(body.id) });
  }
  if (pathname === '/api/connectors/call') {
    const body = await getBody(req);
    try { return json(res, 200, { ok: true, data: await connectorCall(body.id, body.action, body.args || {}) }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/connectors/delete') {
    const body = await getBody(req); const cfg = readConnectors(); delete cfg[body.id]; writeConnectors(cfg);
    return json(res, 200, { ok: true });
  }
  // ── Fleet mesh ──
  if (pathname === '/api/mesh/whoami') return json(res, 200, { ok: true, id: 'self', service: 'abuz8-core', port: PORT, role: 'worker+control', classes: AGENT_CLASSES.length });
  if (pathname === '/api/mesh/nodes') {
    const m = readMesh();
    const withStatus = await Promise.all(m.nodes.map(async (n) => ({ ...n, ping: await meshPing(n) })));
    return json(res, 200, { ok: true, nodes: withStatus });
  }
  if (pathname === '/api/mesh/add') { const body = await getBody(req); if (!body.url) return json(res, 400, { ok: false, error: 'url required' }); return json(res, 200, { ok: true, node: meshAdd(body) }); }
  if (pathname === '/api/mesh/remove') { const body = await getBody(req); return json(res, 200, meshRemove(body.id)); }
  if (pathname === '/api/mesh/ping') { const body = await getBody(req); const n = readMesh().nodes.find((x) => x.id === body.id); if (!n) return json(res, 404, { ok: false, error: 'not found' }); return json(res, 200, { ok: true, ping: await meshPing(n) }); }
  if (pathname === '/api/mesh/dispatch') {
    const body = await getBody(req);
    try { return json(res, 200, { ok: true, result: await meshDispatch(body.id, body.task || body.content || '') }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  // ── Local account ──
  if (pathname === '/api/account/status') return json(res, 200, { ok: true, ...accountStatus() });
  if (pathname === '/api/account/setup') { const body = await getBody(req); try { accountSetup(body.username, body.password); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/account/login') { const body = await getBody(req); try { return json(res, 200, accountLogin(body.username, body.password)); } catch (e) { return json(res, 401, { ok: false, error: e.message }); } }
  // ── Provider catalog (Noah's Ark) ──
  if (pathname === '/api/providers') return json(res, 200, { ok: true, providers: providerCatalogList(), active: (readJson(settingsPath(), {}).active_provider) || null });
  if (pathname === '/api/providers/connect') {
    const body = await getBody(req);
    try { const e = catalogConnect(body.id, { api_key: body.api_key, model: body.model, endpoint: body.endpoint }); return json(res, 200, { ok: true, provider: { id: e.name, model: e.model }, test: await catalogTest(body.id) }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/providers/test') { const body = await getBody(req); return json(res, 200, { ok: true, id: body.id, result: await catalogTest(body.id) }); }
  if (pathname === '/api/providers/models') { const body = await getBody(req); return json(res, 200, await catalogModels(body.id)); }
  if (pathname === '/api/providers/select') { const body = await getBody(req); try { return json(res, 200, setActiveProvider(body.id, body.model)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/providers/use-native') { return json(res, 200, setActiveProvider(null)); }
  if (pathname === '/api/providers/disconnect') { const body = await getBody(req); return json(res, 200, catalogDisconnect(body.id)); }
  if (pathname === '/api/providers/detect') { return json(res, 200, { ok: true, engines: await detectLocalEngines() }); }
  // ── Social beacon ──
  if (pathname === '/api/social/platforms') return json(res, 200, { ok: true, platforms: socialList() });
  if (pathname === '/api/social/connect') { const body = await getBody(req); try { socialConnect(body.id, body.creds || {}); return json(res, 200, { ok: true, platforms: socialList() }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/social/disconnect') { const body = await getBody(req); return json(res, 200, socialDisconnect(body.id)); }
  if (pathname === '/api/social/post') { const body = await getBody(req); try { return json(res, 200, await socialPost(body.platforms || [], { text: body.text, link: body.link })); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/social/draft') { const body = await getBody(req); try { return json(res, 200, await socialDraft(body.topic || body.text || '', body.platform)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  // ── The Forge (holographic CAD / world builder) ──
  if (pathname === '/api/forge/interpret') { const body = await getBody(req); return json(res, 200, { ok: true, op: forgeInterpret(body.text || body.command || '') }); }
  if (pathname === '/api/forge/analyze') { const body = await getBody(req); try { return json(res, 200, await forgeAnalyze(body.image_base64 || body.image || '', body.hint || body.label || '')); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/forge/mesh') { const body = await getBody(req); try { return json(res, 200, await jarvisImageTo3D(body.image_base64 || body.image || '')); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/forge/mesh-status') { const body = await getBody(req); try { return json(res, 200, await jarvisMeshStatus(body.task_id)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  // ── Jarvis layer ──
  if (pathname === '/api/jarvis/see') { const body = await getBody(req); try { return json(res, 200, await jarvisSee(body.question || body.q || '', body.image_base64 || body.image || '')); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/jarvis/brief') { try { return json(res, 200, await jarvisBrief()); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/vision/local/status') { const vm = visionModelFiles(); return json(res, 200, { ok: true, installed: !!vm, running: !!visionProcess, port: VISION_PORT, model: vm ? path.basename(vm.llm) : null, accel: lastBrainAccel }); }
  if (pathname === '/api/vision/local/warm') { try { const ok = await ensureVisionBrain(); return json(res, 200, { ok, running: !!visionProcess }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  // ── Operator (autonomous computer use) ──
  if (pathname === '/api/operator/step') { const body = await getBody(req); try { return json(res, 200, await operatorStep(body.goal || '', body.image_base64 || body.image || '', body.history || [])); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  // ── Persistent OAuth ──
  if (pathname === '/api/oauth/status') return json(res, 200, { ok: true, providers: oauthStatus(), redirect_uri: oauthRedirectUri() });
  if (pathname === '/api/oauth/setup') { const body = await getBody(req); try { return json(res, 200, oauthSetupClient(body.provider, body.client_id, body.client_secret)); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/oauth/start') { const body = await getBody(req); try { const r = oauthStart(body.provider); return json(res, 200, { ok: true, ...r }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
  if (pathname === '/api/oauth/disconnect') { const body = await getBody(req); return json(res, 200, oauthDisconnect(body.provider)); }
  if (pathname === '/api/research') {
    const body = await getBody(req);
    try { return json(res, 200, await deepResearch(body.q || body.query || body.topic || searchParams.get('q') || '', Number(body.pages) || 3)); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (pathname === '/api/reflect') {
    const body = await getBody(req);
    const improved = await reflectAndImprove(body.goal || body.content || '', body.draft || '', body.context || '');
    return json(res, 200, { ok: true, improved });
  }
  if (pathname === '/api/memory/recall') {
    const q = searchParams.get('q') || '';
    return json(res, 200, { ok: true, results: await retrieveMemories(q, Number(searchParams.get('k') || 5)), engine: embedAvailable() ? 'vector' : 'keyword' });
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
  if (pathname === '/api/attachments') {
    return json(res, 200, attachmentsStatus());
  }
  if (pathname === '/api/voice/status' || pathname === '/api/tts/status') {
    const piper = piperAvailable();
    const piperVoices = piper ? listPiperVoices() : [];
    const winVoices = await listWindowsTtsVoices();
    const recognizers = await listWindowsSttRecognizers();
    const voices = [
      ...piperVoices.map((v) => ({ id: v.id, name: v.name, engine: 'piper', lang: v.lang, neural: true, arabic: v.arabic })),
      ...winVoices.map((v) => ({ id: v, name: v, engine: 'windows', neural: false }))
    ];
    return json(res, 200, {
      ok: true,
      voice_engine: piper ? 'piper-neural' : 'windows-sapi',
      neural_tts: piper,
      neural_stt: whisperAvailable(),
      native_tts: process.platform === 'win32' && winVoices.length > 0,
      browser_stt: true, browser_tts: true, streaming_chat_tts: true,
      presets: ['normal', 'calm', 'fast', 'narrator', 'cartoon'],
      recognizers, voices,
      note: piper ? 'Offline neural voice via Piper is active. Browser/Windows speech remain fallbacks.' : 'Install the Piper attachment for natural neural voices.'
    });
  }
  if (pathname === '/api/stt' || pathname === '/api/stt/transcribe') {
    const body = await getBody(req);
    const audio = body.audio_base64 || body.wav_base64 || body.audio || body.raw || '';
    const language = body.language || body.lang || 'auto'; // 'auto' detects Arabic/English/…; 'ar' forces Arabic
    try {
      const result = whisperAvailable() ? await transcribeWhisper(audio, language) : await transcribeWindowsStt(audio);
      return json(res, 200, { ok: true, ...result });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message, fallback: 'browser-stt' });
    }
  }
  if (pathname === '/api/tts' || pathname === '/api/tts/stream') {
    const body = await getBody(req);
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
function readRendererHtml() { return readRendererAsset('index.html'); }
function readRendererAsset(name) {
  const candidates = [
    path.join(__dirname, 'renderer', name),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'renderer', name) : null
  ].filter(Boolean);
  for (const f of candidates) { try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } catch {} }
  return null;
}

// Is the request from this machine (always trusted)?
function isLocalRequest(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// LAN URLs the phone can open (IPv4 non-internal interfaces), key embedded.
function lanUrls(key) {
  const q = key ? `?key=${key}` : '';
  // Phone-facing: point at the mobile companion (/m). The desktop dashboard (/app) stays local.
  const urls = [`http://127.0.0.1:${PORT}/m${q}`];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${PORT}/m${q}`);
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
  // Self-heal the two-way Claude Desktop symbiosis on every launch.
  try {
    const b = reinstateBridge();
    logFn(`claude bridge: symbiote ${b.symbiote ? 'installed' : 'present'}; imported ${b.imported.length} Claude MCP server(s).`);
  } catch (e) { logFn('claude bridge self-heal skipped: ' + e.message); }
  // Self-learning runs quietly in the background (Al-Buraq pattern) — never blocks.
  try { setInterval(() => { try { selfLearnOnce(); } catch {} }, 10 * 60 * 1000).unref?.(); } catch {}
  // Autonomy: check schedules every 60s and fire any that are due.
  try { setInterval(() => { schedulerTick().catch(() => {}); }, 60 * 1000).unref?.(); } catch {}
  // Auto-detect an NVIDIA GPU and self-accelerate (non-blocking; no-op on CPU-only machines).
  try { setTimeout(() => { maybeAutoAccelerate().catch(() => {}); }, 4000); } catch {}
  // Messaging gateway: poll Telegram for incoming chats when enabled (no-op otherwise).
  try { setInterval(() => { tgPollOnce().catch(() => {}); }, 3000).unref?.(); } catch {}
  return { port: PORT, dataRoot };
}

function stop() {
  if (server) server.close();
  server = null;
  if (lfmProcess) {
    try { lfmProcess.kill(); } catch {}
    lfmProcess = null;
  }
  if (embedProcess) {
    try { embedProcess.kill(); } catch {}
    embedProcess = null;
  }
  if (voiceProcess) {
    try { voiceProcess.kill(); } catch {}
    voiceProcess = null;
  }
  for (const [name, client] of mcpProcesses) {
    try { (client.proc || client).kill(); } catch {}
    mcpProcesses.delete(name);
  }
}

// ── SETTINGS / PROVIDERS HELPERS ──────────────────────────────
function settingsPath() { return path.join(dataRoot, 'config', 'settings.json'); }
function providersPath() { return path.join(dataRoot, 'config', 'providers.json'); }

async function callProviderChat(provider, prompt, system) {
  const endpoint = (provider.endpoint || '').replace(/\/+$/, '');
  const model = provider.model || 'default';
  const params = provider.parameters || { temperature: 0.7, max_tokens: 2048 };

  // Anthropic uses its own Messages API (x-api-key, /v1/messages, system is top-level).
  if (provider.type === 'anthropic') {
    const url = (endpoint || 'https://api.anthropic.com') + '/v1/messages';
    const headers = { 'Content-Type': 'application/json', 'x-api-key': provider.api_key || '', 'anthropic-version': '2023-06-01' };
    const body = JSON.stringify({ model, max_tokens: params.max_tokens || 2048, system: system || undefined, messages: [{ role: 'user', content: prompt }] });
    const data = JSON.parse(await fetchUrl(url, { method: 'POST', headers, body, timeout: provider.timeout || 60000 }));
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return (data.content && data.content[0] && data.content[0].text) || JSON.stringify(data);
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const isLm = provider.type === 'lmstudio' || endpoint.includes('localhost:1234') || endpoint.includes('127.0.0.1:1234');
  const base = isLm ? (endpoint || 'http://localhost:1234')
    : (provider.type === 'openai' || provider.type === 'hermes') ? (endpoint || 'https://api.openai.com/v1')
    : endpoint;
  // Prefer an explicit chat_url from the catalog; else derive (with /v1 de-dup).
  const url = provider.chat_url || `${base}/v1/chat/completions`.replace('/v1/v1/', '/v1/');
  const headers = { 'Content-Type': 'application/json' };
  if (provider.api_key) headers['Authorization'] = `Bearer ${provider.api_key}`;
  const body = JSON.stringify({ model, messages, temperature: params.temperature, max_tokens: params.max_tokens || 2048, stream: false });
  const resp = await fetchUrl(url, { method: 'POST', headers, body, timeout: provider.timeout || 60000 });
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
      timeout: opts.timeout || 30000
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(opts.binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString()));
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
  const proc = spawn(spec.command, spec.args || [], {
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
