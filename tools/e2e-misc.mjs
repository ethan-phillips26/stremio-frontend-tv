import { startServer, open, shot, sleep, key } from './e2e-helpers.mjs';
const srv = startServer(8097); await sleep(1300);
const { browser, page, logs } = await open('/?static');
await sleep(5000);
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const scr = () => ev(() => document.body.dataset.screen);
const post = (p, b) => ev(async (p, b) => (await fetch(p, { method: 'POST', body: JSON.stringify(b) })).json(), p, b);

// ---- search: physical keyboard, then phone text
await key(page, 'ArrowRight', 1, 300); await key(page, 'Enter', 1, 1200);
console.log('1 screen:', await scr());
await page.keyboard.type('dex', { delay: 60 }); await sleep(5000); await shot(page, '30-search-kbd');
console.log('2 field:', await ev(() => document.querySelector('.field-val').innerText), '| result rows:', await ev(() => document.querySelectorAll('.s-res .row').length));
console.log('3 server saw text target:', JSON.stringify((await ev(async () => { const r = await fetch('/api/state'); return r.json(); })).active));
await post('/api/text', { value: 'breaking bad' }); await sleep(5000);
console.log('4 phone text -> field:', await ev(() => document.querySelector('.field-val').innerText));
await key(page, 'ArrowDown', 1, 300);
for (let i = 0; i < 4; i++) await key(page, 'ArrowDown', 1, 250);      // move onto the on-screen keys (row 4 of kbd = row index 4)
await key(page, 'Enter', 1, 400);                                       // press a key with the d-pad
console.log('5 key press from d-pad -> field:', await ev(() => document.querySelector('.field-val').innerText));
for (let i = 0; i < 5; i++) await key(page, 'ArrowDown', 1, 250);      // down into results
await shot(page, '31-search-results');
console.log('6 focus in results:', await ev(() => !!document.querySelector('.s-res .tile.focus')));
await key(page, 'Enter', 1, 2500);
console.log('7 opened:', await scr());
await ev(() => window.__app.nav.home()); await sleep(1200);
console.log('8 home again:', await scr());

// ---- library
await ev(async () => { const { core } = window.__app; const ids = [['movie', 'tt0111161', 'The Shawshank Redemption'], ['movie', 'tt0068646', 'The Godfather'], ['series', 'tt0903747', 'Breaking Bad'], ['series', 'tt0773262', 'Dexter'], ['movie', 'tt0468569', 'The Dark Knight']];
  for (const [type, id, name] of ids) await core.addToLibrary({ id, type, name, poster: `https://images.metahub.space/poster/small/${id}/img`, posterShape: 'poster' }); });
await sleep(800);
await key(page, 'ArrowRight', 2, 250); await key(page, 'Enter', 1, 2500);
console.log('9 screen:', await scr(), '| posters:', await ev(() => document.querySelectorAll('.lib-grid .tile').length));
await key(page, 'ArrowDown', 1, 700); await shot(page, '32-library');
await key(page, 'Escape', 1, 1000); console.log('10 back:', await scr());

// ---- sheets
await key(page, 'ArrowDown', 9, 200);
await sleep(800); await shot(page, '33-home-system');
console.log('11 focused:', await ev(() => document.querySelector('.tile.focus .label') && document.querySelector('.tile.focus .label').innerText));
await key(page, 'Enter', 1, 800); await shot(page, '34-remote-sheet');
console.log('12 sheet:', await ev(() => document.getElementById('sheetTitle').innerText + ' / ' + document.getElementById('sheetBig').innerText));
await key(page, 'Escape', 1, 600);
await key(page, 'ArrowRight', 5, 150); await key(page, 'Enter', 1, 700);       // Power Off -> confirm sheet; Enter on Cancel (default focus)
console.log('13 sheet:', await ev(() => document.getElementById('sheetTitle').innerText), '| focused:', await ev(() => document.querySelector('.btn.focus').innerText));
await key(page, 'Enter', 1, 500);

// ---- launch external app (dry run) + Home
await key(page, 'ArrowUp', 9, 150); await key(page, 'ArrowLeft', 6, 100);
await key(page, 'Enter', 1, 1500); await shot(page, '35-launch-zoom');
console.log('14 server active:', (await ev(async () => (await fetch('/api/state')).json())).active, '| zoom present:', await ev(() => !!document.querySelector('.zoom')), '| body.away:', await ev(() => document.body.classList.contains('away')));
await post('/api/home', {}); await sleep(1500);
console.log('15 after Home: active', (await ev(async () => (await fetch('/api/state')).json())).active, '| zoom:', await ev(() => !!document.querySelector('.zoom.full:not(.out)')), '| away:', await ev(() => document.body.classList.contains('away')));
console.log('errors:', logs.filter((l) => /PAGEERROR|TypeError|ReferenceError/.test(l)).slice(0, 6).join('\n') || 'none');
await browser.close(); srv.kill();
