// Where the shared world lives.
// On Vercel every request can land on a different server instance, so state must live in Redis
// (Upstash, added from the Vercel Storage tab — it sets KV_REST_API_URL / KV_REST_API_TOKEN).
// Without those variables (local `npm run dev`) it falls back to this process's memory.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'wonderwall:store';
const LOCK = 'wonderwall:lock';

export const persistent = Boolean(URL && TOKEN);

async function redis(command) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.error) throw new Error('Redis: ' + json.error);
  return json.result;
}

const mem = globalThis.__wonderwall || (globalThis.__wonderwall = { store: null, chain: Promise.resolve() });

export async function load() {
  if (!persistent) return mem.store;
  const raw = await redis(['GET', KEY]);
  return raw ? JSON.parse(raw) : null;
}

async function save(store) {
  if (!persistent) { mem.store = store; return; }
  await redis(['SET', KEY, JSON.stringify(store)]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read-modify-write under a lock, so two taps arriving at once can't overwrite each other.
export async function update(fn) {
  if (!persistent) {
    const run = mem.chain.then(async () => {
      const result = await fn(await load());
      await save(result.store);
      return result.value;
    });
    mem.chain = run.catch(() => {});
    return run;
  }
  const id = Math.random().toString(36).slice(2);
  for (let i = 0; ; i++) {
    if ((await redis(['SET', LOCK, id, 'NX', 'PX', '4000'])) === 'OK') break;
    if (i > 60) throw Object.assign(new Error('The wall is busy. Try again.'), { status: 503 });
    await sleep(40 + Math.random() * 40);
  }
  try {
    const result = await fn(await load());
    await save(result.store);
    return result.value;
  } finally {
    if ((await redis(['GET', LOCK])) === id) await redis(['DEL', LOCK]);
  }
}
