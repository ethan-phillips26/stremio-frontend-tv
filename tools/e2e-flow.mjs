// Full flow with a mock addon: Detail -> Streams -> (fake) mpv playback -> progress synced into the core -> back to Detail.
import { startServer, startMock, open, shot, sleep, key } from './e2e-helpers.mjs';
const srv = startServer(8097, { FAKE_MPV_DURATION: '60', FAKE_MPV_SPEED: '6' }); const mock = startMock(); await sleep(1500);
const { browser, page, logs } = await open('/?static');
await sleep(5000);
const ev = (fn, ...a) => page.evaluate(fn, ...a);
// install the mock addon into this (anonymous) profile
await ev(async () => { const { core } = window.__app; const m = await (await fetch('http://127.0.0.1:8098/manifest.json')).json();
  await core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { manifest: m, transportUrl: 'http://127.0.0.1:8098/manifest.json', flags: {} } } }, 'ctx'); });
await sleep(800);
// open Shawshank detail
await ev(() => window.__app.A.openTitle({ type: 'movie', id: 'tt0111161', preview: { name: 'The Shawshank Redemption' } }));
await sleep(5000); await shot(page, '10-detail-movie');
await key(page, 'Enter', 1, 3500); await shot(page, '11-streams');
console.log('screen after Play:', await ev(() => document.body.dataset.screen));
const rows = await ev(() => [...document.querySelectorAll('.srow')].map((r) => r.innerText.replace(/\n+/g, ' | ')));
console.log('stream rows (' + rows.length + '):\n  ' + rows.join('\n  '));
await key(page, 'Enter', 1, 2500); await shot(page, '12-playing');
console.log('screen after choose:', await ev(() => document.body.dataset.screen));
await sleep(5000);
const mid = await ev(async () => { const s = await window.__app.core.getState('meta_details'); return s.libraryItem && s.libraryItem.state; });
console.log('library state mid-play:', JSON.stringify(mid && { timeOffset: mid.timeOffset, duration: mid.duration, video_id: mid.video_id }));
await sleep(9000);
console.log('screen after exit:', await ev(() => document.body.dataset.screen));
const fin = await ev(async () => { const s = await window.__app.core.getState('meta_details'); const cw = await window.__app.core.continueWatching(); return { st: s.libraryItem && s.libraryItem.state, watched: s.metaItem && s.metaItem.content && s.metaItem.content.content && s.metaItem.content.content.watched, cw: cw.map((i) => i.name) }; });
console.log('final:', JSON.stringify(fin));
await shot(page, '13-after');
console.log('errors:', logs.filter((l) => /PAGEERROR|TypeError|ReferenceError/.test(l)).slice(0, 5).join('\n') || 'none');
await browser.close(); srv.kill(); mock.kill();
