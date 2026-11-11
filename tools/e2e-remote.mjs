import { startServer, open, shot, sleep, SHOTS } from './e2e-helpers.mjs';
const srv = startServer(8097); await sleep(1300);
const tv = await open('/?static');
const phone = await tv.browser.newPage();
await phone.setViewport({ width: 390, height: 844 });
await phone.goto('http://127.0.0.1:8097/remote/', { waitUntil: 'load' });
await sleep(5000);
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const focused = () => ev(tv.page, () => { const f = document.querySelector('.screen:not(.under) .tile.focus .label, .screen:not(.under) .tile.focus'); return f ? (f.querySelector && f.querySelector('.label') ? f.querySelector('.label').innerText : f.className) : null; });
console.log('1 phone status:', await ev(phone, () => document.getElementById('connText').innerText));
await phone.screenshot({ path: `${SHOTS}/40-remote.png` });
const tap = async (sel) => { const el = await phone.$(sel); await el.click(); await sleep(500); };
console.log('2 tv focus before:', await focused());
await tap('.arrow.right'); console.log('3 after RIGHT:', await focused());
await tap('.okbtn'); await sleep(900); console.log('5 after OK -> tv screen:', await ev(tv.page, () => document.body.dataset.screen));
await sleep(500);
// keyboard tab: label tracks the TV's field; typing live-fills it
await tap('[data-tab=kbd]'); await sleep(400);
console.log('6 phone label:', await ev(phone, () => document.getElementById('tlabel').innerText));
await phone.click('#text'); await phone.keyboard.type('severance', { delay: 40 }); await sleep(1500);
console.log('7 TV field:', await ev(tv.page, () => document.querySelector('.field-val').innerText));
await phone.screenshot({ path: `${SHOTS}/41-remote-kbd.png` });
await tap('#clearBtn'); await sleep(600); console.log('8 TV field after clear:', JSON.stringify(await ev(tv.page, () => document.querySelector('.field-val').innerText)));
// back via remote, then apps tab + launch
await tap('[data-tab=remote]'); await tap('[data-key=Escape]'); await sleep(900);
console.log('9 after Back -> tv screen:', await ev(tv.page, () => document.body.dataset.screen));
await tap('[data-tab=apps]'); await phone.screenshot({ path: `${SHOTS}/42-remote-apps.png` });
console.log('10 app buttons:', await ev(phone, () => [...document.querySelectorAll('.app')].map((b) => b.innerText)));
await tap('.app'); await sleep(1200);
console.log('11 server active after launch:', (await (await fetch('http://127.0.0.1:8097/api/state')).json()).active, '| phone sees now-bar hidden:', await ev(phone, () => document.getElementById('now').hidden));
await tap('[data-tab=remote]'); await tap('#homeBtn'); await sleep(1200);
console.log('12 after Home:', (await (await fetch('http://127.0.0.1:8097/api/state')).json()).active);
await tap('[data-tab=touch]'); await phone.screenshot({ path: `${SHOTS}/43-remote-touch.png` });
// swipe on the touchpad -> arrow keys on the TV
const box = await (await phone.$('#touch')).boundingBox();
await phone.mouse.move(box.x + 100, box.y + 120); await phone.mouse.down(); await phone.mouse.move(box.x + 300, box.y + 120, { steps: 10 }); await phone.mouse.up(); await sleep(700);
console.log('13 after swipe right, tv focus:', await focused());
console.log('errors tv:', tv.logs.filter((l) => /PAGEERROR|TypeError|ReferenceError/.test(l)).join('\n') || 'none');
await tv.browser.close(); srv.kill();
