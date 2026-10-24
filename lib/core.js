// Wonder Wall world rules: taps, actions, unlocks, scenes, and the event log walls poll.
import WW from '../public/shared.js';
import { load, update, persistent } from './store.js';

const ACTIVE_MS = 3 * 60 * 1000;   // a character stays on the wall this long after its tap
const SESSION_MS = 90 * 1000;      // how long after a tap the visitor can still trigger actions
const DEBOUNCE_MS = 4000;          // NFC readers fire repeatedly while a tag is held
const MAX_FLOWERS = 240, MAX_LANTERNS = 60, MAX_LOG = 40, MAX_EVENTS = 200;
const SCENE_IDS = Object.keys(WW.SCENES);

const overrides = (process.env.MILESTONES || '').split(',').map(Number);
const MILESTONES = WW.MILESTONES.map((m, i) => ({ ...m, at: overrides[i] > 0 ? overrides[i] : m.at }));

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function freshWorld(scene) {
  return { scene, event: WW.SCENES[scene].name, visits: 0, stickers: {}, flowers: [], lanterns: [], unlocked: [], log: [], startedAt: Date.now() };
}

// One saved world per scene, so each demo scenario keeps its own progress.
function normalize(store) {
  store = store || {};
  store.scene = SCENE_IDS.includes(store.scene) ? store.scene : 'market';
  store.worlds = store.worlds || {};
  for (const id of SCENE_IDS) store.worlds[id] = { ...freshWorld(id), ...(store.worlds[id] || {}), scene: id, event: WW.SCENES[id].name };
  store.seq = store.seq || 0;
  store.events = store.events || [];
  return store;
}

// Walls poll for these instead of holding a live connection (which serverless can't keep).
function emit(store, evt) {
  store.seq++;
  store.events.push({ seq: store.seq, evt });
  if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
}

const pubSticker = (r) => ({ id: r.id, char: r.char, num: r.num, visits: r.visits, lastSeen: r.lastSeen, actions: r.actions });

function summary(world) {
  const next = MILESTONES.find((m) => !world.unlocked.includes(m.id)) || null;
  const actions = Object.keys(WW.ACTIONS).filter((a) => !WW.ACTIONS[a].needs || world.unlocked.includes(WW.ACTIONS[a].needs));
  return { scene: world.scene, event: world.event, visits: world.visits, friends: Object.keys(world.stickers).length, unlocked: world.unlocked, milestones: MILESTONES, next, actions };
}

function addLog(world, text) {
  world.log.push({ t: Date.now(), text });
  if (world.log.length > MAX_LOG) world.log.splice(0, world.log.length - MAX_LOG);
}

function checkMilestones(store, world) {
  for (const m of MILESTONES) {
    if (!world.unlocked.includes(m.id) && world.visits >= m.at) {
      world.unlocked.push(m.id);
      addLog(world, '✨ ' + m.title);
      emit(store, { type: 'unlock', milestone: m, summary: summary(world) });
    }
  }
}

export async function getState() {
  const store = normalize(await load());
  const world = store.worlds[store.scene], now = Date.now();
  const active = Object.values(world.stickers).filter((s) => now - s.lastSeen < ACTIVE_MS).map(pubSticker);
  return { ...summary(world), flowers: world.flowers, lanterns: world.lanterns, active, log: world.log.slice(-8), now, seq: store.seq, persistent };
}

export async function eventsSince(since) {
  const store = normalize(await load());
  const oldest = store.events.length ? store.events[0].seq : store.seq + 1;
  // A wall that fell too far behind (or a reset) just reloads the full state.
  if (!(since >= 0) || since > store.seq || since < oldest - 1) return { seq: store.seq, resync: true, events: [] };
  return { seq: store.seq, events: store.events.filter((e) => e.seq > since).map((e) => e.evt) };
}

export function tap(body) {
  const s = WW.parseSticker(body.sticker);
  if (!s) throw httpError(400, "That doesn't look like a Wonder Wall sticker.");
  const source = ['nfc', 'qr', 'link', 'typed', 'simulated'].includes(body.source) ? body.source : 'unknown';
  return update((raw) => {
    const store = normalize(raw), world = store.worlds[store.scene], now = Date.now();
    let rec = world.stickers[s.id];
    if (rec && now - rec.lastSeen < DEBOUNCE_MS) {
      return { store, value: { sticker: pubSticker(rec), isNew: rec.visits === 1, duplicate: true, summary: summary(world) } };
    }
    const isNew = !rec;
    if (!rec) rec = world.stickers[s.id] = { id: s.id, char: s.char, num: s.num, visits: 0, firstSeen: now };
    rec.visits++;
    rec.lastSeen = now;
    rec.actions = 0;
    world.visits++;
    addLog(world, WW.CHARS[s.char].emoji + ' ' + WW.label(s) + (isNew ? ' joined the wall' : ' came back (visit ' + rec.visits + ')') + (source === 'simulated' ? ' · simulated' : ''));
    emit(store, { type: 'join', sticker: pubSticker(rec), isNew, source, summary: summary(world) });
    checkMilestones(store, world);
    return { store, value: { sticker: pubSticker(rec), isNew, summary: summary(world) } };
  });
}

export function act(body) {
  return update((raw) => {
    const store = normalize(raw), world = store.worlds[store.scene], now = Date.now();
    const s = WW.parseSticker(body.sticker);
    const rec = s && world.stickers[s.id];
    const a = WW.ACTIONS[body.action];
    if (!rec || !a) throw httpError(400, 'Unknown sticker or action.');
    if (now - rec.lastSeen > SESSION_MS) throw httpError(409, 'Tap your sticker again to keep playing.');
    if (rec.actions >= WW.MAX_ACTIONS_PER_TAP) throw httpError(409, 'That’s all for this tap. Tap again later!');
    if (a.needs && !world.unlocked.includes(a.needs)) throw httpError(403, 'Not unlocked yet. More visitors needed!');
    rec.actions++;
    const evt = { type: 'action', action: body.action, sticker: pubSticker(rec) };
    if (body.action === 'flower') {
      evt.flower = { x: 0.03 + Math.random() * 0.94, row: Math.random(), char: rec.char, by: rec.id, t: now };
      world.flowers.push(evt.flower);
      if (world.flowers.length > MAX_FLOWERS) world.flowers.shift();
    } else if (body.action === 'lantern') {
      evt.lantern = { x: 0.05 + Math.random() * 0.9, y: 0.06 + Math.random() * 0.3, seed: Math.random() * 1000, by: rec.id, t: now };
      world.lanterns.push(evt.lantern);
      if (world.lanterns.length > MAX_LANTERNS) world.lanterns.shift();
    }
    const info = WW.actionInfo(body.action, world.scene);
    addLog(world, WW.CHARS[rec.char].emoji + ' ' + WW.label(rec) + ': ' + info.emoji + ' ' + info.label.toLowerCase());
    emit(store, evt);
    return { store, value: { ok: true, actionsLeft: WW.MAX_ACTIONS_PER_TAP - rec.actions, summary: summary(world) } };
  });
}

export function reset() {
  return update((raw) => {
    const store = normalize(raw);
    store.worlds[store.scene] = freshWorld(store.scene);
    emit(store, { type: 'reset' });
    return { store, value: { ok: true } };
  });
}

export function setScene(body) {
  if (!SCENE_IDS.includes(body.scene)) throw httpError(400, 'Unknown scene');
  return update((raw) => {
    const store = normalize(raw);
    store.scene = body.scene;
    const world = store.worlds[store.scene];
    emit(store, { type: 'scene', scene: body.scene, summary: summary(world) });
    return { store, value: summary(world) };
  });
}
