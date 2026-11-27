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
 */
(function () {
  'use strict';
  var PREFIXES = {
    flashcards: 'bb-fc2-',
    brain: 'bb-quiz3-',
    recall: 'cv1-recall-deck',
    revision: 'mathea-quiz-'
  };
  var SYNCED = 'jasyn-synced', RESETS = 'jasyn-resets', LAST = 'jasyn-last-sync';
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
      method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
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
      fetch(API, { method: 'POST', keepalive: body.length < 60000, headers: { 'content-type': 'application/json' }, body: body })
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
    countKeys: function (appId) {
      var p = PREFIXES[appId], n = 0, m = localMap();
      for (var k in m) if (k.indexOf(p) === 0) n++;
      return n;
    }
  };
})();
