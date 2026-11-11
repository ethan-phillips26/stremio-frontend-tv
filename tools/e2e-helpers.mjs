import { launch } from './pt.mjs';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
export const SHOTS = '/tmp/claude-1000/-home-ethan-streamingcomputer/75dd075f-a2bb-4fdf-bc01-013e0e1ab0b6/scratchpad/shots';
fs.mkdirSync(SHOTS, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function startServer(port = 8097, env = {}) {
  spawnSync('fuser', ['-k', `${port}/tcp`]);   // a crashed earlier run must not leave a stale server answering
  const p = spawn('python3', ['server/server.py', '--port', String(port)], { cwd: '/home/ethan/streamingcomputer', env: { ...process.env, STREAM_DRY_POWER: '1', STREAM_DRY_APPS: '1', STREAM_MPV: '/home/ethan/streamingcomputer/tools/fake_mpv.py', STREAM_CONFIG: '/nonexistent', STREAM_DATA: '/tmp/claude-1000/-home-ethan-streamingcomputer/75dd075f-a2bb-4fdf-bc01-013e0e1ab0b6/scratchpad/data', ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderrText = ''; p.stderr.on('data', (d) => (p.stderrText += d));
  return p;
}
export function startMock(port = 8098) { return spawn('python3', ['tools/mock-addon.py', String(port)], { cwd: '/home/ethan/streamingcomputer', stdio: 'ignore' }); }
export async function open(path = '/', { width = 1920, height = 1080, port = 8097, skipLogin = true } = {}) {
  const b = await launch({ width, height });
  if (skipLogin) await b.page.evaluateOnNewDocument(() => { try { localStorage.setItem('skipLogin', '1'); } catch (_) {} });
  await b.page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'load' });
  return b;
}
export const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
export const key = async (page, k, n = 1, wait = 450) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(wait); } };
