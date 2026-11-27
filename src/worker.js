// jasynapson server: serves the static site from ./public and keeps study progress
// in Durable Objects (SQLite), one per device code. Cloudflare creates the database on deploy and it
// survives redeploys, so no external database or dashboard setup is needed.
import { DurableObject } from 'cloudflare:workers';

// Only these storage keys (the apps' own localStorage keys) are accepted.
export const APP_PREFIXES = {
  flashcards: 'bb-fc2-',
  brain: 'bb-quiz3-',
  recall: 'cv1-recall-deck',
  revision: 'mathea-quiz-',
};
const PREFIXES = Object.values(APP_PREFIXES);
const MAX_VALUE = 1_500_000; // characters per key (DO rows allow 2 MB)
const MAX_BODY = 8_000_000;

// Each device has its own random restore code (16 Crockford base32 chars, ~80 bits),
// e.g. K7QF-29XM-WD4P-H3NB. Every code gets its own Durable Object, so progress is
// kept separate per device and can't be guessed.
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

export const isTrackedKey = (k) =>
  typeof k === 'string' && k.length > 0 && k.length <= 200 && PREFIXES.some((p) => k.startsWith(p));

export class ProgressStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER NOT NULL)'
    );
  }

  snapshot() {
    const items = {};
    let updated = 0;
    for (const row of this.ctx.storage.sql.exec('SELECT k, v, t FROM kv')) {
      items[row.k] = row.v;
      if (row.t > updated) updated = row.t;
    }
    return { items, updated };
  }

  // One atomic batch: wipe whole apps (reset), then delete keys, then write keys.
  apply({ reset = [], del = [], set = {} } = {}) {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const p of Array.isArray(reset) ? reset : []) {
        if (PREFIXES.includes(p)) sql.exec('DELETE FROM kv WHERE substr(k, 1, ?) = ?', p.length, p);
      }
      for (const k of Array.isArray(del) ? del : []) {
        if (isTrackedKey(k)) sql.exec('DELETE FROM kv WHERE k = ?', k);
      }
      for (const [k, v] of Object.entries(set && typeof set === 'object' ? set : {})) {
        if (!isTrackedKey(k) || typeof v !== 'string' || v.length > MAX_VALUE) continue;
        sql.exec(
          'INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t',
          k, v, now
        );
      }
    });
    return this.snapshot();
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/progress') {
      const code = (request.headers.get('x-device-code') || '').toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'missing or invalid device code' }, 400);
      const store = env.PROGRESS.get(env.PROGRESS.idFromName('device:' + code));
      if (request.method === 'GET') return json(await store.snapshot());
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
        let body;
        try { body = JSON.parse(text || '{}'); } catch { return json({ error: 'bad json' }, 400); }
        return json(await store.apply(body));
      }
      return json({ error: 'method not allowed' }, 405);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
