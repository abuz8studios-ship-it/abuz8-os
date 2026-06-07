// jarvis-integration.js — Wires voice/vision/skills into portable-core HTTP server
// Additive: never replaces existing endpoints, only adds new /api/jarvis/*

const path = require('path');
const fs = require('fs');
const edgeTts = require('./voice/edge-tts');
const stt = require('./voice/faster-whisper-stt');
const vision = require('./vision/florence-vision');
const skills = require('./skills/skill-loader');

// Track recent TTS files so we can serve them back over HTTP
const ttsFiles = new Map();
function trackTts(file) {
  const id = path.basename(file);
  ttsFiles.set(id, { file, ts: Date.now() });
  // Cleanup files older than 10 min
  for (const [k, v] of ttsFiles) {
    if (Date.now() - v.ts > 600000) {
      try { fs.unlinkSync(v.file); } catch {}
      ttsFiles.delete(k);
    }
  }
  return id;
}

function getDataRoot(core) {
  try {
    const cfg = core.getDataRoot ? core.getDataRoot() : null;
    if (cfg) return cfg;
  } catch {}
  return process.env.ABUZ8_DATA_DIR || path.join(process.env.APPDATA || process.env.HOME || '.', 'abuz8-os');
}

function installJarvisEndpoints(core, opts = {}) {
  const log = opts.log || ((m) => console.log('[jarvis] ' + m));
  const dataRoot = getDataRoot(core);
  const skillsDir = path.join(dataRoot, 'skills');
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
  // Seed a demo skill so users see one immediately
  const demoFile = path.join(skillsDir, 'hello_jarvis.js');
  if (!fs.existsSync(demoFile)) {
    fs.writeFileSync(demoFile, `
module.exports = {
  name: 'hello_jarvis',
  description: 'A simple demo skill that greets the user',
  schema: { type: 'object', properties: { name: { type: 'string' } } },
  async run(args) {
    return { ok: true, message: 'Hello ' + (args.name || 'Sir') + '. Jarvis at your service.' };
  }
};
`.trim(), 'utf8');
  }
  skills.startWatcher(skillsDir, log);
  log('jarvis layer installed: voice, vision, skills');
  return {
    handle: async (pathname, body, helpers) => {
      const { json, getBody } = helpers || {};
      // /api/jarvis/voices — list TTS voices
      if (pathname === '/api/jarvis/voices') {
        try {
          await edgeTts.ensureEdgeTts(log);
          const voices = await edgeTts.listVoices();
          return { ok: true, count: voices.length, voices };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      // /api/jarvis/speak — text → wav → play
      if (pathname === '/api/jarvis/speak') {
        const b = body || (getBody ? await getBody() : {});
        const text = b.text || b.content || '';
        if (!text) return { ok: false, error: 'missing text' };
        try {
          await edgeTts.ensureEdgeTts(log);
          const result = b.play ? await edgeTts.speakAndPlay(text, b) : await edgeTts.speak(text, b);
          const audioId = trackTts(result.file);
          return { ok: true, ...result, audio_url: `/api/jarvis/speak/audio?id=${encodeURIComponent(audioId)}` };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      // /api/jarvis/speak/audio?id=... — serve the WAV back so browsers can play it
      if (pathname === '/api/jarvis/speak/audio') {
        // Special raw response — caller must handle via helpers.raw
        return { ok: true, _raw: 'tts-stream', files: ttsFiles };
      }
      // /api/jarvis/listen/upload — accept WAV upload from browser MediaRecorder
      if (pathname === '/api/jarvis/listen/upload') {
        // Special raw response — caller will receive raw bytes via helpers.uploadStream
        return { ok: true, _raw: 'upload-stt' };
      }
      // /api/jarvis/listen — record + transcribe
      if (pathname === '/api/jarvis/listen') {
        const b = body || (getBody ? await getBody() : {});
        try {
          await stt.ensureFasterWhisper(log);
          let wav = b.file;
          if (!wav) {
            const rec = await stt.recordWav(b.seconds || 5);
            wav = rec.file;
          }
          const r = await stt.transcribe(wav, { model: b.model || 'base', language: b.language });
          return { ok: true, ...r, file: wav };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      // /api/jarvis/see — capture camera + describe with Florence-2
      if (pathname === '/api/jarvis/see') {
        const b = body || (getBody ? await getBody() : {});
        try {
          await vision.ensureFlorence(log);
          let img = b.file;
          if (!img) {
            const cap = await vision.captureCamera();
            img = cap.file;
          }
          const r = await vision.describe(img, { task: b.task });
          return { ok: true, ...r, file: img };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      // /api/jarvis/see/upload — accept image upload from browser camera/file
      if (pathname === '/api/jarvis/see/upload') {
        return { ok: true, _raw: 'upload-vision' };
      }
      // /api/jarvis/skills — list / create / run
      if (pathname === '/api/jarvis/skills') {
        return { ok: true, count: skills.size, skills: skills.listSkills() };
      }
      if (pathname === '/api/jarvis/skills/create') {
        const b = body || (getBody ? await getBody() : {});
        if (!b.name || !b.code) return { ok: false, error: 'missing name or code' };
        try {
          const r = skills.createSkillFromCode(b.name, b.code, { allow_unsafe: b.allow_unsafe });
          return r;
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      if (pathname === '/api/jarvis/skills/run') {
        const b = body || (getBody ? await getBody() : {});
        if (!b.name) return { ok: false, error: 'missing name' };
        try {
          const r = await skills.runSkill(b.name, b.args || {});
          return { ok: true, name: b.name, result: r };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      return null; // not a jarvis endpoint
    }
  };
}

module.exports = { installJarvisEndpoints };
