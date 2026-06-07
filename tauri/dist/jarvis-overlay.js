// jarvis-overlay.js — sleek Jarvis control bar (mic, camera, voice, brain pill)
// Browser-native: uses MediaRecorder for mic + getUserMedia for camera
(function () {
  if (window.jarvisOverlayInstalled) return;
  window.jarvisOverlayInstalled = true;

  const API = '';

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

  function toast(msg, ms = 2800) {
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
      const r = await fetch(API + path, opts);
      return await r.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function tagPill(via) {
    if (!via) return '';
    if (via.includes('lite') || via.includes('350m')) return 'Lite';
    if (via.includes('1.2b') || via.includes('tool')) return 'Standard';
    if (via.includes('2.6b') || via.includes('pro')) return 'Pro';
    return via;
  }

  function addBrainPillToReply(via) {
    const lastMsg = document.querySelector('.chat .agent:last-of-type, [data-role="assistant"]:last-of-type, .message.agent:last-of-type');
    if (!lastMsg || lastMsg.querySelector('.jarvis-brain-pill')) return;
    const pill = el('span', { class: 'jarvis-brain-pill' }, 'via ' + tagPill(via));
    lastMsg.appendChild(pill);
  }

  let voicesLoaded = false;
  let voiceSelect, micBtn, camBtn, speakBtn;
  let mediaRecorder = null;
  let audioChunks = [];
  let listening = false;

  async function loadVoices() {
    if (voicesLoaded || !voiceSelect) return;
    const r = await api('/api/jarvis/voices');
    if (!r.ok || !r.voices || !r.voices.length) return;
    voicesLoaded = true;
    voiceSelect.innerHTML = '';
    const defaults = ['en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural', 'en-GB-LibbyNeural', 'en-GB-RyanNeural'];
    for (const d of defaults) {
      const v = r.voices.find((x) => x.name === d);
      if (v) voiceSelect.appendChild(el('option', { value: v.name }, `${v.short_name} (${v.locale}, ${v.gender})`));
    }
    voiceSelect.appendChild(el('option', { value: '__sep', disabled: 'disabled' }, '── all voices ──'));
    for (const v of r.voices) {
      if (defaults.includes(v.name)) continue;
      voiceSelect.appendChild(el('option', { value: v.name }, `${v.short_name} (${v.locale}, ${v.gender})`));
    }
    toast(`Loaded ${r.count} voices`);
  }

  async function startMicCapture() {
    if (listening) { return stopMicCapture(); }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Mic capture not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        toast('Transcribing...');
        try {
          const r = await fetch(API + '/api/jarvis/listen/upload', {
            method: 'POST',
            headers: { 'content-type': 'audio/webm' },
            body: blob
          });
          const j = await r.json();
          if (j.ok && j.text) {
            toast('Heard: ' + j.text);
            const inp = document.querySelector('input[type=text], textarea[placeholder*=chat], textarea[placeholder*=message], #chat-input, .chat-input, [contenteditable="true"]');
            if (inp) {
              if (inp.isContentEditable) inp.textContent = j.text;
              else inp.value = j.text;
              inp.focus();
            }
          } else {
            toast('Transcribe failed: ' + (j.error || 'no speech'));
          }
        } catch (e) {
          toast('Upload failed: ' + e.message);
        }
      };
      mediaRecorder.start();
      listening = true;
      micBtn.classList.add('active');
      toast('Listening... click again to stop');
      setTimeout(() => {
        if (listening) stopMicCapture();
      }, 8000);
    } catch (e) {
      toast('Mic permission denied: ' + e.message);
    }
  }

  function stopMicCapture() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    listening = false;
    micBtn.classList.remove('active');
  }

  async function captureCameraFrame() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera not supported');
      return;
    }
    camBtn.classList.add('active');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 700)); // let autofocus catch up
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d').drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      toast('Looking at frame...');
      const r = await fetch(API + '/api/jarvis/see/upload', {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: blob
      });
      const j = await r.json();
      camBtn.classList.remove('active');
      if (j.ok && j.result) {
        const caption = typeof j.result === 'string' ? j.result : JSON.stringify(j.result).slice(0, 200);
        toast('Saw: ' + caption.slice(0, 100));
        const inp = document.querySelector('input[type=text], textarea[placeholder*=chat], textarea[placeholder*=message], #chat-input, .chat-input, [contenteditable="true"]');
        if (inp) {
          const text = '[camera] ' + caption;
          if (inp.isContentEditable) inp.textContent = text;
          else inp.value = text;
          inp.focus();
        }
      } else {
        toast('Vision failed: ' + (j.error || 'no caption') + ' (model may be downloading)');
      }
    } catch (e) {
      camBtn.classList.remove('active');
      toast('Camera failed: ' + e.message);
    }
  }

  async function speakNow() {
    const text = prompt('Jarvis says...', 'Hello sir. Jarvis is online and ready.');
    if (!text) return;
    speakBtn.classList.add('active');
    const r = await api('/api/jarvis/speak', { text, voice: voiceSelect.value });
    speakBtn.classList.remove('active');
    if (r.ok && r.audio_url) {
      const audio = new Audio(r.audio_url);
      audio.play().catch((e) => toast('Playback blocked: ' + e.message));
    } else {
      toast('Speak failed: ' + (r.error || 'unknown'));
    }
  }

  function buildBar() {
    const bar = el('div', { class: 'jarvis-bar', id: 'jarvis-bar' });
    micBtn = el('button', { class: 'jarvis-btn', title: 'Listen (mic capture + STT)', onclick: startMicCapture }, '🎤');
    camBtn = el('button', { class: 'jarvis-btn', title: 'Look (camera + Florence-2 vision)', onclick: captureCameraFrame }, '👁');
    speakBtn = el('button', { class: 'jarvis-btn', title: 'Speak (Edge-TTS, 326 voices)', onclick: speakNow }, '🔊');
    voiceSelect = el('select', { class: 'jarvis-voice-pick', title: 'Voice profile' },
      el('option', { value: 'en-US-AriaNeural' }, 'Loading voices...'));
    voiceSelect.addEventListener('focus', loadVoices);
    bar.appendChild(micBtn);
    bar.appendChild(camBtn);
    bar.appendChild(speakBtn);
    bar.appendChild(voiceSelect);
    document.body.appendChild(bar);
  }

  // Intercept fetch to tag chat replies with which brain answered
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const r = await origFetch(input, init);
    try {
      if (url && (url.includes('/api/chat') || url.includes('/api/route') || url.includes('/api/llm/chat'))) {
        const clone = r.clone();
        clone.json().then((j) => {
          if (j && j.via) {
            setTimeout(() => addBrainPillToReply(j.via), 120);
          }
        }).catch(() => {});
      }
    } catch {}
    return r;
  };

  function init() {
    if (!document.body) return setTimeout(init, 100);
    buildBar();
    setTimeout(loadVoices, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
