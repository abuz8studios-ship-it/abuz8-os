// skill-loader.js — Hot-loading executable skill registry
// Auto-watches a skills directory; each skill is a .js file exporting { name, description, run(args) }
// The Standard brain can emit { type: 'new_skill', name, code } and we register it

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const skills = new Map();
let watcher = null;
let skillsRoot = null;

function loadSkillFile(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    if (!mod.name || typeof mod.run !== 'function') {
      return { ok: false, file: filePath, error: 'skill must export { name, run }' };
    }
    skills.set(mod.name, {
      name: mod.name,
      description: mod.description || '',
      file: filePath,
      run: mod.run,
      schema: mod.schema || {},
      loaded_at: new Date().toISOString()
    });
    return { ok: true, name: mod.name, file: filePath };
  } catch (e) {
    return { ok: false, file: filePath, error: e.message };
  }
}

function loadAllSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.js') && !entry.startsWith('_')) {
      const full = path.join(dir, entry);
      results.push(loadSkillFile(full));
    }
  }
  return results;
}

function startWatcher(dir, log = console.log) {
  skillsRoot = dir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (watcher) watcher.close();
  loadAllSkills(dir);
  log(`[skill-loader] watching ${dir}, loaded ${skills.size} skills`);
  watcher = fs.watch(dir, (eventType, filename) => {
    if (!filename || !filename.endsWith('.js') || filename.startsWith('_')) return;
    const full = path.join(dir, filename);
    if (fs.existsSync(full)) {
      const r = loadSkillFile(full);
      log(`[skill-loader] ${r.ok ? 'loaded' : 'failed'}: ${filename} ${r.error || ''}`);
    } else {
      for (const [name, s] of skills) {
        if (s.file === full) { skills.delete(name); log(`[skill-loader] unloaded: ${name}`); }
      }
    }
  });
  return watcher;
}

async function runSkill(name, args = {}, ctx = {}) {
  const skill = skills.get(name);
  if (!skill) throw new Error(`skill not found: ${name}`);
  return skill.run(args, ctx);
}

function listSkills() {
  return [...skills.values()].map((s) => ({
    name: s.name,
    description: s.description,
    schema: s.schema,
    loaded_at: s.loaded_at
  }));
}

function createSkillFromCode(name, code, options = {}) {
  if (!skillsRoot) throw new Error('skill-loader not initialized — call startWatcher first');
  if (!/^[a-z][a-z0-9_]{1,40}$/i.test(name)) throw new Error('invalid skill name');
  // Safety: forbid dangerous globals unless explicitly opted in
  const banned = ['child_process', 'execSync', 'fs.unlinkSync', 'process.exit'];
  if (!options.allow_unsafe) {
    for (const b of banned) {
      if (code.includes(b)) throw new Error(`skill code contains forbidden: ${b}`);
    }
  }
  const filePath = path.join(skillsRoot, `${name}.js`);
  fs.writeFileSync(filePath, code, 'utf8');
  return loadSkillFile(filePath);
}

module.exports = {
  startWatcher,
  loadAllSkills,
  listSkills,
  runSkill,
  createSkillFromCode,
  get size() { return skills.size; }
};
