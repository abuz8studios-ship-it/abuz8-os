// jarvis-overlay.js — sleek Jarvis voice/camera/skills control bar
(function () {
  if (window.jarvisOverlayInstalled) return;
  window.jarvisOverlayInstalled = true;

  const API_BASE = ''; // same origin

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function toast(msg, ms = 2500) {
    let t = document.querySelector('.jarvis-toast');
    if (!t) {
      t = el('div', { class: 'jarvis-toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms);
  }

  async function api(path, body) {
    const opts = { headers: { 'content-type': 'application/json' } };
    if (body) {
      opts.method = 'POST';
      opts.body = JSON.stringify(body);
    }
    try {
      const r = await fetch(API_BASE + path, opts);
      return await r.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function tag(via) {
    if (!via) return '';
    const lite = via.includes('lite') ? 'Lite' : null;
    const standard = via.includes('1.2b') || via.includes('tool') ? 'Standard' : null;
    const pro = via.includes('2.6b') || via.includes('pro') ? 'Pro' : null;
    return lite || standard || pro || via;
  }

  function addBrainPillToReply() {
    // Find last assistant/agent message and stamp it
    const lastMsg = document.querySelector('.chat .agent:last-of-type, [data-role="assistant"]:last-of-type, .message.agent:last-of-type');
    if (!lastMsg) return;
    if (lastMsg.querySelector('.jarvis-brain-pill')) return;
    const via = lastMsg._jarvisVia || 'auto';
    const pill = el('span', { class: 'jarvis-brain-pill' }, 'via ' + tag(via));
    lastMsg.appendChild(pill);
  }

  let voicesLoaded = false;
  let voiceSelect = null;
  let micBtn = null;
  let camBtn = null;
  let speakBtn = null;
  let listening = false;

  async function loadVoices() {
    if (voicesLoaded || !voiceSelect) return;
    const r = await api('/api/jarvis/voices');
    if (!r.ok || !r.voices) return;
    voicesLoaded = true;
    voiceSelect.innerHTML = '';
    // Default Aria first
    voiceSelect.appendChild(el('option', { value: 'en-US-AriaNeural' }, 'Aria (US English)'));
    for (const v of r.voices) {
      if (v.name === 'en-US-AriaNeural') continue;
      voiceSelect.appendChild(el('option', { value: v.name }, `${v.name.replace(/Neural$/, '')} (${v.locale})`));
    }
    toast(`Loaded ${r.count} voices`);
  }

  async function doListen() {
    if (listening) return;
    listening = true;
    micBtn.classList.add('active');
    toast('Listening for 5 seconds...');
    const r = await api('/api/jarvis/listen', { seconds: 5 });
    micBtn.classList.remove('active');
    listening = false;
    if (r.ok && r.text) {
      toast('Heard: ' + r.text);
      // Fill chat input if present
      const inp = document.querySelector('input[type=text], textarea[placeholder*=chat], textarea[placeholder*=message], #chat-input, .chat-input');
      if (inp) {
        inp.value = r.text;
        inp.focus();
      }
    } else {
      toast('Listen failed: ' + (r.error || 'no speech'));
    }
  }

  async function doSee() {
    camBtn.classList.add('active');
    toast('Looking through camera...');
    const r = await api('/api/jarvis/see', { task: '<MORE_DETAILED_CAPTION>' });
    camBtn.classList.remove('active');
    if (r.ok && r.result) {
      toast('Saw: ' + r.result.slice(0, 120));
      const inp = document.querySelector('input[type=text], textarea[placeholder*=chat], #chat-input, .chat-input');
      if (inp) { inp.value = '[camera] ' + r.result; inp.focus(); }
    } else {
      toast('Vision failed: ' + (r.error || 'no result'));
    }
  }

  async function doSpeak() {
    const text = prompt('Jarvis says...', 'Hello, I am Jarvis. At your service.');
    if (!text) return;
    speakBtn.classList.add('active');
    const r = await api('/api/jarvis/speak', { text, voice: voiceSelect.value, play: true });
    speakBtn.classList.remove('active');
    if (!r.ok) toast('Speak failed: ' + r.error);
  }

  function buildBar() {
    const bar = el('div', { class: 'jarvis-bar', id: 'jarvis-bar' });
    micBtn = el('button', { class: 'jarvis-btn', title: 'Listen (5s mic capture)', onclick: doListen }, '🎤');
    camBtn = el('button', { class: 'jarvis-btn', title: 'Look (camera + Florence-2)', onclick: doSee }, '👁');
    speakBtn = el('button', { class: 'jarvis-btn', title: 'Speak', onclick: doSpeak }, '🔊');
    voiceSelect = el('select', { class: 'jarvis-voice-pick', title: 'Voice profile' },
      el('option', { value: 'en-US-AriaNeural' }, 'Loading voices...'));
    voiceSelect.addEventListener('focus', loadVoices);
    bar.appendChild(micBtn);
    bar.appendChild(camBtn);
    bar.appendChild(speakBtn);
    bar.appendChild(voiceSelect);
    document.body.appendChild(bar);
  }

  // Intercept chat replies to mark which brain answered
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const r = await origFetch(input, init);
    try {
      if (url.includes('/api/chat') || url.includes('/api/route') || url.includes('/api/llm/chat')) {
        const clone = r.clone();
        clone.json().then((j) => {
          if (j && j.via) {
            setTimeout(() => {
              const lastMsg = document.querySelector('.chat .agent:last-of-type, [data-role="assistant"]:last-of-type, .message.agent:last-of-type');
              if (lastMsg) { lastMsg._jarvisVia = j.via; addBrainPillToReply(); }
            }, 100);
          }
        }).catch(() => {});
      }
    } catch {}
    return r;
  };

  function init() {
    if (!document.body) return setTimeout(init, 100);
    buildBar();
    // Auto-load voices in background
    setTimeout(loadVoices, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
