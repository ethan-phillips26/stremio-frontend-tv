'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
let pin = ''; try { pin = localStorage.getItem('pin') || ''; } catch (_) {}
let active = 'launcher', ui = null;

/* ---------- api ---------- */
async function send(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Pin': pin }, body: JSON.stringify(body || {}) });
    if (r.status === 401) { askPin(); return null; }
    const j = await r.json(); if (j && j.ok === false && path !== '/api/media') toastMsg('That did not work'); return j;
  } catch (_) { toastMsg('Lost connection to the TV'); return null; }
}
const key = (k) => { buzz(); return send('/api/key', { key: k }); };
const media = (action, value) => { buzz(); return send('/api/media', { action, value }); };

let toastT;
function toastMsg(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }

function dialog({ title, message, input, ok = 'OK', cancel = 'Cancel' }) {
  return new Promise((res) => {
    const d = $('#dialog'); $('#dlgTitle').textContent = title; $('#dlgMsg').textContent = message || '';
    const inp = $('#dlgInput'); inp.hidden = !input; inp.value = '';
    $('#dlgOk span').textContent = ok; $('#dlgCancel span').textContent = cancel; $('#dlgCancel').hidden = !cancel;
    d.hidden = false; if (input) setTimeout(() => inp.focus(), 50);
    const done = (v) => { d.hidden = true; $('#dlgOk').onclick = $('#dlgCancel').onclick = null; res(v); };
    $('#dlgOk').onclick = () => done(input ? inp.value : true); $('#dlgCancel').onclick = () => done(null);
  });
}
async function askPin() { const v = await dialog({ title: 'Enter the PIN', message: 'Shown in the TV settings.', input: true, ok: 'Unlock', cancel: null }); if (v) { pin = v; try { localStorage.setItem('pin', v); } catch (_) {} location.reload(); } }

/* ---------- tabs ---------- */
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  buzz(5); $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'kbd') setTimeout(() => $('#text').focus(), 60);
}));

/* ---------- press + hold-to-repeat ---------- */
function bindPress(el, fn, repeat) {
  let t, iv;
  const stop = () => { clearTimeout(t); clearInterval(iv); el.classList.remove('hold'); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); if (repeat) { t = setTimeout(() => { el.classList.add('hold'); iv = setInterval(fn, 120); }, 380); } });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, stop));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
$$('[data-key]').forEach((b) => bindPress(b, () => key(b.dataset.key), /Arrow|Backspace/.test(b.dataset.key)));
$$('[data-media]').forEach((b) => bindPress(b, () => media(b.dataset.media, b.dataset.value ? +b.dataset.value : undefined), b.hasAttribute('data-repeat')));
const goHome = () => { buzz(12); send('/api/home'); };
$('#homeBtn').addEventListener('click', goHome);

/* ---------- keyboard: live-syncs to whichever field the TV is showing ---------- */
const inp = $('#text'); let sendT;
function paintUi() {
  const live = !!(ui && ui.text);
  $('#tfield').classList.toggle('live', live);
  $('#tlabel').textContent = live ? `Typing into: ${ui.text.label}` : (active === 'launcher' ? 'Nothing to type into on the TV right now' : 'Type, then press Send to type it into the app');
  inp.type = live && ui.text.secret ? 'password' : 'text';
  if (live && document.activeElement !== inp) inp.value = ui.text.value || '';
  $('#sendBtn span').textContent = live ? 'Done' : 'Send';
}
inp.addEventListener('input', () => { if (ui && ui.text) { clearTimeout(sendT); sendT = setTimeout(() => send('/api/text', { value: inp.value }), 90); } });
const submit = () => { if (ui && ui.text) { send('/api/text', { value: inp.value, submit: true }); } else if (inp.value) { send('/api/text', { value: inp.value }); inp.value = ''; } inp.blur(); };
inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
$('#sendBtn').addEventListener('click', submit);
$('#clearBtn').addEventListener('click', () => { inp.value = ''; if (ui && ui.text) send('/api/text', { value: '' }); inp.focus(); });

/* ---------- apps + power ---------- */
fetch('/api/apps', { headers: { 'X-Pin': pin } }).then((r) => (r.status === 401 ? askPin() : r.json())).then((c) => {
  if (!c || !c.apps || !c.apps.length) return;      // no configured apps: the tab is just Power
  $('#appsH').hidden = false; $('#apps').hidden = false; $('#tabAppsLabel').textContent = 'Apps';
  const box = $('#apps');
  c.apps.forEach((a) => { const b = document.createElement('button'); b.className = 'app'; b.style.setProperty('--a1', a.a1 || '#555'); b.style.setProperty('--a2', a.a2 || '#222');
    b.innerHTML = '<i></i><span></span>'; b.lastChild.textContent = a.name; b.addEventListener('click', () => { buzz(12); send('/api/launch', { id: a.id }); toastMsg('Opening ' + a.name); }); box.append(b); });
  $('#appsNote').textContent = 'Use Home on the Remote tab to come back to the TV menu.';
}).catch(() => {});
$$('[data-power]').forEach((b) => b.addEventListener('click', async () => {
  const a = b.dataset.power;
  if (a !== 'suspend') { const ok = await dialog({ title: a === 'reboot' ? 'Restart the TV computer?' : 'Turn the TV computer off?', message: a === 'reboot' ? 'Everything will close and start again.' : 'You will need the power button to turn it back on.', ok: a === 'reboot' ? 'Restart' : 'Power off' }); if (!ok) return; }
  send('/api/power', { action: a }); toastMsg(a === 'suspend' ? 'Going to sleep' : 'Sending…');
}));

/* ---------- live state from the TV ---------- */
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
function paintNow(e) {
  const now = $('#now'); const on = active === 'mpv'; now.hidden = !on; $('#playOnly').hidden = !on;
  if (e) { $('#nowFill').style.width = (e.duration ? (100 * e.time) / e.duration : 0) + '%'; $('#nowTime').textContent = `${fmt(e.time)} / ${fmt(e.duration)}`; $('#nowState').textContent = e.paused ? 'Paused' : 'Playing'; }
}
function connect() {
  const es = new EventSource('/api/events');
  const conn = $('#conn'), txt = $('#connText');
  es.onopen = () => { conn.className = 'conn is-ok'; txt.textContent = 'Connected to TV'; };
  es.onerror = () => { conn.className = 'conn is-bad'; txt.textContent = 'Reconnecting…'; };
  es.onmessage = (m) => {
    let e; try { e = JSON.parse(m.data); } catch (_) { return; }
    if (e.type === 'active') { active = e.active; paintNow(); paintUi(); }
    else if (e.type === 'ui') { ui = e.text ? e : null; paintUi(); if (ui && !$('#tab-kbd').classList.contains('on') && ui.text.value === '' && /search|email/i.test(ui.text.label)) hintKbd(); }
    else if (e.type === 'player' && (e.event === 'time' || e.event === 'pause')) paintNow(e);
  };
}
let hinted = false;
function hintKbd() { if (hinted) return; hinted = true; toastMsg('Open Keyboard to type on the TV'); }
paintUi(); connect();
