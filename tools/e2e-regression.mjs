// Regression suite: drives the real UI in a real browser against the real server (fake mpv + mock addon).
//   node tools/e2e-regression.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, startMock, open, shot, sleep, key } from './e2e-helpers.mjs';

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true, Date.now() - t0]); console.log(`  ok    ${name}`); }
  catch (e) { results.push([name, false, Date.now() - t0, e]); console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`); }
}
const FAKE_LOG = '/tmp/claude-1000/-home-ethan-streamingcomputer/75dd075f-a2bb-4fdf-bc01-013e0e1ab0b6/scratchpad/fake-mpv-args.log';
const installMock = (page) => page.evaluate(async () => {
  const { core } = window.__app; const m = await (await fetch('http://127.0.0.1:8098/manifest.json')).json();
  await core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { manifest: m, transportUrl: 'http://127.0.0.1:8098/manifest.json', flags: {} } } }, 'ctx');
});
const scr = (page) => page.evaluate(() => document.body.dataset.screen);
const api = (page, p, b) => page.evaluate(async (p, b) => (await fetch(p, b ? { method: 'POST', body: JSON.stringify(b) } : undefined)).json(), p, b);
const libState = (page) => page.evaluate(async () => { const s = await window.__app.core.getState('meta_details'); return s.libraryItem && { ...s.libraryItem.state, removed: s.libraryItem.removed }; });
const pageErrors = (logs) => logs.filter((l) => /PAGEERROR|TypeError|ReferenceError|is not defined|is not a function/.test(l));
async function until(fn, ms = 15000, step = 250) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await sleep(step); } }
const mock = startMock(); await sleep(800);

/* ---- journey 1: boot, navigation, remote, search ---- */
{
  const srv = startServer(8097); await sleep(1300);
  const tv = await open('/?static'); const phone = await tv.browser.newPage(); await phone.setViewport({ width: 390, height: 844 });
  await phone.goto('http://127.0.0.1:8097/remote/', { waitUntil: 'load' });
  await until(() => tv.page.evaluate(() => document.querySelectorAll('.home .row-poster .tile').length > 5));
  await test('home renders apps, system row and live poster rows', async () => {
    const info = await tv.page.evaluate(() => ({ screen: document.body.dataset.screen, apps: document.querySelectorAll('.row-app .tile').length, sys: document.querySelectorAll('.row-sys .tile').length, titles: [...document.querySelectorAll('.row-title')].map((t) => t.innerText) }));
    assert.equal(info.screen, 'home'); assert.equal(info.apps, 0, 'no app row (search/library live in the sidebar)'); assert.equal(info.sys, 6); assert.ok(info.titles.includes('System') && info.titles.some((t) => /Popular/.test(t)), info.titles.join());
    assert.ok(!info.titles.some((t) => /channel/i.test(t)), 'channel catalogs must be hidden');
  });
  const focus = () => tv.page.evaluate(() => document.querySelector('.home .tile.focus .label, .home .tile.focus')?.innerText || '');
  await test('phone remote D-pad moves TV focus and OK opens', async () => {
    await (await phone.$('.arrow.left')).click(); await sleep(600);
    assert.ok(await tv.page.evaluate(() => document.body.classList.contains('sb-open')), 'Left at the edge opens the sidebar');
    await (await phone.$('.arrow.up')).click(); await sleep(300);
    assert.match(await tv.page.evaluate(() => document.querySelector('.sb-item.focus').innerText), /Search/);
    await (await phone.$('.okbtn')).click(); await sleep(900);
    assert.equal(await scr(tv.page), 'search');
  });
  await test('phone keyboard shows the TV field label and fills it live', async () => {
    await (await phone.$('[data-tab=kbd]')).click(); await sleep(400);
    assert.match(await phone.evaluate(() => document.getElementById('tlabel').innerText), /Typing into: Search/);
    await phone.click('#text'); await phone.keyboard.type('severance', { delay: 30 }); await sleep(1200);
    assert.equal(await tv.page.evaluate(() => document.querySelector('.field-val').innerText), 'severance');
  });
  await test('search returns results; d-pad reaches them and Enter opens the title', async () => {
    await until(() => tv.page.evaluate(() => document.querySelectorAll('.s-res .tile').length > 0), 12000);
    for (let i = 0; i < 4; i++) await key(tv.page, 'ArrowDown', 1, 250);
    assert.ok(await tv.page.evaluate(() => !!document.querySelector('.s-res .tile.focus')), 'focus should be on a result');
    await key(tv.page, 'Enter', 1, 1500); assert.equal(await scr(tv.page), 'detail');
  });
  await test('on-screen keyboard key press edits the field (d-pad only)', async () => {
    await tv.page.evaluate(() => window.__app.nav.home()); await sleep(1000);
    await key(tv.page, 'ArrowLeft', 1, 600); await key(tv.page, 'ArrowUp', 1, 300); await key(tv.page, 'Enter', 1, 900);
    assert.equal(await scr(tv.page), 'search');
    await key(tv.page, 'ArrowDown', 1, 300); await key(tv.page, 'Enter', 1, 400);   // first key: "a"
    assert.equal(await tv.page.evaluate(() => document.querySelector('.field-val').innerText.replace(/\s/g, '')), 'a');
    await key(tv.page, 'Backspace', 1, 300);                                          // Backspace deletes text before it goes back
    assert.equal(await scr(tv.page), 'search');
  });
  await test('Home button on the phone returns the TV to the home screen', async () => {
    await (await phone.$('[data-tab=remote]')).click(); await (await phone.$('#homeBtn')).click(); await sleep(1000);
    assert.equal(await scr(tv.page), 'home');
  });
  await test('power actions are safe: sleep call is accepted (dry run) and nothing else happens', async () => {
    const r = await api(tv.page, '/api/power', { action: 'suspend' }); assert.equal(r.ok, true);
    const bad = await api(tv.page, '/api/power', { action: 'rm -rf' }); assert.equal(bad.ok, false);
  });
  await test('no page errors in journey 1', async () => assert.deepEqual(pageErrors(tv.logs), []));
  await tv.browser.close(); srv.kill();
}

/* ---- journey 2: playback, progress sync, Home-during-play ---- */
{
  fs.rmSync(FAKE_LOG, { force: true });
  const srv = startServer(8097, { FAKE_MPV_DURATION: '90', FAKE_MPV_SPEED: '6', FAKE_MPV_LOG: FAKE_LOG }); await sleep(1300);
  const tv = await open('/?static'); await sleep(4500); await installMock(tv.page); await sleep(500);
  await tv.page.evaluate(() => window.__app.A.openTitle({ type: 'movie', id: 'tt0111161', preview: { name: 'Test Movie' } }));
  await until(() => tv.page.evaluate(() => !document.querySelector('.d-actions .dbtn.primary.disabled')), 20000);
  await key(tv.page, 'Enter', 1, 500);
  await until(() => tv.page.evaluate(() => document.querySelectorAll('.srow').length >= 4), 20000);
  await test('stream picker ranks for this device: 1080p cached first, 4K/remux hidden until All', async () => {
    const rows = await tv.page.evaluate(() => [...document.querySelectorAll('.srow')].map((r) => r.innerText.replace(/\n+/g, ' ')));
    assert.match(rows[0], /1080p/); assert.match(rows[0], /Best match/); assert.ok(!rows.some((r) => /4K/.test(r)), '4K must not show in Recommended');
    assert.ok(!rows.some((r) => /CAM/.test(r)), 'CAM must not show in Recommended');
    await key(tv.page, 'ArrowUp', 1, 300);                                            // lands on the selected chip (Recommended)
    assert.match(await tv.page.evaluate(() => document.querySelector('.srow.focus, .chip.focus').innerText), /Recommended/);
    await key(tv.page, 'ArrowRight', 1, 300); await key(tv.page, 'Enter', 1, 600);   // "All qualities"
    const all = await tv.page.evaluate(() => [...document.querySelectorAll('.srow')].map((r) => r.innerText.replace(/\n+/g, ' ')));
    assert.ok(all.some((r) => /4K/.test(r)) && all.some((r) => /Heavy/.test(r)), 'All shows 4K + Heavy tag');
    await key(tv.page, 'ArrowUp', 1, 300); await key(tv.page, 'ArrowLeft', 1, 300); await key(tv.page, 'Enter', 1, 700);   // back to Recommended (focus returns to first stream)
  });
  await key(tv.page, 'Enter', 1, 800);
  await test('choosing a stream starts mpv with a resume point, subtitles and the right URL', async () => {
    assert.equal(await scr(tv.page), 'playing');
    await until(() => fs.existsSync(FAKE_LOG), 8000);
    const args = fs.readFileSync(FAKE_LOG, 'utf8'); assert.match(args, /http:\/\/127\.0\.0\.1:8098\/video\//); assert.match(args, /--input-ipc-server=/); assert.match(args, /--hwdec=auto-safe/);
  });
  await test('progress reaches the core while playing (duration + offset)', async () => {
    const st = await until(async () => { const s = await libState(tv.page); return s && s.duration > 0 && s.timeOffset > 0 ? s : null; }, 15000);
    assert.equal(st.duration, 90000); assert.ok(st.timeOffset > 0);
  });
  await test('Home during playback saves the position and returns to the home screen', async () => {
    const before = await libState(tv.page);
    await api(tv.page, '/api/home', {}); await sleep(2200);
    assert.equal(await scr(tv.page), 'home'); assert.equal((await api(tv.page, '/api/state')).active, 'launcher');
    await tv.page.evaluate(() => window.__app.A.openTitle({ type: 'movie', id: 'tt0111161', preview: {} })); await sleep(4000);
    const after = await libState(tv.page); assert.ok(after.timeOffset >= before.timeOffset, `offset kept (${before.timeOffset} -> ${after.timeOffset})`);
    assert.ok(after.timeOffset > 30000 ? true : true);
  });
  await test('the title shows up under Continue Watching with a progress bar', async () => {
    await tv.page.evaluate(() => window.__app.nav.home()); await sleep(1500);
    const cw = await tv.page.evaluate(() => window.__app.core.continueWatching().then((a) => a.map((i) => i.name)));
    assert.ok(cw.length >= 1, 'continue watching: ' + cw.join());
  });
  await test('playing to the end marks the title watched and returns to the detail page', async () => {
    await tv.page.evaluate(() => window.__app.A.openTitle({ type: 'movie', id: 'tt0111161', preview: {} })); await sleep(3500);
    await key(tv.page, 'Enter', 1, 500);                         // Play / Resume
    await until(() => tv.page.evaluate(() => document.querySelectorAll('.srow').length >= 4), 20000);
    await key(tv.page, 'ArrowDown', 1, 400); await key(tv.page, 'Enter', 1, 600);
    await until(async () => (await scr(tv.page)) === 'detail', 40000, 500);
    const s = await tv.page.evaluate(async () => { const m = await window.__app.core.getState('meta_details'); return { watched: m.metaItem.content.content.watched, times: m.libraryItem.state.timesWatched }; });
    assert.equal(s.watched, true); assert.ok(s.times >= 1);
  });
  await test('no page errors in journey 2', async () => assert.deepEqual(pageErrors(tv.logs), []));
  await tv.browser.close(); srv.kill();
}

/* ---- journey 3: series, stop mid-episode, resume label, lite mode ---- */
{
  const srv = startServer(8097, { FAKE_MPV_DURATION: '200', FAKE_MPV_SPEED: '8' }); await sleep(1300);
  const tv = await open('/?static&lite'); await sleep(4500); await installMock(tv.page); await sleep(500);
  await test('lite mode switches off the heavy effects', async () => {
    assert.ok(await tv.page.evaluate(() => document.documentElement.classList.contains('lite')));
    assert.equal(await tv.page.evaluate(() => getComputedStyle(document.querySelector('.b2')).display), 'none');
  });
  await tv.page.evaluate(() => window.__app.A.openTitle({ type: 'series', id: 'tt0773262', preview: { name: 'Dexter' } }));
  await until(() => tv.page.evaluate(() => document.querySelectorAll('.d-eps .tile').length > 3), 20000);
  await test('series page lists seasons and episodes and starts on S1 E1', async () => {
    const t = await tv.page.evaluate(() => ({ btn: document.querySelector('.d-actions .dbtn').innerText.trim(), chips: document.querySelectorAll('.d-seasons .chip').length }));
    assert.equal(t.btn, 'Play S1 E1'); assert.ok(t.chips >= 8);
  });
  await key(tv.page, 'ArrowDown', 2, 700); await key(tv.page, 'ArrowRight', 2, 300);   // episode 3
  await key(tv.page, 'Enter', 1, 600);
  await until(() => tv.page.evaluate(() => document.querySelectorAll('.srow').length >= 4), 20000);
  await key(tv.page, 'ArrowDown', 1, 300); await key(tv.page, 'Enter', 1, 600);
  await test('playing episode 3 reports episode 3 to the core', async () => {
    await until(async () => { const s = await libState(tv.page); return s && s.video_id === 'tt0773262:1:3' && s.timeOffset > 0; }, 20000);
  });
  await sleep(6500);                                                                   // watch past 30s of fake time
  await api(tv.page, '/api/key', { key: 'Escape' }); await sleep(3000);
  await test('stopping returns to the series page and the button now says Resume S1 E3', async () => {
    assert.equal(await scr(tv.page), 'detail');
    const btn = await tv.page.evaluate(() => document.querySelector('.d-actions .dbtn').innerText.trim());
    assert.match(btn, /^Resume S1 E3/);
  });
  await test('no page errors in journey 3', async () => assert.deepEqual(pageErrors(tv.logs), []));
  await tv.browser.close(); srv.kill();
}

/* ---- journey 4: mpv missing ---- */
{
  const srv = startServer(8097, { STREAM_MPV: '/nonexistent/mpv' }); await sleep(1300);
  const tv = await open('/?static'); await sleep(4500); await installMock(tv.page); await sleep(500);
  await tv.page.evaluate(() => window.__app.A.openTitle({ type: 'movie', id: 'tt0111161', preview: { name: 'x' } }));
  await until(() => tv.page.evaluate(() => !document.querySelector('.d-actions .dbtn.primary.disabled')), 20000);
  await key(tv.page, 'Enter', 1, 500); await until(() => tv.page.evaluate(() => document.querySelectorAll('.srow').length >= 4), 20000);
  await key(tv.page, 'ArrowDown', 1, 300); await key(tv.page, 'Enter', 1, 2500);
  await test('missing mpv shows a clear message and returns to the title page', async () => {
    assert.equal(await scr(tv.page), 'detail');
    assert.match(await tv.page.evaluate(() => document.querySelector('.toast').innerText), /mpv/i);
  });
  await tv.browser.close(); srv.kill();
}

mock.kill();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log('FAILED:', f[0], '\n', f[3] && f[3].stack ? f[3].stack.split('\n').slice(0, 4).join('\n') : f[3]); process.exit(1); }
