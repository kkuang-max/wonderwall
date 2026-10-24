// Wonder Wall — shared rules + character art. Loaded by the server (Node) and every page (browser).
(function (root) {
  const CHARS = {
    bunny:  { name: 'Bunny',    emoji: '🐰', color: '#fbf3ea', accent: '#f6a6bd', move: 'hop' },
    fox:    { name: 'Fox',      emoji: '🦊', color: '#f08a3c', accent: '#fff4e8', move: 'walk' },
    koi:    { name: 'Koi',      emoji: '🐟', color: '#ff7a59', accent: '#ffffff', move: 'swim' },
    bird:   { name: 'Bluebird', emoji: '🐦', color: '#5aa9e6', accent: '#ffd166', move: 'fly' },
    frog:   { name: 'Frog',     emoji: '🐸', color: '#7ac74f', accent: '#eaf6d9', move: 'hop' },
    sprite: { name: 'Mushroom', emoji: '🍄', color: '#e4572e', accent: '#fff3e0', move: 'walk' },
  };
  const CHAR_IDS = Object.keys(CHARS);

  // Actions a visitor can trigger from the station. `needs` = milestone id that unlocks it.
  const ACTIONS = {
    wave:     { label: 'Wave hello',        emoji: '👋', needs: null },
    flower:   { label: 'Plant a flower',    emoji: '🌸', needs: null },
    lantern:  { label: 'Light a lantern',   emoji: '🏮', needs: 'lanterns' },
    dance:    { label: 'Start a dance',     emoji: '💃', needs: 'dance' },
    firework: { label: 'Launch a firework', emoji: '🎆', needs: 'fireworks' },
  };

  // Collective unlocks: counted in total sticker taps from everyone at the event.
  const MILESTONES = [
    { id: 'lanterns',  at: 3,  title: 'Lanterns unlocked',     desc: 'Dusk is falling. Anyone can now light a lantern.' },
    { id: 'dance',     at: 7,  title: 'Dance party unlocked',  desc: 'Everyone on the wall can now dance together.' },
    { id: 'fireworks', at: 12, title: 'Fireworks unlocked',    desc: 'Night has come. Launch a firework from the station.' },
    { id: 'bigfriend', at: 20, title: 'A Big Friend woke up!', desc: 'Enough of you showed up to wake the giant of the Wonder Wall.' },
  ];

  // The same stickers work at every kind of event; each scene re-themes the wall
  // and the one "leave something behind" action.
  const SCENES = {
    market:   { name: 'Community Night Market', short: 'Community market', icon: '🏮',
                tagline: 'Tap a sticker. Your friend joins the market.', item: { label: 'Plant a flower', emoji: '🌸' } },
    park:     { name: 'Comet Coaster · Queue', short: 'Theme park queue', icon: '🎢',
                tagline: 'Waiting in line? Tap a sticker and play.', item: { label: 'Release a balloon', emoji: '🎈' } },
    festival: { name: 'Sunset Music Festival', short: 'Music festival', icon: '🎶',
                tagline: 'Between sets? Tap a sticker and join in.', item: { label: 'Wave a glow stick', emoji: '✨' } },
  };
  function actionInfo(id, scene) {
    const a = ACTIONS[id];
    return id === 'flower' && SCENES[scene] ? Object.assign({}, a, SCENES[scene].item) : a;
  }

  const MAX_ACTIONS_PER_TAP = 3;

  // Sticker codes look like "fox-0007". They can arrive as raw text, inside a URL
  // (QR / NFC URL record: .../station.html?s=fox-0007), or typed by hand.
  function parseSticker(raw) {
    const m = String(raw || '').toLowerCase().match(new RegExp('(' + CHAR_IDS.join('|') + ')[-_ #]?(\\d{1,4})\\b'));
    if (!m) return null;
    const num = m[2].padStart(4, '0');
    return { id: m[1] + '-' + num, char: m[1], num };
  }

  // A blank NFC sticker has no code written to it, only a hardware serial number.
  // Hash it so any off-the-shelf NFC tag still becomes a stable character.
  function stickerFromSerial(serial) {
    let h = 2166136261;
    for (const ch of String(serial)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    h >>>= 0;
    return parseSticker(CHAR_IDS[h % CHAR_IDS.length] + '-' + String(h % 10000).padStart(4, '0'));
  }

  function label(s) { return CHARS[s.char].name + ' #' + s.num; }

  // Draw a character centered at (x, y) with radius-ish size s. t = seconds (for blinking/wiggles).
  function drawChar(ctx, char, x, y, s, t, o) {
    o = o || {};
    const c = CHARS[char] || CHARS.bunny;
    const col = o.color || c.color, acc = c.accent;
    const dir = o.dir || 1, seed = o.seed || 0;
    const blink = ((t + seed) % 3.7) < 0.13;
    const step = o.walking ? Math.sin(t * 11 + seed) : 0;
    const ink = 'rgba(42,30,50,.9)';
    const sleek = !!o.sleek; // wall style: no outlines, no mouth, just two dot eyes

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.lineWidth = Math.max(1.5, s * 0.075);
    ctx.strokeStyle = ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const E = (cx, cy, rx, ry, fill, rot, stroke) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot || 0, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke !== false && !sleek) ctx.stroke();
    };
    const tri = (pts, fill) => {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); if (!sleek) ctx.stroke();
    };
    const eyes = (ex, ey, gap, r) => {
      r = r || 1;
      if (sleek) {
        const er = s * .07 * r;
        ctx.fillStyle = 'rgba(16,12,36,.85)';
        for (const sx of [-gap, gap]) {
          if (blink) ctx.fillRect(ex + sx - er, ey - er * .3, er * 2, er * .6);
          else { ctx.beginPath(); ctx.arc(ex + sx, ey, er, 0, Math.PI * 2); ctx.fill(); }
        }
        return;
      }
      if (blink) {
        ctx.beginPath();
        ctx.moveTo(ex - gap - s * .08, ey); ctx.lineTo(ex - gap + s * .08, ey);
        ctx.moveTo(ex + gap - s * .08, ey); ctx.lineTo(ex + gap + s * .08, ey);
        ctx.stroke();
        return;
      }
      for (const sx of [-gap, gap]) {
        E(ex + sx, ey, s * .075 * r, s * .1 * r, '#2a1e32', 0, false);
        E(ex + sx + s * .025 * r, ey - s * .04 * r, s * .028 * r, s * .028 * r, '#fff', 0, false);
      }
    };
    const cheeks = (ex, ey, gap) => {
      if (sleek) return;
      E(ex - gap, ey, s * .1, s * .06, 'rgba(255,110,140,.45)', 0, false);
      E(ex + gap, ey, s * .1, s * .06, 'rgba(255,110,140,.45)', 0, false);
    };
    const smile = (mx, my, w) => { if (sleek) return; ctx.beginPath(); ctx.arc(mx, my, w, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); };
    const feet = (fill) => {
      E(-s * .42, s * .86 - (step > 0 ? s * .08 * step : 0), s * .24, s * .14, fill || col);
      E(s * .42, s * .86 + (step < 0 ? s * .08 * step : 0), s * .24, s * .14, fill || col);
    };

    switch (char) {
      case 'fox': {
        const wag = Math.sin(t * 4 + seed) * .15;
        E(-s * 1.0, s * .2, s * .62, s * .28, col, -0.6 + wag);
        E(-s * 1.42, -s * .1, s * .2, s * .16, '#fff', -0.6 + wag);
        tri([-s * .62, -s * .5, -s * .7, -s * 1.25, -s * .1, -s * .82], col);
        tri([s * .62, -s * .5, s * .7, -s * 1.25, s * .1, -s * .82], col);
        feet();
        E(0, 0, s, s * .9, col);
        E(s * .12, s * .32, s * .58, s * .42, acc, 0, false);
        eyes(s * .12, -s * .1, s * .32);
        E(s * .12, s * .14, s * .09, s * .065, '#2a1e32', 0, false);
        smile(s * .12, s * .18, s * .13);
        break;
      }
      case 'koi': {
        const wig = Math.sin(t * 6 + seed) * .25;
        ctx.rotate(wig * .15);
        tri([-s * 1.05, 0, -s * 1.75, -s * .6 + wig * s * .3, -s * 1.75, s * .6 + wig * s * .3], col);
        E(-s * .1, -s * .62, s * .38, s * .2, col, -0.3);
        E(0, 0, s * 1.25, s * .76, col);
        E(-s * .35, -s * .28, s * .34, s * .2, '#fff', .3, false);
        E(s * .1, s * .35, s * .3, s * .17, '#fff', -.2, false);
        E(-s * .05, s * .5, s * .32, s * .15, col, .7);
        eyes(s * .72, -s * .15, 0, 1.25);
        E(s * 1.12, s * .12, s * .07, s * .09, '#2a1e32', 0, false);
        break;
      }
      case 'bird': {
        if (!o.flying && !sleek) {
          ctx.beginPath();
          ctx.moveTo(-s * .25, s * .8); ctx.lineTo(-s * .25, s * 1.05);
          ctx.moveTo(s * .25, s * .8); ctx.lineTo(s * .25, s * 1.05); ctx.stroke();
        }
        tri([-s * .1, -s * .82, s * .05, -s * 1.15, s * .25, -s * .85], col);
        E(0, 0, s, s * .9, col);
        E(s * .18, s * .32, s * .6, s * .48, acc, 0, false);
        tri([s * .88, -s * .1, s * 1.35, s * .04, s * .88, s * .18], '#ff9f1c');
        eyes(s * .32, -s * .2, s * .26);
        const flap = o.flying ? Math.sin(t * 16 + seed) * .7 : 0;
        E(-s * .25, s * .05, s * .55, s * .3, '#3d8bc9', -0.5 + flap);
        break;
      }
      case 'frog': {
        feet();
        E(-s * .45, -s * .55, s * .32, s * .3, col);
        E(s * .45, -s * .55, s * .32, s * .3, col);
        E(0, s * .1, s * 1.12, s * .8, col);
        E(0, s * .38, s * .7, s * .42, acc, 0, false);
        E(-s * .45, -s * .6, s * .2, s * .2, '#fff', 0, false);
        E(s * .45, -s * .6, s * .2, s * .2, '#fff', 0, false);
        eyes(0, -s * .6, s * .45, 1.1);
        if (!sleek) { ctx.beginPath(); ctx.arc(0, -s * .05, s * .5, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke(); }
        cheeks(0, s * .12, s * .7);
        break;
      }
      case 'sprite': {
        feet(acc);
        E(0, s * .22, s * .72, s * .68, acc);
        ctx.beginPath();
        ctx.ellipse(0, -s * .2, s * 1.18, s * .82, 0, Math.PI, 0);
        ctx.quadraticCurveTo(0, s * .05, -s * 1.18, -s * .2);
        ctx.fillStyle = col; ctx.fill(); if (!sleek) ctx.stroke();
        E(-s * .5, -s * .5, s * .17, s * .14, '#fff', 0, false);
        E(s * .15, -s * .78, s * .14, s * .11, '#fff', 0, false);
        E(s * .62, -s * .42, s * .12, s * .1, '#fff', 0, false);
        eyes(s * .1, s * .25, s * .25);
        cheeks(s * .1, s * .42, s * .45);
        smile(s * .1, s * .45, s * .1);
        break;
      }
      default: { // bunny
        const wig = Math.sin(t * 3 + seed) * .12;
        E(-s * .32, -s * 1.2, s * .2, s * .55, col, -0.18 - wig);
        E(-s * .32, -s * 1.15, s * .09, s * .38, acc, -0.18 - wig, false);
        E(s * .32, -s * 1.2, s * .2, s * .55, col, 0.18 + wig);
        E(s * .32, -s * 1.15, s * .09, s * .38, acc, 0.18 + wig, false);
        feet();
        E(0, 0, s, s * .9, col);
        eyes(s * .12, -s * .05, s * .32);
        cheeks(s * .12, s * .18, s * .55);
        E(s * .12, s * .12, s * .07, s * .05, '#f37b9b', 0, false);
        smile(s * .12, s * .16, s * .11);
      }
    }
    ctx.restore();
  }

  // Render a QR code as a scalable SVG string (uses vendor/qrcode.js in the browser).
  function qrSvg(text, dark) {
    const qr = root.qrcode(0, 'M');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), m = 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * m) + ' ' + (n + 2 * m) +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="' + d +
      '" fill="' + (dark || '#1d1530') + '"/></svg>';
  }

  const WW = { CHARS, CHAR_IDS, ACTIONS, SCENES, actionInfo, MILESTONES, MAX_ACTIONS_PER_TAP, parseSticker, stickerFromSerial, label, drawChar, qrSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = WW;
  else root.WW = WW;
})(typeof window !== 'undefined' ? window : globalThis);
