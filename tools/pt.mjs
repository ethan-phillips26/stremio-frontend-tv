// Tiny browser-driver helper for tests: node tools/pt.mjs  (see tools/e2e-*.mjs for use)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
export async function launch({ width = 1920, height = 1080 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ffp-'));
  const browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/usr/bin/firefox', headless: true, args: ['--no-remote', '--profile', profile], defaultViewport: { width, height } });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  return { browser, page, logs, profile };
}
