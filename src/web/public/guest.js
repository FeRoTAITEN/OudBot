// guest.js – T51: listen with a guest link, no login. Link: /guest.html#<token> (the fragment never reaches server logs).
// Same audio path as the dashboard: WebSocket Opus -> WebCodecs AudioDecoder -> AudioWorklet -> <audio> (keeps playing on phones).
(() => {
  const en = /^en/i.test(navigator.language || '');
  const T = en ? {
    play: '▶ Listen', stop: '■ Stop', connecting: 'Connecting…', live: 'Listening live', reconnecting: 'Reconnecting…',
    all: 'All rooms', main: 'Main room', until: 'Link valid until', unsupported: 'This browser cannot play it — update it or try Chrome',
    noToken: 'This link is incomplete — ask for a new one', foot: 'You are listening as a guest. People in the room see that a guest is listening.',
    err_expired: 'This link has expired or was cancelled', err_revoked: 'This link was cancelled', err_off: 'Web listening is off on this server',
    err_noguild: 'The bot is not in this server', err_busy: 'Too many listeners right now — try later', err_room: 'No bot in this room right now', failed: 'Could not connect',
    people: 'In the room', music: 'Music', reset: 'Reset', nobody: 'Nobody is talking in this room right now',
  } : {
    play: '▶ استمع', stop: '■ إيقاف', connecting: 'يتصل…', live: 'تستمع الحين مباشر', reconnecting: 'يعيد الاتصال…',
    all: 'كل الرومات', main: 'الروم الرئيسي', until: 'الرابط شغال لين', unsupported: 'متصفحك ما يدعم الاستماع — حدّثه أو جرّب Chrome',
    noToken: 'الرابط ناقص — اطلب رابط جديد', foot: 'تستمع كضيف. اللي في الروم يشوفون إن فيه ضيف يستمع.',
    err_expired: 'الرابط انتهى أو انلغى', err_revoked: 'الرابط انلغى', err_off: 'الاستماع من الويب مقفل في هذا السيرفر',
    err_noguild: 'البوت مو موجود في هذا السيرفر', err_busy: 'المستمعين كثير الحين — جرّب بعدين', err_room: 'هذا الروم ما فيه بوت الحين', failed: 'تعذّر الاتصال',
    people: 'اللي في الروم', music: 'الأغاني', reset: 'إعادة', nobody: 'ما فيه أحد يتكلم في هذا الروم الحين',
  };
  if (en) { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; }
  const $ = (id) => document.getElementById(id);
  const token = decodeURIComponent(location.hash.slice(1));
  const S = { ws: null, ctx: null, node: null, el: null, dec: null, ts: 0, sel: 'all', rooms: [], want: false, retry: 0, t: null, last: 0, openAt: 0, wd: null, live: false, members: [], spk: new Set(), vol: {}, volT: null };
  const VOL_KEY = `oudgvol:${token.split('.')[0]}`;
  try { const v = JSON.parse(localStorage.getItem(VOL_KEY) || '{}'); if (v && typeof v === 'object') S.vol = v; } catch { /* private mode */ }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AVATAR_OK = /^https:\/\/cdn\.discordapp\.com\//;

  // T66: people in the room with their own volume slider (only this listener hears the change).
  function volRow(key, label, avatar) {
    const v = Math.round((S.vol[key] ?? 1) * 100);
    const img = key === 'music' ? '<span class="g-av">🎵</span>'
      : avatar && AVATAR_OK.test(avatar) ? `<img class="g-av" src="${esc(avatar)}" alt="" loading="lazy">`
        : `<span class="g-av">${esc([...String(label || '?').trim()][0] || '?')}</span>`;
    return `<div class="g-row${S.spk.has(String(key)) ? ' spk' : ''}" data-vrow="${esc(key)}">${img}<span class="g-name" dir="auto">${esc(label)}</span><input type="range" min="0" max="200" step="10" value="${v}" data-vkey="${esc(key)}" aria-label="${esc(label)}"><span class="g-val">${v}%</span></div>`;
  }
  function people() {
    const box = $('g-people');
    if (!S.want || S.sel === 'main') { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const rows = [volRow('music', T.music, null)].concat(S.members.map(m => volRow(m.id, m.name, m.avatar)));
    box.innerHTML = `<div class="g-ph"><b>${esc(T.people)} · ${S.members.length}</b><button type="button" class="g-reset" data-vreset>${esc(T.reset)}</button></div>${rows.join('')}${S.members.length ? '' : `<div class="g-empty">${esc(T.nobody)}</div>`}`;
  }
  function volSend() {
    clearTimeout(S.volT);
    S.volT = setTimeout(() => {
      try { localStorage.setItem(VOL_KEY, JSON.stringify(S.vol)); } catch { /* private mode */ }
      try { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ vol: S.vol })); } catch { /* closed */ }
    }, 250);
  }
  const supported = () => typeof AudioDecoder === 'function' && typeof AudioWorkletNode === 'function' && typeof WebSocket === 'function';

  function status(text, bad) { const s = $('g-status'); s.textContent = text || ''; s.classList.toggle('bad', Boolean(bad)); }
  function ui() {
    const b = $('g-btn');
    b.textContent = S.want ? T.stop : T.play;
    b.classList.toggle('stop', S.want);
    $('g-eq').hidden = !(S.want && S.live);
    const sel = $('g-room');
    sel.hidden = S.rooms.length < 2;
    sel.innerHTML = '';
    for (const r of S.rooms) {
      const o = document.createElement('option');
      o.value = r.sel;
      o.textContent = r.sel === 'all' ? T.all : r.sel === 'main' ? `${T.main}${r.channel ? ` · ${r.channel}` : ''}` : `#${r.name}${r.channel ? ` · ${r.channel}` : ''}`;
      o.selected = r.sel === S.sel;
      sel.appendChild(o);
    }
  }
  function media() {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata !== 'function') return;
    try {
      if (!S.want) { ms.metadata = null; ms.playbackState = 'none'; return; }
      ms.metadata = new MediaMetadata({ title: $('g-title').textContent || 'Oud', artist: 'Oud', artwork: [{ src: '/logo.svg', sizes: '512x512', type: 'image/svg+xml' }] });
      ms.playbackState = 'playing';
      ms.setActionHandler('pause', stop);
      ms.setActionHandler('stop', stop);
    } catch { /* unsupported */ }
  }

  async function ctxInit() {
    if (!S.ctx) {
      S.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await S.ctx.audioWorklet.addModule('/listen-worklet.js');
      S.node = new AudioWorkletNode(S.ctx, 'oud-listen', { outputChannelCount: [2] });
      try {
        const dest = S.ctx.createMediaStreamDestination();
        S.node.connect(dest);
        S.el = new Audio();
        S.el.srcObject = dest.stream;
        await S.el.play();
      } catch {
        S.el = null;
        try { S.node.disconnect(); } catch { /* not connected */ }
        S.node.connect(S.ctx.destination);
      }
    }
    if (S.ctx.state !== 'running') await S.ctx.resume();
    if (S.el?.paused) await S.el.play().catch(() => {});
  }
  function decoder(flush = true) {
    try { S.dec?.close(); } catch { /* closed */ }
    if (flush) S.node?.port.postMessage('flush');
    S.ts = 0;
    S.dec = new AudioDecoder({
      output: (ad) => {
        const n = ad.numberOfFrames;
        const l = new Float32Array(n);
        const r = new Float32Array(n);
        ad.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
        if (ad.numberOfChannels > 1) ad.copyTo(r, { planeIndex: 1, format: 'f32-planar' }); else r.set(l);
        ad.close();
        S.node?.port.postMessage([l, r], [l.buffer, r.buffer]);
      },
      error: () => {},
    });
    S.dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
  }
  function connect() {
    clearTimeout(S.t);
    if (!S.want) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/listen/ws?k=${encodeURIComponent(token)}&sel=${encodeURIComponent(S.sel)}`);
    ws.binaryType = 'arraybuffer';
    S.ws = ws;
    ws.onopen = () => {
      S.openAt = performance.now();
      clearInterval(S.wd);
      S.wd = setInterval(() => {
        if (S.ws !== ws) { clearInterval(S.wd); return; }
        if (performance.now() - Math.max(S.last, S.openAt) > 8000) { try { ws.close(); } catch { /* closed */ } }
      }, 2000);
    };
    ws.onmessage = (e) => {
      if (S.ws !== ws) return;
      if (typeof e.data === 'string') {
        let m = {};
        try { m = JSON.parse(e.data); } catch { /* ignore */ }
        if (Array.isArray(m.spk)) {
          S.spk = new Set(m.spk.map(String));
          for (const r of document.querySelectorAll('#g-people [data-vrow]')) r.classList.toggle('spk', S.spk.has(r.dataset.vrow));
          return;
        }
        if (Array.isArray(m.members)) { S.members = m.members; people(); }
        if (Array.isArray(m.rooms) && Object.keys(S.vol).length) { try { ws.send(JSON.stringify({ vol: S.vol })); } catch { /* closed */ } }
        if (Array.isArray(m.rooms)) S.rooms = m.rooms;
        if (m.guild) { $('g-title').textContent = m.guild; document.title = `Oud · ${m.guild}`; }
        if (m.exp) {
          const d = new Date(m.exp);
          $('g-sub').textContent = `${m.label ? `${m.label} · ` : ''}${T.until} ${d.toLocaleString(en ? 'en-GB' : 'ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' })}`;
        }
        if (m.error) { S.want = false; status(T[`err_${m.error}`] || `${T.failed} — ${m.error}`, true); }
        ui();
        media();
        return;
      }
      S.retry = 0;
      S.last = performance.now();
      if (!S.live) { S.live = true; status(T.live); ui(); }
      if (!S.dec || S.dec.state === 'closed') decoder(false);
      const b = new Uint8Array(e.data);
      let o = 0;
      while (o + 2 <= b.length) {
        const n = (b[o] << 8) | b[o + 1];
        o += 2;
        const f = b.subarray(o, o + n);
        o += n;
        try { S.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: S.ts, data: f })); } catch { /* bad frame */ }
        S.ts += 20000;
      }
    };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.ws = null;
      clearInterval(S.wd);
      if (!S.want) { stop(true); return; }
      if (++S.retry > 40) { status(T.failed, true); stop(true); return; }
      S.live = false;
      status(T.reconnecting);
      ui();
      S.t = setTimeout(connect, Math.min(5000, 500 * S.retry));
    };
  }
  async function start() {
    if (!supported()) { status(T.unsupported, true); return; }
    S.want = true;
    S.retry = 0;
    S.live = false;
    status(T.connecting);
    ui();
    try { await ctxInit(); } catch { status(T.unsupported, true); S.want = false; ui(); return; }
    decoder();
    connect();
    media();
    people();
  }
  function stop(keepStatus) {
    S.want = false;
    S.live = false;
    clearTimeout(S.t);
    clearInterval(S.wd);
    const ws = S.ws;
    S.ws = null;
    try { ws?.close(); } catch { /* closed */ }
    try { S.dec?.close(); } catch { /* closed */ }
    S.dec = null;
    S.node?.port.postMessage('flush');
    S.ctx?.suspend().catch(() => {});
    try { S.el?.pause(); } catch { /* none */ }
    if (keepStatus !== true) status('');
    S.members = [];
    S.spk = new Set();
    ui();
    media();
    people();
  }

  $('g-foot').textContent = T.foot;
  $('g-btn').addEventListener('click', () => { if (S.want) stop(); else start(); });
  $('g-room').addEventListener('change', (ev) => {
    S.sel = ev.target.value;
    S.members = [];
    S.spk = new Set();
    people();
    if (!S.want) return;
    const old = S.ws;
    S.ws = null;
    try { old?.close(); } catch { /* closed */ }
    S.live = false;
    decoder();
    connect();
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el?.matches?.('[data-vkey]')) return;
    const k = el.dataset.vkey;
    const v = Math.max(0, Math.min(200, Number(el.value) || 0)) / 100;
    if (v === 1) delete S.vol[k]; else S.vol[k] = v;
    const lab = el.parentElement?.querySelector('.g-val');
    if (lab) lab.textContent = `${Math.round(v * 100)}%`;
    volSend();
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target?.closest?.('[data-vreset]')) return;
    S.vol = {};
    volSend();
    people();
  });
  window.addEventListener('online', () => { if (S.want && !S.ws) { clearTimeout(S.t); S.retry = 0; connect(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !S.want) return;
    if (S.ctx && S.ctx.state !== 'running') S.ctx.resume().catch(() => {});
    if (S.el?.paused) S.el.play().catch(() => {});
  });
  if (!/^[0-9a-f]{8}\.[A-Za-z0-9_-]{32}$/.test(token)) { $('g-btn').disabled = true; status(T.noToken, true); }
  ui();
})();
