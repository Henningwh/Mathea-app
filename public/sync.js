/* jasynapson progress sync.
 *
 * The four apps save progress in localStorage (each under its own key prefix) and
 * are left untouched. This layer mirrors those keys to the server (/api/progress,
 * a Cloudflare Durable Object), so progress survives new builds, refreshes,
 * different links/browsers and cleared site data.
 *
 * How it decides what wins:
 *   jasyn-synced  = the value of every key as last confirmed by the server.
 *   local != synced  -> changed on this device, not yet uploaded: local wins, upload it.
 *   local == synced  -> unchanged here: take whatever the server has now (including deletes).
 *   jasyn-resets  = app resets not yet confirmed by the server (works offline too).
 *
 * Progress is kept per device: each device makes a random restore code on first run
 * (jasyn-device) and the server stores progress under that code. Entering the same
 * code on another device (Manage progress -> Restore code) brings that progress over.
 * Devices that already had progress before codes existed get a code on their next
 * launch, and their local progress is uploaded under it.
 */
(function () {
  'use strict';
  var PREFIXES = {
    flashcards: 'bb-fc2-',
    brain: 'bb-quiz3-',
    recall: 'cv1-recall-deck',
    revision: 'mathea-quiz-'
  };
  var SYNCED = 'jasyn-synced', RESETS = 'jasyn-resets', LAST = 'jasyn-last-sync', DEVICE = 'jasyn-device';
  var CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
  var API = 'api/progress';
  var pfx = Object.keys(PREFIXES).map(function (k) { return PREFIXES[k]; });

  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function readJSON(k, d) { try { var v = JSON.parse(ls.get(k)); return v == null ? d : v; } catch (e) { return d; } }
  function tracked(k) { return typeof k === 'string' && pfx.some(function (p) { return k.indexOf(p) === 0; }); }
  function appOf(k) { for (var id in PREFIXES) if (k.indexOf(PREFIXES[id]) === 0) return id; return null; }
  function localMap() {
    var m = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (tracked(k)) m[k] = localStorage.getItem(k); } } catch (e) {}
    return m;
  }

  function newCode() {
    var b = new Uint8Array(16), out = '';
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < 16; i++) { out += CODE_CHARS[b[i] & 31]; if (i % 4 === 3 && i < 15) out += '-'; }
    return out;
  }
  // Accept codes typed loosely: lower case, spaces, missing dashes, O for 0, I/L for 1.
  function normalizeCode(c) {
    var raw = String(c || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
    if (raw.length !== 16) return null;
    var f = raw.match(/.{4}/g).join('-');
    return CODE_RE.test(f) ? f : null;
  }
  var code = normalizeCode(ls.get(DEVICE));
  if (!code) { code = newCode(); ls.set(DEVICE, code); }
  function headers() { return { 'content-type': 'application/json', 'x-device-code': code }; }

  var state = { status: 'idle', last: Number(ls.get(LAST)) || 0, error: null };
  var listeners = [];
  function emit(s, extra) { state.status = s; if (extra) for (var k in extra) state[k] = extra[k]; listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }

  function buildPayload() {
    var local = localMap(), synced = readJSON(SYNCED, {}), set = {}, del = [];
    Object.keys(local).forEach(function (k) { if (local[k] !== synced[k]) set[k] = local[k]; });
    Object.keys(synced).forEach(function (k) { if (!(k in local)) del.push(k); });
    return { set: set, del: del, reset: readJSON(RESETS, []) };
  }
  function isEmpty(p) { return !Object.keys(p.set).length && !p.del.length && !p.reset.length; }

  // Merge the server's snapshot into localStorage. Returns the app ids whose data changed here.
  function reconcile(sent, server) {
    var synced = readJSON(SYNCED, {});
    Object.keys(sent.set).forEach(function (k) { synced[k] = sent.set[k]; });
    sent.del.forEach(function (k) { delete synced[k]; });
    if (sent.reset.length) {
      var pending = readJSON(RESETS, []).filter(function (p) { return sent.reset.indexOf(p) < 0; });
      ls.set(RESETS, JSON.stringify(pending));
    }
    var local = localMap(), items = server.items || {}, changed = {};
    var keys = {}; [local, synced, items].forEach(function (o) { for (var k in o) keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      if (!tracked(k)) return;
      if (local[k] !== synced[k]) return;            // edited here meanwhile: keep, upload next round
      var v = items[k];
      if (v === undefined) { if (k in local) { ls.del(k); changed[appOf(k)] = 1; } delete synced[k]; }
      else { if (local[k] !== v) { ls.set(k, v); changed[appOf(k)] = 1; } synced[k] = v; }
    });
    ls.set(SYNCED, JSON.stringify(synced));
    return Object.keys(changed);
  }

  var inflight = null, again = false, onChange = function () {};
  function sync() {
    if (inflight) { again = true; return inflight; }
    var sent = buildPayload();
    emit('syncing');
    inflight = fetch(API, {
      method: 'POST', cache: 'no-store', headers: headers(),
      body: JSON.stringify(sent)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (server) {
      var changed = reconcile(sent, server);
      state.last = Date.now(); ls.set(LAST, String(state.last));
      emit('synced', { error: null });
      if (changed.length) onChange(changed);
    }).catch(function (e) {
      emit(navigator.onLine === false ? 'offline' : 'error', { error: String(e && e.message || e) });
    }).then(function () {
      inflight = null;
      if (again) { again = false; return sync(); }
    });
    return inflight;
  }

  // Upload when the page goes away. keepalive lets it finish after the page closes (small bodies only).
  function flushOnExit() {
    var p = buildPayload();
    if (isEmpty(p)) return;
    var body = JSON.stringify(p);
    try {
      fetch(API, { method: 'POST', keepalive: body.length < 60000, headers: headers(), body: body })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (s) { if (s) reconcile(p, s); }).catch(function () {});
    } catch (e) {}
  }

  var timer = null;
  function soon() { clearTimeout(timer); timer = setTimeout(sync, 800); }

  // The apps run in same-origin iframes, so their localStorage writes reach this window as 'storage' events.
  addEventListener('storage', function (e) { if (e.key === null || tracked(e.key)) soon(); });
  addEventListener('online', sync);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushOnExit(); else sync();
  });
  addEventListener('pagehide', flushOnExit);
  setInterval(function () { if (document.visibilityState === 'visible' && !isEmpty(buildPayload())) sync(); }, 15000);
  setInterval(function () { if (document.visibilityState === 'visible') sync(); }, 120000);

  // Ask the browser not to evict this site's storage (honoured for installed home-screen apps).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  window.JasynSync = {
    PREFIXES: PREFIXES,
    state: state,
    // First sync before any app opens. Never blocks for long: offline falls back to local data.
    ready: Promise.race([sync(), new Promise(function (r) { setTimeout(r, 3500); })]),
    sync: sync,
    onStatus: function (f) { listeners.push(f); f(state); },
    onRemoteChange: function (f) { onChange = f; },
    // Wipe one app's progress everywhere: on this device now, on the server now or on the next sync.
    reset: function (appId) {
      var p = PREFIXES[appId]; if (!p) return Promise.resolve();
      var synced = readJSON(SYNCED, {});
      Object.keys(localMap()).forEach(function (k) { if (k.indexOf(p) === 0) ls.del(k); });
      Object.keys(synced).forEach(function (k) { if (k.indexOf(p) === 0) delete synced[k]; });
      ls.set(SYNCED, JSON.stringify(synced));
      var pending = readJSON(RESETS, []); if (pending.indexOf(p) < 0) pending.push(p);
      ls.set(RESETS, JSON.stringify(pending));
      return sync();
    },
    code: function () { return code; },
    // Switch this device to another device's code: its saved progress replaces what is here.
    // Refuses codes with no saved progress, so a typo can't wipe anything.
    useCode: function (input) {
      var c = normalizeCode(input);
      if (!c) return Promise.reject(new Error('That doesn\u2019t look like a restore code.'));
      if (c === code) return Promise.resolve(false);
      return fetch(API, { cache: 'no-store', headers: { 'x-device-code': c } })
        .then(function (r) { if (!r.ok) throw new Error('Couldn\u2019t reach the cloud. Try again online.'); return r.json(); })
        .then(function (srv) {
          if (!Object.keys(srv.items || {}).length) throw new Error('No saved progress found for that code.');
          return (inflight || Promise.resolve()).then(function () {
            Object.keys(localMap()).forEach(function (k) { ls.del(k); });
            ls.set(SYNCED, '{}'); ls.set(RESETS, '[]');
            code = c; ls.set(DEVICE, c);
            return sync();
          }).then(function () { return true; });
        });
    },
    countKeys: function (appId) {
      var p = PREFIXES[appId], n = 0, m = localMap();
      for (var k in m) if (k.indexOf(p) === 0) n++;
      return n;
    }
  };
})();
