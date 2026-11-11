import { startServer, startMock, open, shot, sleep, key } from './e2e-helpers.mjs';
const srv = startServer(8097, { FAKE_MPV_DURATION: '120', FAKE_MPV_SPEED: '4' }); const mock = startMock(); await sleep(1500);
const { browser, page, logs } = await open('/?static');
await sleep(5000);
const ev = (fn, ...a) => page.evaluate(fn, ...a);
await ev(async () => { const { core } = window.__app; const m = await (await fetch('http://127.0.0.1:8098/manifest.json')).json();
  await core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { manifest: m, transportUrl: 'http://127.0.0.1:8098/manifest.json', flags: {} } } }, 'ctx'); });
await sleep(600);
await ev(() => window.__app.A.openTitle({ type: 'series', id: 'tt0773262', preview: { name: 'Dexter' } }));
await sleep(5500); await shot(page, '20-series-top');
console.log('buttons:', await ev(() => [...document.querySelectorAll('.d-actions .dbtn')].map((b) => b.innerText.trim())));
await key(page, 'ArrowDown', 1, 1000); await shot(page, '21-series-seasons');
await key(page, 'ArrowDown', 1, 1200); await shot(page, '22-series-episodes');
await key(page, 'ArrowRight', 1, 500);                      // episode 2
await key(page, 'Enter', 1, 3500);
console.log('screen:', await ev(() => document.body.dataset.screen), '| title:', await ev(() => document.querySelector('.streams h1') && document.querySelector('.streams h1').innerText), '| sub:', await ev(() => document.querySelector('.streams .meta').innerText));
await key(page, 'Enter', 1, 7000);                          // pick best stream, play ~7s*4 = ~28s in
console.log('screen:', await ev(() => document.body.dataset.screen));
await page.evaluate(() => window.__app.api.post('/api/key', { key: 'Escape' }));   // stop like the remote's Back
await sleep(3500);
console.log('screen after stop:', await ev(() => document.body.dataset.screen));
const st = await ev(async () => { const s = await window.__app.core.getState('meta_details'); const i = s.libraryItem; return i && { video_id: i.state.video_id, timeOffset: i.state.timeOffset, duration: i.state.duration, removed: i.removed }; });
console.log('library item:', JSON.stringify(st));
console.log('buttons now:', await ev(() => [...document.querySelectorAll('.d-actions .dbtn')].map((b) => b.innerText.trim())));
await shot(page, '23-series-after-stop');
// Home should now show Continue Watching with this series
await ev(() => window.__app.nav.pop()); await sleep(1800);
await key(page, 'ArrowDown', 1, 1500); await shot(page, '24-home-cw');
console.log('home sections:', await ev(() => [...document.querySelectorAll('.row-title')].map((t) => t.innerText)));
console.log('errors:', logs.filter((l) => /PAGEERROR|TypeError|ReferenceError/.test(l)).slice(0, 5).join('\n') || 'none');
await browser.close(); srv.kill(); mock.kill();
