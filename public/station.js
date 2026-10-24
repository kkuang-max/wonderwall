// Wonder Wall — the sticker station. Runs on a phone/tablet mounted next to the wall,
// or on a visitor's own phone when they scan a sticker's QR with their camera app.
(() => {
  const $ = (id) => document.getElementById(id);
  const SESSION_SECS = 30;   // research: keep each interaction to ~15–30 s
  let current = null;        // { sticker, summary, used: Set }
  let lastRead = { id: null, t: 0 };
  let sessionEnd = 0, tick = null, anim = null;

  // ---------- helpers ----------
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

  // ---------- reading a sticker ----------
  async function handleCode(raw, source) {
    const s = typeof raw === 'object' ? raw : WW.parseSticker(raw);
    if (!s) { toast('That doesn’t look like a Wonder Wall sticker.'); buzz([40, 60, 40]); return; }
    if (current && current.sticker.id === s.id) return;                 // already playing with it
    if (lastRead.id === s.id && Date.now() - lastRead.t < 5000) return; // reader bounce
    lastRead = { id: s.id, t: Date.now() };
    try {
      const res = await post('/api/tap', { sticker: s.id, source });
      buzz(60);
      startPlay(res);
    } catch (e) { toast(e.message); }
  }

  // ---------- play screen ----------
  function startPlay(res) {
    current = { sticker: res.sticker, summary: res.summary, used: new Set() };
    const s = res.sticker, c = WW.CHARS[s.char];
    $('helloTitle').textContent = res.isNew ? c.name + ' #' + s.num + ' jumped onto the wall!' : 'Welcome back, ' + c.name + ' #' + s.num + '!';
    $('helloSub').textContent = res.isNew ? 'Your sticker’s friend is out there now. Give it something to do.' : 'Visit ' + s.visits + '. Your friend remembers you.';
    renderActions();
    renderTogether(res.summary);
    showWhere(res.summary.scene);
    $('idle').hidden = true; $('play').hidden = false;
    window.scrollTo(0, 0);
    sessionEnd = Date.now() + SESSION_SECS * 1000;
    clearInterval(tick); tick = setInterval(updateRing, 200); updateRing();
    cancelAnimationFrame(anim); animateMe();
  }

  function renderActions() {
    const box = $('actions'); box.innerHTML = '';
    const sum = current.summary;
    for (const id of Object.keys(WW.ACTIONS)) {
      const a = WW.actionInfo(id, sum.scene);
      const unlocked = sum.actions.includes(id);
      const b = document.createElement('button');
      b.className = 'act' + (unlocked ? '' : ' locked') + (current.used.has(id) ? ' done' : '');
      let sub = '';
      if (!unlocked) {
        const m = sum.milestones.find((x) => x.id === a.needs);
        sub = '🔒 Unlocks at ' + m.at + ' taps';
      } else if (id === 'dance' || id === 'firework') sub = 'Everyone on the wall sees it';
      b.innerHTML = '<span class="e">' + (unlocked ? a.emoji : '🔒') + '</span><span class="l">' + a.label + '</span>' + (sub ? '<small>' + sub + '</small>' : '');
      b.disabled = !unlocked;
      b.setAttribute('aria-label', a.label + (unlocked ? '' : ', locked'));
      b.onclick = () => doAction(id, b);
      box.appendChild(b);
    }
    const left = WW.MAX_ACTIONS_PER_TAP - (current.sticker.actions || 0) - current.used.size;
    $('left').textContent = left > 0 ? left + ' move' + (left === 1 ? '' : 's') + ' left this tap' : 'All moves used. Look up!';
  }

  async function doAction(id, btn) {
    if (!current) return;
    btn.disabled = true;
    try {
      const r = await post('/api/action', { sticker: current.sticker.id, action: id });
      current.used.add(id);
      current.summary = r.summary;
      buzz(30);
      toast(WW.actionInfo(id, r.summary.scene).emoji + ' Look at the wall!');
      sessionEnd = Math.max(sessionEnd, Date.now() + 10000);
      if (r.actionsLeft <= 0) {
        renderActions();
        [...$('actions').children].forEach((b) => (b.disabled = true));
        $('left').textContent = 'All moves used. Look up!';
        sessionEnd = Math.min(sessionEnd, Date.now() + 6000);
        return;
      }
      current.sticker.actions = 0; // counted locally via `used`
      renderActions();
    } catch (e) { toast(e.message); btn.disabled = false; }
  }

  function renderTogether(sum) {
    const next = sum.next;
    if (!next) { $('together').innerHTML = '<b>' + sum.visits + ' taps tonight.</b> Everything’s unlocked. Thank you!'; return; }
    const ms = sum.milestones, i = ms.findIndex((m) => m.id === next.id);
    const prev = i > 0 ? ms[i - 1].at : 0;
    const pct = Math.max(0, Math.min(100, ((sum.visits - prev) / (next.at - prev)) * 100));
    const left = next.at - sum.visits;
    const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    $('together').innerHTML = '<b>Everyone together: ' + plural(sum.visits, 'tap') + '</b> from ' + plural(sum.friends, 'sticker friend') + '.<br>' +
      left + ' more from anyone unlocks <b>' + next.title.replace(/ unlocked| woke up!/i, '') + '</b>.' +
      '<div class="bar"><i style="width:' + pct.toFixed(0) + '%"></i></div>';
  }

  function updateRing() {
    const left = Math.max(0, sessionEnd - Date.now());
    $('ringArc').setAttribute('stroke-dashoffset', String(100.5 * (1 - left / (SESSION_SECS * 1000))));
    if (left <= 0) endPlay();
  }

  function endPlay() {
    clearInterval(tick); cancelAnimationFrame(anim);
    if (current) toast(WW.CHARS[current.sticker.char].name + ' will hang out on the wall for a few minutes.');
    current = null;
    $('play').hidden = true; $('idle').hidden = false;
  }
  $('doneBtn').onclick = endPlay;

  function animateMe() {
    const c = $('me'), g = c.getContext('2d');
    const t0 = performance.now();
    const loop = (now) => {
      if (!current) return;
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, c.width, c.height);
      const ch = current.sticker.char;
      const bob = -Math.abs(Math.sin(t * 3)) * 14;
      g.fillStyle = 'rgba(42,30,50,.08)';
      g.beginPath(); g.ellipse(180, 300, 70, 14, 0, 0, Math.PI * 2); g.fill();
      WW.drawChar(g, ch, 180, 200 + bob, ch === 'koi' ? 80 : 90, t, { seed: 3, flying: ch === 'bird', walking: true });
      anim = requestAnimationFrame(loop);
    };
    anim = requestAnimationFrame(loop);
  }

  // ---------- input: real NFC (Web NFC, Android Chrome) ----------
  function setupNfc() {
    const isIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!('NDEFReader' in window) && isIPhone) {
      // iOS has no Web NFC, but iPhones read NFC tags natively: a sticker written with its
      // station URL (see stickers.html) opens this page with ?s=<code> when held to the phone.
      $('nfcNote').textContent = 'On iPhone, hold the sticker near the top of the phone, then tap the banner that appears.';
      return;
    }
    if (!('NDEFReader' in window)) {
      $('nfcNote').textContent = window.isSecureContext
        ? 'Not supported on this device. Web NFC works in Chrome on Android.'
        : 'Needs HTTPS. Open the https:// address on Android Chrome.';
      return;
    }
    $('nfcNote').textContent = 'Tap “Turn on”, then hold a sticker to the back of this phone.';
    $('nfcBtn').hidden = false;
    $('nfcBtn').onclick = async () => {
      try {
        const reader = new NDEFReader();
        await reader.scan();
        $('nfcBtn').hidden = true;
        $('nfcNote').innerHTML = '<span class="status-on">● Listening for stickers</span>';
        reader.onreading = (e) => {
          for (const rec of e.message.records) {
            if (['url', 'absolute-url', 'text'].includes(rec.recordType)) {
              const txt = new TextDecoder(rec.encoding || 'utf-8').decode(rec.data);
              const s = WW.parseSticker(txt);
              if (s) return handleCode(s, 'nfc');
            }
          }
          // Blank or foreign tag: use its serial number so any NFC sticker works.
          if (e.serialNumber) handleCode(WW.stickerFromSerial(e.serialNumber), 'nfc');
        };
        reader.onreadingerror = () => toast('Couldn’t read that sticker. Try holding it still.');
      } catch (err) { $('nfcNote').textContent = 'NFC permission was blocked: ' + err.message; }
    };
  }

  // ---------- input: real QR via camera ----------
  let stream = null;
  async function startCamera() {
    if (stream) { stopCamera(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('camNote').textContent = 'Camera needs HTTPS on phones. Open the https:// address.'; return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) { $('camNote').textContent = 'Camera blocked: ' + e.message; return; }
    const v = $('video'); v.srcObject = stream; await v.play();
    $('camWrap').hidden = false; $('camBtn').textContent = 'Stop';
    $('camNote').innerHTML = '<span class="status-on">● Looking for a sticker QR</span>';
    let detector = null;
    if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch {} }
    const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    const scan = async () => {
      if (!stream) return;
      if (!current && v.readyState >= 2) {
        let text = null;
        try {
          if (detector) { const codes = await detector.detect(v); if (codes[0]) text = codes[0].rawValue; }
          else {
            const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
            cv.width = w; cv.height = h; g.drawImage(v, 0, 0, w, h);
            const r = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (r) text = r.data;
          }
        } catch { detector = null; }
        if (text) handleCode(text, 'qr');
      }
      setTimeout(scan, 250);
    };
    scan();
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; $('camWrap').hidden = true; $('camBtn').textContent = 'Use camera';
    $('camNote').textContent = 'Uses this device’s camera';
  }
  $('camBtn').onclick = startCamera;

  // ---------- input: typed code (accessibility fallback) ----------
  $('typed').onsubmit = (e) => { e.preventDefault(); handleCode($('code').value, 'typed'); $('code').value = ''; $('code').blur(); };

  // ---------- input: simulated taps (clearly labelled) ----------
  function setupSim() {
    const grid = $('simgrid');
    for (const id of WW.CHAR_IDS) {
      const b = document.createElement('button');
      const c = document.createElement('canvas'); c.width = 112; c.height = 112;
      WW.drawChar(c.getContext('2d'), id, 56, 60, id === 'koi' ? 26 : 30, 1, { seed: 1 });
      b.appendChild(c);
      b.appendChild(document.createTextNode(WW.CHARS[id].name));
      b.onclick = () => handleCode(id + '-' + (1 + Math.floor(Math.random() * 12)), 'simulated');
      grid.appendChild(b);
    }
  }

  // ---------- arriving from a sticker link (QR scanned by the phone's own camera app, or NFC URL) ----------
  const linked = new URLSearchParams(location.search).get('s');
  if (linked) {
    history.replaceState(null, '', location.pathname);
    handleCode(linked, 'link');
  }

  function showWhere(scene) {
    const sc = WW.SCENES[scene];
    if (sc) $('where').textContent = '· ' + sc.icon + ' ' + sc.name;
  }
  fetch('/api/state').then((r) => r.json()).then((s) => showWhere(s.scene)).catch(() => {});

  setupNfc();
  setupSim();
})();
