// Wonder Wall — the shared world. Runs on the big screen / projector.
//
// Many people can stand at the wall at once. Interaction is three wordless gestures:
//   1. Raise a hand    → the characters nearest to it gather around it (each follows its nearest hand).
//   2. Hold it still   → that group settles and glows in the hand's color.
//   3. Bring two hands close → a thread of light joins them; sparks cross and both groups jump together.
// A tap/click sends a ripple. Characters never speak: they react with motion and light only.
// The mouse (and every touch point) stands in for a tracked hand; "Simulate crowd" adds simulated hands.
(() => {
  const cvs = document.getElementById('world');
  const ctx = cvs.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const LIFETIME = 180;          // seconds a character stays after its tap (matches server ACTIVE_MS)
  const MAX_ACTORS = 36;
  const MAX_ITEMS_SHOWN = 240, MAX_LANTERNS_SHOWN = 60;
  const HAND_COLORS = ['#7ad7ff', '#ff8ad8', '#ffd36e', '#8affc1', '#b79bff'];
  const ITEM_COLORS = ['#ff7eb6', '#ffd36e', '#9d8bff', '#7ad7ff', '#8affc1', '#ff9f6e'];

  let W = 0, H = 0, scenery = null;
  let state = { scene: 'market', visits: 0, unlocked: [], actions: [], flowers: [], lanterns: [], milestones: [], next: null };
  const actors = new Map();
  const hands = new Map();
  const bridges = new Map();
  const fx = [];
  const newItems = new Map();
  let skyMix = 0, danceUntil = 0, bigFriendT = -1, time = 0, handSeq = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const font = (px, w) => (w || 300) + ' ' + px + 'px Outfit, system-ui, sans-serif';
  const rgba = (hex, a) => 'rgba(' + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',') + ',' + a + ')';

  // ---------- layout ----------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cvs.width = W * dpr; cvs.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScenery();
    for (const a of actors.values()) placeLane(a, a.depth);
  }

  function buildScenery() {
    const tents = [];
    const n = Math.max(4, Math.round(W / 220));
    for (let i = 0; i < n; i++) tents.push({ x: (i + .5) * (W / n) + rand(-25, 25), w: rand(90, 150), h: rand(H * .07, H * .12) });
    const stars = Array.from({ length: 110 }, () => ({ x: Math.random() * W, y: Math.random() * H * .55, r: rand(.4, 1.3), p: Math.random() * 6 }));
    const motes = Array.from({ length: 50 }, () => ({ x: Math.random() * W, y: rand(H * .2, H * .95), r: rand(.6, 1.8), p: Math.random() * 6, v: rand(4, 12) }));
    const crowd = [];
    for (let x = -10; x < W + 20; x += rand(14, 22)) crowd.push({ x, r: rand(7, 11), p: Math.random() * 6, phone: Math.random() < .12 });
    scenery = { tents, stars, motes, crowd, horizon: H * .64 };
  }

  function placeLane(a, depth) {
    a.depth = depth;
    const move = WW.CHARS[a.char].move;
    if (move === 'fly') { a.homeY = H * lerp(.22, .44, depth); a.size = H * lerp(.026, .036, depth); }
    else if (move === 'swim') { a.homeY = H * lerp(.36, .54, depth); a.size = H * lerp(.026, .038, depth); }
    else { a.homeY = H * lerp(.72, .84, depth); a.size = H * lerp(.03, .046, depth); }
    a.baseY = a.homeY;
  }

  // ---------- hands ----------
  // Each hand keeps a raw position (what the sensor/mouse reports) and a smoothed one that
  // everything follows, so jittery input never makes characters twitch.
  function addHand(id, x, y, sim) {
    let h = hands.get(id);
    if (!h) {
      h = { id, x, y, rx: x, ry: y, ax: x, ay: y, vx: 0, vy: 0, sim, color: HAND_COLORS[handSeq++ % HAND_COLORS.length], lastMove: time, alpha: 0 };
      hands.set(id, h);
    }
    return h;
  }
  function moveHand(h, x, y) {
    h.rx = x; h.ry = y;
    if (Math.hypot(x - h.ax, y - h.ay) > 8) { h.lastMove = time; h.ax = x; h.ay = y; } // ignore tiny tremors
  }
  const handActive = (h) => time - h.lastMove < 10;
  const handStill = (h) => time - h.lastMove > 1.2;
  const followersOf = (h) => [...actors.values()].filter((a) => a.handId === h.id);
  function hopLater(a, delay) { a.hopAt = time + delay; }

  function tapHand(h) {
    fx.push({ kind: 'ripple', x: h.rx, y: h.ry, color: h.color, life: 1.1, max: 1.1 });
    for (const a of followersOf(h)) hopLater(a, Math.abs(a.slot) * .06);
  }

  cvs.addEventListener('pointermove', (e) => {
    const h = addHand('p' + e.pointerId, e.clientX, e.clientY, false);
    moveHand(h, e.clientX, e.clientY);
    if (Math.random() < .25) fx.push({ kind: 'mote', x: h.x + rand(-6, 6), y: h.y + rand(-6, 6), vy: -rand(10, 30), r: rand(1, 2.2), color: h.color, life: .7, max: .7 });
  });
  cvs.addEventListener('pointerdown', (e) => {
    const h = addHand('p' + e.pointerId, e.clientX, e.clientY, false);
    moveHand(h, e.clientX, e.clientY); h.lastMove = time;
    tapHand(h);
  });
  const dropPointer = (e) => hands.delete('p' + e.pointerId);
  cvs.addEventListener('pointerleave', dropPointer);
  cvs.addEventListener('pointercancel', dropPointer);
  cvs.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') dropPointer(e); });

  // Simulated people: two hands that wander on springs, and every so often drift together to meet.
  function updateHands(dt) {
    if (!crowdOn) { for (const [id, h] of hands) if (h.sim) hands.delete(id); }
    else {
      const meeting = Math.floor(time / 12) % 2 === 1;
      for (let i = 0; i < 2; i++) {
        const id = 'sim' + i;
        let h = hands.get(id);
        if (!h) { h = addHand(id, W * (.25 + .5 * i), H * .72, true); h.tx = h.rx; h.ty = h.ry; h.retarget = 0; }
        h.retarget -= dt;
        if (h.retarget <= 0) {
          if (meeting) { h.tx = W * .5 + (i ? 1 : -1) * W * .045; h.ty = H * .7; h.retarget = rand(3, 5); }
          else { h.tx = rand(W * .1, W * .9); h.ty = rand(H * .5, H * .85); h.retarget = rand(3, 6); }
        }
        h.vx += ((h.tx - h.rx) * 2.2 - h.vx * 2.4) * dt;
        h.vy += ((h.ty - h.ry) * 2.2 - h.vy * 2.4) * dt;
        moveHand(h, h.rx + h.vx * dt, h.ry + h.vy * dt);
      }
    }
    const k = Math.min(1, dt * 9);
    for (const h of hands.values()) { h.x += (h.rx - h.x) * k; h.y += (h.ry - h.y) * k; }
  }

  // ---------- camera hand tracking (MediaPipe Hand Landmarker, runs in the browser) ----------
  // Each visible index fingertip becomes a hand, exactly like the mouse: characters gather at it.
  // Pinching thumb and index together works like a click (ripple + hop).
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/';
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const CAM_MARGIN = .12;   // reach the wall's edges without stretching to the camera's edges
  let cam = null, camSeq = 0, camStarting = false;

  function camStatus(text) { $('camStatus').textContent = text; }

  async function startCamera() {
    if (cam || camStarting) return;
    camStarting = true;
    $('cam').hidden = false; $('camBtn').setAttribute('aria-pressed', 'true');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera needs https:// or localhost');
      camStatus('Asking for the camera…');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      const video = $('camVideo'); video.srcObject = stream; await video.play();
      camStatus('Loading hand tracking…');
      const vision = await import(MP + 'vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(MP + 'wasm');
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: 'VIDEO', numHands: 4,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5 });
      let landmarker;
      try { landmarker = await vision.HandLandmarker.createFromOptions(files, opts('GPU')); }
      catch { landmarker = await vision.HandLandmarker.createFromOptions(files, opts('CPU')); }
      cam = { stream, video, landmarker, lastDetect: 0, lastVideoTime: -1 };
      camStatus('Point a finger at the wall');
    } catch (e) {
      camStatus('Camera unavailable: ' + (e && e.name === 'NotAllowedError' ? 'permission was blocked' : (e && e.message) || e));
      stopCamera(true);
    } finally { camStarting = false; }
  }

  function stopCamera(keepStatus) {
    if (cam) { cam.stream.getTracks().forEach((t) => t.stop()); try { cam.landmarker.close(); } catch {} }
    else { const v = $('camVideo'); if (v.srcObject) v.srcObject.getTracks().forEach((t) => t.stop()); }
    $('camVideo').srcObject = null;
    cam = null;
    for (const [id, h] of hands) if (h.cam) hands.delete(id);
    $('camBtn').setAttribute('aria-pressed', 'false');
    if (!keepStatus) $('cam').hidden = true;
  }
  $('camBtn').onclick = () => (cam || camStarting ? stopCamera() : startCamera());

  function updateCamera() {
    if (!cam || cam.video.readyState < 2) return;
    const now = performance.now();
    if (now - cam.lastDetect < 33 || cam.video.currentTime === cam.lastVideoTime) return;  // ~30 detections/s
    cam.lastDetect = now; cam.lastVideoTime = cam.video.currentTime;
    let res;
    try { res = cam.landmarker.detectForVideo(cam.video, now); } catch (e) { console.error(e); return; }

    const tips = (res.landmarks || []).map((lm) => {
      const tip = lm[8], thumb = lm[4], wrist = lm[0], knuckle = lm[9];
      const nx = clamp((tip.x - CAM_MARGIN) / (1 - 2 * CAM_MARGIN), 0, 1);
      const ny = clamp((tip.y - CAM_MARGIN) / (1 - 2 * CAM_MARGIN), 0, 1);
      const handSize = Math.hypot(wrist.x - knuckle.x, wrist.y - knuckle.y) || .1;
      return { x: (1 - nx) * W, y: ny * H, pinch: Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / handSize };
    });

    // Keep identities stable: match each fingertip to the nearest camera hand from last frame.
    const pool = [...hands.values()].filter((h) => h.cam);
    for (const t of tips) {
      let best = null, bd = Math.max(W * .25, 120);
      for (const h of pool) { const d = Math.hypot(h.rx - t.x, h.ry - t.y); if (d < bd) { bd = d; best = h; } }
      let h = best;
      if (h) pool.splice(pool.indexOf(h), 1);
      else { h = addHand('cam' + camSeq++, t.x, t.y, false); h.cam = true; h.pinched = false; }
      moveHand(h, t.x, t.y);
      h.seenAt = now;
      const pinched = h.pinched ? t.pinch < .45 : t.pinch < .3;   // hysteresis so one pinch = one tap
      if (pinched && !h.pinched) tapHand(h);
      h.pinched = pinched;
    }
    // Drop hands that left the frame (wall-clock, so a stalled render loop can't keep them alive); never keep more than 4.
    const camHands = [...hands.values()].filter((h) => h.cam).sort((p, q) => q.seenAt - p.seenAt);
    camHands.forEach((h, i) => { if (now - h.seenAt > 600 || i >= 4) hands.delete(h.id); });
    camStatus(tips.length ? tips.length + ' hand' + (tips.length > 1 ? 's' : '') + ' · pinch to tap' : 'Point a finger at the wall');
  }

  // Two people's hands close together → a light bridge with sparks crossing it.
  function updateBridges(dt) {
    const hs = [...hands.values()].filter(handActive), seen = new Set();
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      const h1 = hs[i], h2 = hs[j], key = h1.id + '|' + h2.id;
      if (Math.hypot(h1.x - h2.x, h1.y - h2.y) > W * .18) continue;
      seen.add(key);
      const b = bridges.get(key) || { a: 0, cd: .6, h1: h1.id, h2: h2.id };
      b.a = Math.min(1, b.a + dt * 2);
      b.cd -= dt;
      if (b.cd <= 0) {
        b.cd = 2.4;
        fx.push({ kind: 'bridgeSpark', h1: h1.id, h2: h2.id, dir: Math.random() < .5, dur: .9, life: 2, max: 2,
          done: () => {
            for (const id of [h1.id, h2.id]) { const h = hands.get(id); if (h) for (const a of followersOf(h)) hopLater(a, Math.abs(a.slot) * .07); }
            const m = bridgeMid(h1, h2); burst(m[0], m[1], '#ffffff', 16);
          } });
      }
      bridges.set(key, b);
    }
    for (const [key, b] of bridges) {
      if (seen.has(key)) continue;
      b.a -= dt * 2;
      if (b.a <= 0 || !hands.has(b.h1) || !hands.has(b.h2)) bridges.delete(key);
    }
  }
  const bridgeCtrl = (h1, h2) => [(h1.x + h2.x) / 2, Math.min(h1.y, h2.y) - Math.hypot(h1.x - h2.x, h1.y - h2.y) * .45 - 20];
  const bridgeMid = (h1, h2) => quad(h1, h2, .5);
  function quad(h1, h2, t) {
    const [cx, cy] = bridgeCtrl(h1, h2), u = 1 - t;
    return [u * u * h1.x + 2 * u * t * cx + t * t * h2.x, u * u * h1.y + 2 * u * t * cy + t * t * h2.y];
  }

  // ---------- actors ----------
  function upsertActor(st, opts) {
    opts = opts || {};
    let a = actors.get(st.id);
    if (a) {
      a.age = Math.max(0, (Date.now() - st.lastSeen) / 1000);
      a.leaving = false; a.fade = 1; a.visits = st.visits;
      if (!opts.quiet) { hop(a); a.pulse = 1; fx.push({ kind: 'ripple', x: a.x, y: a.y, color: WW.CHARS[a.char].color, life: 1, max: 1 }); }
      return a;
    }
    const staying = [...actors.values()].filter((x) => !x.leaving).sort((x, y) => y.age - x.age);
    if (staying.length >= MAX_ACTORS) staying[0].leaving = true;
    if (actors.size >= MAX_ACTORS + 8) {
      const gone = [...actors.values()].filter((x) => x.leaving).sort((x, y) => x.fade - y.fade)[0];
      if (gone) actors.delete(gone.id);
    }
    a = {
      id: st.id, char: st.char, num: st.num, visits: st.visits, seed: hash(st.id) % 100,
      x: rand(W * .08, W * .92), y: 0, vx: 0, dir: Math.random() < .5 ? -1 : 1,
      age: Math.max(0, (Date.now() - (st.lastSeen || Date.now())) / 1000),
      pop: opts.quiet ? 1 : 0, hopT: 0, hopAt: 0, pulse: 0, joinedAt: 0, slot: 0, slotHand: null, greetCd: rand(4, 10), leaving: false, fade: 1, pause: 0, handId: null,
    };
    placeLane(a, Math.random());
    a.y = a.baseY;
    actors.set(st.id, a);
    if (!opts.quiet) {
      a.pulse = 1;
      burst(a.x, a.baseY, WW.CHARS[a.char].color, 22);
      fx.push({ kind: 'ripple', x: a.x, y: a.baseY, color: WW.CHARS[a.char].color, life: 1.2, max: 1.2 });
    }
    return a;
  }
  function hop(a) { a.hopT = 0.6; }

  const GROUP_MAX = 7;   // a hand gathers at most this many characters; the rest keep roaming
  const SLOT_ORDER = [0, -1, 1, -2, 2, -3, 3, -4, 4];

  function updateActors(dt) {
    const speedBase = W * 0.018;
    const dancing = time < danceUntil;
    const live = [...hands.values()].filter(handActive);
    const reach = W * .24;
    const distTo = (a, h) => {
      const m = WW.CHARS[a.char].move;
      return m === 'fly' || m === 'swim' ? Math.hypot(h.x - a.x, (h.y - a.y) * .6) : Math.abs(h.x - a.x);
    };

    // 1. Who wants which hand: nearest within reach, but stay loyal to the current hand unless
    //    another is clearly closer, and never switch more than once every 1.5 s.
    const wants = new Map();
    for (const a of actors.values()) {
      a.wantHand = null;
      if (a.leaving || dancing) continue;
      let best = null, bd = reach;
      for (const h of live) { const d = distTo(a, h); if (d < bd) { bd = d; best = h; } }
      const cur = a.handId && hands.get(a.handId);
      if (cur && handActive(cur)) {
        const dc = distTo(a, cur);
        if (dc < reach * 1.3 && (best === cur || !best || bd > dc * .6 || time - a.joinedAt < 1.5)) { best = cur; bd = dc; }
      }
      if (best) { a.wantHand = best.id; a.wantDist = bd; (wants.get(best.id) || wants.set(best.id, []).get(best.id)).push(a); }
    }
    // 2. Each hand keeps its current members first, then the closest newcomers, up to GROUP_MAX.
    for (const a of actors.values()) if (!a.wantHand) a.handId = null;
    for (const [hid, list] of wants) {
      list.sort((p, q) => (p.handId === hid ? 0 : 1) - (q.handId === hid ? 0 : 1) || p.wantDist - q.wantDist);
      const used = new Set();
      list.forEach((a, i) => {
        if (i >= GROUP_MAX) { a.handId = null; return; }
        if (a.handId !== hid) { a.handId = hid; a.joinedAt = time; a.slotHand = null; }
        if (a.slotHand === hid && !used.has(a.slot)) used.add(a.slot);
        else a.slotHand = null;
      });
      // newcomers take the nearest free slot; existing members keep theirs (no reshuffling)
      for (const a of list.slice(0, GROUP_MAX)) {
        if (a.slotHand === hid) continue;
        a.slot = SLOT_ORDER.find((sl) => !used.has(sl)); used.add(a.slot); a.slotHand = hid;
      }
    }

    for (const a of actors.values()) {
      a.age += dt;
      a.pop = Math.min(1, a.pop + dt * 2.2);
      a.greetCd -= dt;
      a.hopT = Math.max(0, a.hopT - dt);
      a.pulse = Math.max(0, a.pulse - dt * 1.1);
      if (a.hopAt && time >= a.hopAt) { a.hopAt = 0; hop(a); a.pulse = 1; }
      const move = WW.CHARS[a.char].move;
      const airborne = move === 'fly' || move === 'swim';
      const speed = speedBase * (move === 'fly' ? 1.8 : move === 'swim' ? 0.9 : 1) * (0.7 + a.depth * 0.6);
      let want = a.wander || 0, accel = 4;

      if (!a.leaving && a.age > LIFETIME) a.leaving = true;
      if (a.leaving) {
        a.fade -= dt * .5; a.baseY -= dt * 20; want = 0;
        if (a.fade <= 0) { actors.delete(a.id); continue; }
      } else if (dancing) {
        want = 0;
      } else if (a.handId) {
        const h = hands.get(a.handId);
        const dx = h.x + a.slot * a.size * 1.6 - a.x;
        want = clamp(dx * 2.2, -speed * 4.5, speed * 4.5);   // slows naturally as it arrives
        accel = 6;
        if (airborne) {
          const band = move === 'fly' ? [H * .14, H * .62] : [H * .26, H * .64];
          const ty = clamp(h.y - a.size * 2 - Math.abs(a.slot) * a.size * .6, band[0], band[1]);
          a.baseY += (ty - a.baseY) * Math.min(1, dt * 2);
        }
        if (handStill(h) && Math.random() < dt * .7) {
          fx.push({ kind: 'mote', x: a.x + rand(-a.size, a.size), y: a.y - a.size * .5, vy: -rand(15, 35), r: rand(1.2, 2.4), color: h.color, life: 1.6, max: 1.6 });
        }
      } else {
        if (airborne) a.baseY += (a.homeY - a.baseY) * Math.min(1, dt * .8);
        a.pause -= dt;
        if (a.pause <= 0 && Math.random() < dt * 0.3) {
          if (Math.random() < 0.35) { a.wander = 0; a.pause = rand(1.5, 4); }
          else a.wander = (Math.random() < .5 ? -1 : 1) * speed * rand(.5, 1);
          want = a.wander;
        }
        if (a.x < W * .04) want = a.wander = Math.abs(a.wander || speed * .6);
        if (a.x > W * .96) want = a.wander = -Math.abs(a.wander || speed * .6);
      }
      a.vx += (want - a.vx) * Math.min(1, dt * accel);    // ease into every speed change
      a.x += a.vx * dt;
      if (Math.abs(a.vx) > speed * .3) a.dir = Math.sign(a.vx);
      else if (a.handId) { const h = hands.get(a.handId); if (Math.abs(h.x - a.x) > a.size * .5) a.dir = h.x > a.x ? 1 : -1; }

      let off = 0;
      if (dancing) off = -Math.abs(Math.sin(time * 7 + a.seed)) * a.size * .7;
      else if (move === 'hop') off = -Math.abs(Math.sin(time * 5 + a.seed)) * a.size * .5 * clamp(Math.abs(a.vx) / speed, 0, 1);
      else if (move === 'fly') off = Math.sin(time * 2 + a.seed) * a.size * .7;
      else if (move === 'swim') off = Math.sin(time * 1.5 + a.seed) * a.size * .5;
      if (a.hopT > 0) off -= Math.sin((a.hopT / .6) * Math.PI) * a.size * 1.1;
      a.y = a.baseY + off;
    }

    // Free-roaming characters that bump into each other trade a small glint.
    const free = [...actors.values()].filter((a) => !a.leaving && a.pop >= 1 && !a.handId);
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (a.greetCd > 0 || b.greetCd > 0) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < (a.size + b.size) * 1.7) {
        a.greetCd = b.greetCd = rand(14, 24);
        a.dir = b.x > a.x ? 1 : -1; b.dir = -a.dir;
        hop(a); hop(b); a.pulse = b.pulse = 1;
        burst((a.x + b.x) / 2, Math.min(a.y, b.y) - a.size, '#ffffff', 8);
      }
    }
  }

  // ---------- effects ----------
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = rand(50, 190);
      fx.push({ kind: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 90, drag: 1.2, life: rand(.6, 1.1), max: 1.1, color, r: rand(1.2, 2.8) });
    }
  }
  function firework(color) {
    const x = rand(W * .15, W * .85), y = rand(H * .1, H * .32);
    fx.push({ kind: 'rocket', tx: x, ty: y, life: .9, max: .9, color });
  }
  function explode(x, y, color) {
    const cols = [color, '#ffffff', '#ffd36e'];
    for (let i = 0; i < 80; i++) {
      const ang = (i / 80) * Math.PI * 2, sp = rand(140, 260);
      fx.push({ kind: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 60, drag: 1.6, life: rand(1.2, 1.9), max: 1.9, color: cols[i % 3], r: rand(1.2, 2.4) });
    }
  }

  function updateFx(dt) {
    if (fx.length > 600) fx.splice(0, fx.length - 600);
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.life -= dt;
      if (p.kind === 'rocket') {
        const k = 1 - p.life / p.max;
        p.x = p.tx; p.cy = lerp(H * .66, p.ty, 1 - Math.pow(1 - k, 2));
        if (p.life <= 0) explode(p.tx, p.ty, p.color);
      } else if (p.kind === 'seed' || p.kind === 'lanternRise' || p.kind === 'bridgeSpark') {
        p.k = Math.min(1, (p.k || 0) + dt / p.dur);
      } else if (p.kind !== 'ripple') {
        if (p.drag) { p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt); }
        p.vy = (p.vy || 0) + (p.g || 0) * dt;
        p.x += (p.vx || 0) * dt; p.y += p.vy * dt;
      }
      if (p.life <= 0 || p.k >= 1) { if (p.done) p.done(); fx.splice(i, 1); }
    }
  }

  // ---------- server events ----------
  function applySummary(s) {
    if (!s) return;
    Object.assign(state, { visits: s.visits, unlocked: s.unlocked, actions: s.actions, milestones: s.milestones, next: s.next, event: s.event });
    renderHud();
  }

  function onEvent(evt) {
    if (evt.type === 'reset' || evt.type === 'scene') return loadState();
    if (evt.type === 'join') { applySummary(evt.summary); upsertActor(evt.sticker); $('empty').classList.add('hide'); }
    else if (evt.type === 'action') {
      const a = actors.get(evt.sticker.id) || upsertActor(evt.sticker);
      a.age = Math.min(a.age, 30);
      const sx = a.x, sy = a.y - a.size;
      a.pulse = 1;
      switch (evt.action) {
        case 'wave': hop(a); fx.push({ kind: 'ripple', x: a.x, y: a.y, color: WW.CHARS[a.char].color, life: 1, max: 1 }); break;
        case 'flower': {
          const f = evt.flower;
          fx.push({ kind: 'seed', x0: sx, y0: sy, f, dur: 1.1, life: 2, max: 2, done: () => { state.flowers.push(f); newItems.set(f, time); } });
          break;
        }
        case 'lantern': {
          const l = evt.lantern;
          fx.push({ kind: 'lanternRise', x0: sx, y0: sy, l, dur: 3, life: 4, max: 4, done: () => state.lanterns.push(l) });
          break;
        }
        case 'dance': danceUntil = time + 9; break;
        case 'firework': firework(WW.CHARS[a.char].color); setTimeout(() => firework('#ff8ad8'), 450); setTimeout(() => firework('#7ad7ff'), 900); break;
      }
    } else if (evt.type === 'unlock') {
      applySummary(evt.summary);
      showBanner(evt.milestone.title.replace(/ unlocked/i, ''));
      if (evt.milestone.id === 'bigfriend') bigFriendT = 0;
      for (let i = 0; i < 4; i++) setTimeout(() => burst(rand(W * .2, W * .8), rand(H * .2, H * .5), '#ffffff', 26), i * 250);
    }
  }

  let bannerTimer = null;
  function showBanner(title) {
    $('bannerTitle').textContent = title;
    $('banner').classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => $('banner').classList.remove('show'), 4200);
  }

  function renderHud() {
    const sc = WW.SCENES[state.scene];
    $('sceneName').textContent = sc.name;
    document.title = 'Wonder Wall · ' + sc.short;
    for (const b of document.querySelectorAll('[data-scene]')) b.setAttribute('aria-pressed', String(b.dataset.scene === state.scene));
    $('visits').textContent = state.visits;
    const ms = state.milestones || [], next = state.next;
    if (!next) { $('goal').textContent = ''; $('bar').style.width = '100%'; $('nextText').textContent = 'All unlocked'; return; }
    const idx = ms.findIndex((m) => m.id === next.id);
    const prevAt = idx > 0 ? ms[idx - 1].at : 0;
    $('goal').textContent = '/ ' + next.at;
    $('bar').style.width = (clamp((state.visits - prevAt) / (next.at - prevAt), 0, 1) * 100).toFixed(1) + '%';
    $('nextText').textContent = 'Next · ' + next.title.replace(/ unlocked| woke up!/i, '').replace(/^A /, '');
  }

  async function loadState() {
    const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
    seq = s.seq;
    const sceneChanged = s.scene !== state.scene || !scenery;
    state = Object.assign(state, s);
    actors.clear(); fx.length = 0; newItems.clear(); danceUntil = 0;
    bigFriendT = state.unlocked.includes('bigfriend') ? 1 : -1;
    if (sceneChanged) { skyMix = state.unlocked.includes('fireworks') ? 2 : state.unlocked.includes('lanterns') ? 1 : 0; buildScenery(); }
    for (const st of s.active) upsertActor(st, { quiet: true });
    $('empty').classList.toggle('hide', actors.size > 0);
    renderHud();
  }

  // Poll for new events (works on serverless hosts, where a held-open stream can't be shared).
  let seq = -1;
  async function poll() {
    try {
      if (seq < 0) await loadState();
      else {
        const r = await (await fetch('/api/events?since=' + seq, { cache: 'no-store' })).json();
        if (r.resync) await loadState();
        else { seq = r.seq; for (const evt of r.events) { try { onEvent(evt); } catch (e) { console.error(e); } } }
      }
      $('offline').style.display = 'none';
    } catch { $('offline').style.display = 'block'; }
    setTimeout(poll, document.hidden ? 4000 : 900);
  }
  function connect() { poll(); }

  async function setupQr() {
    let base = location.origin;
    try {
      const info = await (await fetch('/api/info')).json();
      if (/^(localhost|127\.|\[::1\])/.test(location.hostname) && info.urls.length) base = info.urls[0];
      if (info.vercel && !info.persistent) { $('offline').textContent = 'Shared storage not connected: add Redis in Vercel'; $('offline').style.display = 'block'; }
    } catch {}
    $('qr').innerHTML = WW.qrSvg(base + '/station.html', '#07060f');
  }

  // ---------- simulated crowd (one arrival pattern per scenario) ----------
  const CROWD = {
    market:   { every: [3000, 6000],  burst: [1, 2], returning: .25, acts: ['flower', 'wave', 'lantern', 'flower', 'dance'] },
    park:     { every: [2000, 3500],  burst: [1, 1], returning: .55, acts: ['wave', 'flower', 'wave', 'firework', 'dance'] },
    festival: { every: [8000, 11000], burst: [4, 6], returning: .15, acts: ['dance', 'firework', 'wave', 'flower', 'lantern'] },
  };
  let crowdOn = false, crowdTimer = null;
  const simPool = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  async function simVisitor() {
    const c = CROWD[state.scene];
    let id;
    if (simPool.length && Math.random() < c.returning) id = pick(simPool);
    else { id = pick(WW.CHAR_IDS) + '-' + randInt(500, 899); simPool.push(id); }
    const r = await api('/api/tap', { sticker: id, source: 'simulated' });
    if (!r.sticker || r.duplicate) return;
    for (let j = randInt(1, 2); j > 0 && crowdOn; j--) {
      await sleep(rand(1200, 2800));
      const avail = c.acts.filter((a) => state.actions.includes(a));
      if (avail.length) await api('/api/action', { sticker: id, action: pick(avail) });
    }
  }
  function crowdStep() {
    if (!crowdOn) return;
    const c = CROWD[state.scene];
    for (let i = randInt(c.burst[0], c.burst[1]); i > 0; i--) setTimeout(() => crowdOn && simVisitor().catch(() => {}), i * rand(150, 600));
    crowdTimer = setTimeout(crowdStep, rand(c.every[0], c.every[1]));
  }
  function toggleCrowd(on) {
    crowdOn = on == null ? !crowdOn : on;
    $('crowdBtn').setAttribute('aria-pressed', String(crowdOn));
    $('crowdBtn').textContent = crowdOn ? 'Simulating crowd' : 'Simulate crowd';
    clearTimeout(crowdTimer);
    if (crowdOn) crowdStep();
  }
  $('crowdBtn').onclick = () => toggleCrowd();
  function setScene(scene) { if (scene !== state.scene) api('/api/scene', { scene }); }
  for (const b of document.querySelectorAll('[data-scene]')) b.onclick = () => setScene(b.dataset.scene);

  // ---------- drawing ----------
  // Twilight → dusk → night, all dark enough that light and glow carry the scene.
  const SKY = [['#1b2552', '#c4706a'], ['#11163a', '#5a3878'], ['#05071a', '#1b1238']];
  function mix(c1, c2, t) {
    const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const a = p(c1), b = p(c2);
    return 'rgb(' + a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',') + ')';
  }
  function skyColors() {
    const i = Math.min(1, Math.floor(skyMix)), t = skyMix - i;
    return [mix(SKY[i][0], SKY[i + 1][0], t), mix(SKY[i][1], SKY[i + 1][1], t)];
  }
  // Glows are pre-rendered once per color and stamped with drawImage: far cheaper than a
  // gradient or shadowBlur per object, which is what made a crowded wall stutter.
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(color, 1)); gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      glowCache.set(color, c);
    }
    return c;
  }
  function glowDot(x, y, r, color, a) {
    if (a <= .004 || r <= 0) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, a);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = prev;
  }
  // Neon line: one blurred stroke. Paths are batched, so this stays a few blurs per frame.
  function neon(path, color, a, width, blur) {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur;
    ctx.strokeStyle = rgba(color, a); ctx.lineWidth = width; path(); ctx.stroke();
    ctx.restore();
  }

  // Character halo: the glow that hugs each character's shape. Blurring every character every
  // frame is what stuttered with a crowd, so each shape's halo is blurred once and reused.
  // The halo is a soft blur, so a small source upscales invisibly; one sprite per facing avoids flipping.
  const HALO_S = 16, HALO_SPAN = 5.5, haloCache = new Map();
  function haloSprite(char, color, dir) {
    const key = char + color + dir;
    let c = haloCache.get(key);
    if (!c) {
      const size = Math.round(HALO_S * HALO_SPAN), off = size * 4;
      c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d');
      g.shadowColor = color; g.shadowBlur = HALO_S * .9; g.shadowOffsetX = off; // draw off-canvas: keep only the glow
      WW.drawChar(g, char, size / 2 - off, size / 2, HALO_S, 0, { sleek: true, color, seed: 0, dir });
      haloCache.set(key, c);
    }
    return c;
  }
  function drawHalo(char, color, x, y, s, dir, strength) {
    const c = haloSprite(char, color, dir < 0 ? -1 : 1), sz = s * HALO_SPAN;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, strength);
    ctx.drawImage(c, x - sz / 2, y - sz / 2, sz, sz);
    ctx.globalAlpha = prev;
  }

  function drawSky() {
    const [top, bot] = skyColors(), hz = scenery.horizon;
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz + 2);
    const starA = .15 + .85 * clamp(skyMix - .6, 0, 1.4) / 1.4;
    ctx.fillStyle = '#fff';
    for (const s of scenery.stars) {
      ctx.globalAlpha = starA * (0.4 + 0.6 * Math.sin(time * 1.6 + s.p) ** 2);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const mx = W * .62, my = lerp(H * .4, H * .17, Math.min(1, skyMix / 2));
    glowDot(mx, my, H * .12, '#fff1d6', .18);
    ctx.fillStyle = 'rgba(255,246,230,.92)'; ctx.beginPath(); ctx.arc(mx, my, H * .028, 0, Math.PI * 2); ctx.fill();
  }

  function drawRidge(dark) {
    ctx.fillStyle = mix('#2a2a5a', '#0c0b22', dark);
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 20) ctx.lineTo(x, H * .6 + Math.sin(x * .004 + 1) * H * .03 + Math.sin(x * .011) * H * .008);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  function drawFloor(dark) {
    const hz = scenery.horizon;
    const g = ctx.createLinearGradient(0, hz, 0, H);
    g.addColorStop(0, mix('#231e44', '#0d0b1f', dark)); g.addColorStop(1, mix('#100d22', '#040309', dark));
    ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(.5, 'rgba(255,220,240,.35)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, hz, W, 1);
    for (const m of scenery.motes) {
      const y = ((m.y - time * m.v) % (H * .8) + H * .8) % (H * .8) + H * .15;
      ctx.globalAlpha = .25 + .25 * Math.sin(time + m.p);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(m.x + Math.sin(time * .3 + m.p) * 10, y, m.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- community market: tent silhouettes, warm window glow, bokeh string lights ---
  function drawMarket(dark, glow) {
    const hz = scenery.horizon, warm = ['#ffd36e', '#ff9f6e', '#ff8ad8', '#fff1d6'];
    for (let row = 0; row < 2; row++) {
      const y0 = H * (.38 + row * .07), amp = H * .03;
      const ly = (x) => y0 + Math.sin((x / W) * Math.PI * (3 + row)) * -amp;
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
      ctx.beginPath(); for (let x = 0; x <= W; x += 12) ctx.lineTo(x, ly(x)); ctx.stroke();
      for (let x = 14 + row * 20, k = 0; x < W; x += 44, k++) {
        const tw = .55 + .45 * Math.sin(time * 2 + k * 1.7 + row);
        glowDot(x, ly(x) + 4, 14, warm[k % 4], (.25 + .35 * glow) * tw);
        ctx.fillStyle = rgba(warm[k % 4], .9); ctx.beginPath(); ctx.arc(x, ly(x) + 4, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const t of scenery.tents) {
      const top = hz - t.h, x0 = t.x - t.w / 2;
      ctx.fillStyle = mix('#2b2450', '#0e0b20', dark);
      ctx.beginPath(); ctx.moveTo(x0, hz); ctx.lineTo(x0, top + t.h * .35); ctx.lineTo(t.x, top); ctx.lineTo(x0 + t.w, top + t.h * .35); ctx.lineTo(x0 + t.w, hz); ctx.closePath(); ctx.fill();
      const lg = ctx.createLinearGradient(0, hz - t.h * .55, 0, hz);
      lg.addColorStop(0, rgba('#ffcf8a', .1 + .45 * glow)); lg.addColorStop(1, rgba('#ff9f6e', .05 + .2 * glow));
      ctx.fillStyle = lg; ctx.fillRect(x0 + t.w * .14, hz - t.h * .5, t.w * .72, t.h * .5);
    }
  }

  // --- theme park queue: neon ferris wheel, coaster line with a light streak, glowing queue ropes ---
  function drawPark(dark, glow) {
    const hz = scenery.horizon;
    const R = Math.min(H * .2, W * .13), cx = W * .2, cy = hz - R - H * .02;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - R * .55, hz); ctx.lineTo(cx, cy); ctx.lineTo(cx + R * .55, hz); ctx.stroke();
    neon(() => { ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); }, '#7ad7ff', .45 + .35 * glow, 2, 12 * glow + 4);
    const rot = time * .1, cars = 12;
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let i = 0; i < cars; i++) {
      const ang = rot + (i / cars) * Math.PI * 2, gx = cx + Math.cos(ang) * R, gy = cy + Math.sin(ang) * R;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(gx, gy); ctx.stroke();
      const c = 'hsl(' + ((i * 30 + time * 40) % 360) + ',90%,72%)';
      ctx.fillStyle = c; ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(gx, gy, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .18 * (.4 + glow); ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    glowDot(cx, cy, 16, '#ffffff', .5);
    ctx.restore();

    const x0 = W * .42, x1 = W * .99;
    const ty = (x) => hz - H * .05 - H * .2 * Math.pow(0.5 + 0.5 * Math.sin(((x - x0) / (x1 - x0)) * Math.PI * 3 - 1.2), 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let x = x0; x <= x1; x += 22) { ctx.moveTo(x, ty(x)); ctx.lineTo(x, hz); } ctx.stroke();
    neon(() => { ctx.beginPath(); for (let x = x0; x <= x1; x += 5) ctx.lineTo(x, ty(x)); }, '#ff7eb6', .55 + .35 * glow, 2, 10 * glow + 3);
    const head = x0 + (x1 - x0) * ((time * .08) % 1);
    for (let k = 0; k < 14; k++) {
      const x = head - k * 6; if (x < x0) break;
      ctx.globalAlpha = 1 - k / 14; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, ty(x), 2.6 - k * .12, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawQueueRope(y) {
    const n = Math.max(5, Math.round(W / 150)), step = W / n;
    neon(() => {
      ctx.beginPath();
      for (let i = 0; i < n - 1; i++) {
        const xa = i * step + step * .5, xb = xa + step;
        ctx.moveTo(xa, y - H * .04); ctx.quadraticCurveTo((xa + xb) / 2, y - H * .012, xb, y - H * .04);
      }
    }, '#ff7eb6', .55, 1.5, 8);
    for (let i = 0; i < n; i++) {
      const x = i * step + step * .5;
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - H * .04); ctx.stroke();
      glowDot(x, y - H * .042, 8, '#ffd36e', .6);
    }
  }
  function drawWaitTime() {
    const x = W * .04, y = scenery.horizon + H * .06;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(244,241,255,.5)'; ctx.font = font(11, 400);
    ctx.fillText('W A I T', x, y);
    ctx.fillStyle = 'rgba(244,241,255,.9)'; ctx.font = font(Math.max(22, H * .04), 200);
    ctx.fillText((40 - Math.floor(time / 60) % 10) + ' min', x, y + Math.max(26, H * .045));
  }

  // --- music festival: truss frame, LED screen countdown, beams, LED string, crowd with phone lights ---
  function drawFestival(dark, glow) {
    const hz = scenery.horizon, sw = W * .46, sx = W * .27, top = hz - H * .27;
    for (let x = W * .03, k = 0; x < W * .97; x += 18, k++) {
      const y = H * .27 + Math.sin(((x - W * .03) / (W * .94)) * Math.PI) * H * .05;
      ctx.fillStyle = 'hsl(' + ((k * 14 + time * 60) % 360) + ',90%,72%)';
      ctx.globalAlpha = .5 + .4 * Math.sin(time * 3 + k * .5);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = mix('#1c1738', '#0a0818', dark);
    for (const spx of [sx - W * .05, sx + sw + W * .012]) ctx.fillRect(spx, hz - H * .16, W * .038, H * .16);
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(sx, top, sw, hz - top);
    ctx.beginPath(); for (let x = sx; x < sx + sw; x += 16) { ctx.moveTo(x, top); ctx.lineTo(x + 8, top + 10); ctx.lineTo(x + 16, top); } ctx.stroke();
    const hue = (time * 25) % 360, scx = sx + sw * .12, scy = top + H * .045, scw = sw * .76, sch = H * .13;
    ctx.save(); ctx.shadowColor = 'hsl(' + hue + ',90%,65%)'; ctx.shadowBlur = 30;
    const sg = ctx.createLinearGradient(scx, 0, scx + scw, 0);
    sg.addColorStop(0, 'hsl(' + hue + ',85%,58%)'); sg.addColorStop(1, 'hsl(' + ((hue + 90) % 360) + ',85%,58%)');
    ctx.fillStyle = sg; roundRect(scx, scy, scw, sch, 6); ctx.fill(); ctx.restore();
    const secs = 900 - (Math.floor(time) % 900);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(11, 400); ctx.fillText('N E X T   S E T', scx + scw / 2, scy + sch * .27);
    ctx.font = font(Math.max(22, H * .05), 200); ctx.fillText(Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), scx + scw / 2, scy + sch * .64);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const beamCols = ['#ff8ad8', '#7ad7ff', '#ffd36e', '#b79bff'];
    for (let i = 0; i < 4; i++) {
      const ox = sx + sw * (.15 + .233 * i), oy = top, ang = Math.sin(time * .8 + i * 1.7) * .55, len = H * .6;
      const ex = ox + Math.sin(ang) * len, ey = oy - Math.cos(ang) * len;
      const bg = ctx.createLinearGradient(ox, oy, ex, ey);
      bg.addColorStop(0, rgba(beamCols[i], .1 + .2 * glow)); bg.addColorStop(1, rgba(beamCols[i], 0));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.sin(ang - .1) * len, oy - Math.cos(ang - .1) * len);
      ctx.lineTo(ox + Math.sin(ang + .1) * len, oy - Math.cos(ang + .1) * len);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawCrowd(dark) {
    const hz = scenery.horizon, dancing = time < danceUntil;
    ctx.fillStyle = mix('#151130', '#05040c', dark);
    for (const c of scenery.crowd) {
      const bob = dancing ? Math.abs(Math.sin(time * 6 + c.p)) * 6 : Math.abs(Math.sin(time * 1.5 + c.p)) * 1.5;
      ctx.beginPath(); ctx.arc(c.x, hz + 6 - c.r * 2.2 - bob, c.r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c.x, hz + 8 - bob * .5, c.r * 1.5, c.r * 1.3, 0, Math.PI, 0); ctx.fill();
    }
    ctx.fillRect(0, hz + 7, W, 10);
    for (const c of scenery.crowd) if (c.phone) {
      const a = .5 + .5 * Math.sin(time * 2 + c.p);
      glowDot(c.x + c.r, hz - c.r * 3.6, 8, '#ffffff', .35 * a);
      ctx.fillStyle = rgba('#ffffff', .85 * a); ctx.fillRect(c.x + c.r - 1.5, hz - c.r * 3.6 - 2.5, 3, 5);
    }
  }

  // --- what visitors leave behind (flower / balloon / glow stick) and lanterns ---
  const lanternPos = (l) => [l.x * W + Math.sin(time * .2 + l.seed) * 24, l.y * H + Math.sin(time * .5 + l.seed * 2) * 8];
  const itemPos = (f) => [f.x * W, H * (0.86 + f.row * 0.05)];
  function drawLantern(x, y, s, flicker) {
    glowDot(x, y, s * 3.2, '#ffb27a', .35 + .1 * flicker);
    ctx.fillStyle = 'rgba(255,214,160,.95)'; ctx.beginPath(); ctx.ellipse(x, y, s * .55, s * .7, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawItem(f) {
    const t0 = newItems.get(f), grow = t0 == null ? 1 : Math.min(1, (time - t0) / 0.8), e = 1 - Math.pow(1 - grow, 3);
    const [x, y] = itemPos(f), s = H * 0.012 * (0.8 + f.row * 0.5);
    const col = ITEM_COLORS[hash(f.by + f.t) % ITEM_COLORS.length];
    if (state.scene === 'park') {
      const by = y - H * .1 * e - Math.sin(time * 1.2 + f.x * 30) * 4, bx = x + Math.sin(time * .9 + f.x * 20) * 5;
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, (y + by) / 2, bx, by + s * 1.2); ctx.stroke();
      glowDot(bx, by, s * 3, col, .3);
      const g = ctx.createRadialGradient(bx - s * .4, by - s * .5, s * .1, bx, by, s * 1.3);
      g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.35, rgba(col, .85)); g.addColorStop(1, rgba(col, .5));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, by, s, s * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (state.scene === 'festival') {
      const ang = ((hash(f.t) % 100) / 100 - .5) * 1.6;
      ctx.save(); ctx.translate(x, y - s); ctx.rotate(ang);
      glowDot(0, 0, s * 3.2 * e, col, .45);
      ctx.lineCap = 'round'; ctx.strokeStyle = col; ctx.lineWidth = s * .55;
      ctx.beginPath(); ctx.moveTo(-s * 1.6 * e, 0); ctx.lineTo(s * 1.6 * e, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = s * .18;
      ctx.beginPath(); ctx.moveTo(-s * 1.3 * e, 0); ctx.lineTo(s * 1.3 * e, 0); ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(160,255,200,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 2.4 * e); ctx.stroke();
      const hx = x, hy = y - s * 2.4 * e, sway = Math.sin(time * 1.5 + f.x * 20) * 2;
      glowDot(hx + sway, hy, s * 3 * e, col, .4);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + time * .2;
        ctx.fillStyle = rgba(col, .9); ctx.beginPath(); ctx.arc(hx + sway + Math.cos(a) * s * .6 * e, hy + Math.sin(a) * s * .6 * e, s * .32 * e, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx + sway, hy, s * .22 * e, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawActor(a) {
    const color = WW.CHARS[a.char].color;
    const s = a.size * (a.pop < 1 ? 1 - Math.pow(1 - a.pop, 3) + Math.sin(a.pop * Math.PI) * .2 : 1);
    ctx.globalAlpha = clamp(a.fade, 0, 1);
    const move = WW.CHARS[a.char].move;
    if (move !== 'fly' && move !== 'swim') glowDot(a.x, a.baseY + a.size * .95, a.size * 1.1, color, .22);
    const h = a.handId && hands.get(a.handId);
    drawHalo(a.char, h ? h.color : color, a.x, a.y, s * (1 + a.pulse * .25), a.dir, .6 + (h ? .35 : 0) + a.pulse * .5);
    WW.drawChar(ctx, a.char, a.x, a.y, s, time, { dir: a.dir, seed: a.seed, walking: Math.abs(a.vx) > a.size * .4 || time < danceUntil, flying: move === 'fly', sleek: true });
    if (a.pulse > 0) {
      ctx.strokeStyle = rgba(h ? h.color : color, a.pulse * .7); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.size * (1.3 + (1 - a.pulse) * 1.4), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = font(Math.max(10, a.size * .3), 400); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(244,241,255,.38)';
    ctx.fillText(a.num + (a.visits > 1 ? ' · ' + a.visits : ''), a.x, a.y + a.size * 1.45);
    ctx.globalAlpha = 1;
  }

  function drawBigFriend() {
    bigFriendT = Math.min(1, bigFriendT + 1 / 240);
    const e = 1 - Math.pow(1 - bigFriendT, 3), s = H * .1;
    const x = state.scene === 'park' ? W * .9 : W * .08, y = H * .6 + s * 1.6 * (1 - e) + Math.sin(time * .8) * 6;
    drawHalo('bunny', '#b79bff', x, y, s, x > W / 2 ? -1 : 1, .9);
    ctx.save(); ctx.globalAlpha = .5;
    WW.drawChar(ctx, 'bunny', x, y, s, time * .6, { color: '#b79bff', seed: 7, dir: x > W / 2 ? -1 : 1, sleek: true });
    ctx.restore();
  }

  function drawHandsFloor() {
    for (const h of hands.values()) if (handActive(h)) {
      const g = ctx.createRadialGradient(h.x, H * .8, 0, h.x, H * .8, W * .1);
      g.addColorStop(0, rgba(h.color, .18)); g.addColorStop(1, rgba(h.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(h.x, H * .8, W * .1, H * .06, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawBridges() {
    for (const b of bridges.values()) {
      const h1 = hands.get(b.h1), h2 = hands.get(b.h2);
      if (!h1 || !h2) continue;
      const [cx, cy] = bridgeCtrl(h1, h2);
      const g = ctx.createLinearGradient(h1.x, h1.y, h2.x, h2.y);
      g.addColorStop(0, rgba(h1.color, .85 * b.a)); g.addColorStop(1, rgba(h2.color, .85 * b.a));
      ctx.save(); ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 14;
      ctx.strokeStyle = g; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(h1.x, h1.y); ctx.quadraticCurveTo(cx, cy, h2.x, h2.y); ctx.stroke();
      ctx.restore();
    }
  }
  function drawHands() {
    for (const h of hands.values()) {
      h.alpha += ((handActive(h) ? 1 : .25) - h.alpha) * .08;
      const r = H * .03 * (1 + (handStill(h) ? Math.sin(time * 3) * .12 : 0));
      glowDot(h.x, h.y, r * 2.6, h.color, .22 * h.alpha);
      ctx.save();
      ctx.strokeStyle = rgba(h.color, .9 * h.alpha); ctx.lineWidth = 1.5;
      if (h.sim) ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = rgba('#ffffff', .9 * h.alpha); ctx.beginPath(); ctx.arc(h.x, h.y, 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawFx() {
    for (const p of fx) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'spark' || p.kind === 'mote') {
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'ripple') {
        ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, H * .02 + (1 - a) * H * .12, 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'rocket') {
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.cy, 2, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'seed') {
        const k = p.k || 0, [tx, ty] = itemPos(p.f);
        ctx.globalAlpha = 1;
        glowDot(lerp(p.x0, tx, k), lerp(p.y0, ty, k) - Math.sin(k * Math.PI) * H * .15, 10, '#ffd36e', .9);
      } else if (p.kind === 'lanternRise') {
        const k = p.k || 0, e = 1 - Math.pow(1 - k, 2), [tx, ty] = lanternPos(p.l);
        ctx.globalAlpha = 1;
        drawLantern(lerp(p.x0, tx, e), lerp(p.y0, ty, e), H * .014, Math.sin(time * 8));
      } else if (p.kind === 'bridgeSpark') {
        const h1 = hands.get(p.h1), h2 = hands.get(p.h2);
        if (!h1 || !h2) continue;
        const [x, y] = quad(h1, h2, p.dir ? p.k || 0 : 1 - (p.k || 0));
        ctx.globalAlpha = 1; glowDot(x, y, 14, '#ffffff', .9);
      }
    }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawWorld() {
    const dark = Math.min(1, skyMix / 2), glow = .35 + .65 * Math.min(1, skyMix / 1.5), scene = state.scene;
    drawSky();
    drawRidge(dark);
    if (bigFriendT >= 0) drawBigFriend();
    if (scene === 'market') drawMarket(dark, glow);
    else if (scene === 'park') drawPark(dark, glow);
    else drawFestival(dark, glow);
    for (const l of state.lanterns.slice(-MAX_LANTERNS_SHOWN)) { const [x, y] = lanternPos(l); drawLantern(x, y, H * .014, Math.sin(time * 6 + l.seed)); }
    drawFloor(dark);
    if (scene === 'festival') drawCrowd(dark);
    if (scene === 'park') { drawWaitTime(); drawQueueRope(H * .74); }
    drawHandsFloor();
    for (const f of state.flowers.slice(-MAX_ITEMS_SHOWN)) drawItem(f);
    for (const a of [...actors.values()].sort((p, q) => p.baseY - q.baseY)) drawActor(a);
    if (scene === 'park') drawQueueRope(H * .9);
    drawBridges();
    drawFx();
    drawHands();
  }

  // ---------- loop ----------
  let last = performance.now();
  const perf = { samples: [] };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    const target = state.unlocked.includes('fireworks') ? 2 : state.unlocked.includes('lanterns') ? 1 : 0;
    skyMix += (target - skyMix) * Math.min(1, dt * 0.4);
    if (time < danceUntil && Math.random() < dt * 6) {
      const a = pick([...actors.values()]);
      if (a) fx.push({ kind: 'mote', x: a.x + rand(-a.size, a.size), y: a.y - a.size, vy: -rand(30, 60), r: rand(1.2, 2.4), color: WW.CHARS[a.char].color, life: 1.2, max: 1.2 });
    }
    const t0 = performance.now();
    updateCamera();
    updateHands(dt);
    updateBridges(dt);
    updateActors(dt);
    updateFx(dt);
    drawWorld();
    perf.samples.push(performance.now() - t0); if (perf.samples.length > 120) perf.samples.shift();
    $('empty').classList.toggle('hide', actors.size > 0);
    requestAnimationFrame(frame);
  }

  // Keys: 1/2/3 switch scene · S simulate crowd · H hide demo controls · Shift+R reset this scene.
  addEventListener('keydown', async (e) => {
    const ids = Object.keys(WW.SCENES);
    if (/^[1-3]$/.test(e.key)) setScene(ids[+e.key - 1]);
    else if (e.key === 's') toggleCrowd();
    else if (e.key === 'h') document.body.classList.toggle('hidden-demo');
    else if (e.key === 'c') (cam || camStarting ? stopCamera() : startCamera());
    else if (e.key === 'R' && e.shiftKey && confirm('Reset this scene? This clears its characters, items and unlocks.')) await fetch('/api/reset', { method: 'POST' });
  });

  window.WWDebug = { actors, hands, bridges, fx, perf }; // inspect from the console while testing

  addEventListener('resize', resize);
  resize();
  setupQr();
  connect();
  requestAnimationFrame(frame);
})();
