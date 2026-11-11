// Turns an addon's free-text stream labels into something a TV can show and rank.
// Addons format their name/description differently, so match loosely over all text.
const RES = [[/\b(2160p?|4k|uhd)\b/i, 2160], [/\b1440p?\b/i, 1440], [/\b1080p?\b/i, 1080], [/\b720p?\b/i, 720], [/\b(480p?|sd)\b/i, 480]];

// Patterns (regex sources) that mark a stream as ready to play instantly. Extend via config.playback.cachedPatterns.
let cachedRes = [/\[[A-Za-z]{0,3}[+⚡]\]/, /⚡/];
export function configure(cfg) {
  const list = cfg && cfg.playback && cfg.playback.cachedPatterns;
  if (!Array.isArray(list)) return;
  const out = []; for (const src of list) { try { out.push(new RegExp(src, 'i')); } catch (_) {} }
  if (out.length) cachedRes = out;
}

export function parseStream(s, addonName) {
  const text = [s.name, s.description, s.title, s.behaviorHints && s.behaviorHints.filename].filter(Boolean).join('\n');
  let res = 0; for (const [re, v] of RES) if (re.test(text)) { res = v; break; }
  const hdr = /\b(dolby ?vision|dovi|dv)\b/i.test(text) ? 'DV' : /hdr10\+/i.test(text) ? 'HDR10+' : /\bhdr(10)?\b/i.test(text) ? 'HDR' : '';
  const codec = /\b(av1)\b/i.test(text) ? 'AV1' : /\b(hevc|h\.?265|x265)\b/i.test(text) ? 'HEVC' : /\b(avc|h\.?264|x264)\b/i.test(text) ? 'H.264' : '';
  const bit10 = /10[- ]?bit/i.test(text);
  const source = /remux/i.test(text) ? 'Remux' : /blu-?ray|bdrip|brrip/i.test(text) ? 'BluRay' : /web-?dl|webrip|\bweb\b/i.test(text) ? 'WEB' : /hdtv/i.test(text) ? 'HDTV' : /cam|telesync|\bts\b/i.test(text) ? 'CAM' : '';
  const audio = /atmos/i.test(text) ? 'Atmos' : /truehd/i.test(text) ? 'TrueHD' : /dts-?hd/i.test(text) ? 'DTS-HD' : /\bdts\b/i.test(text) ? 'DTS' : /dd\+|ddp|e-?ac-?3/i.test(text) ? 'DD+' : /\b(ac-?3|dd5)/i.test(text) ? 'AC3' : /\baac\b/i.test(text) ? 'AAC' : '';
  const sm = text.match(/(\d+(?:\.\d+)?)\s?(GB|MB|GiB|MiB)/i);
  const sizeGB = sm ? (/g/i.test(sm[2]) ? +sm[1] : +sm[1] / 1024) : (s.behaviorHints && s.behaviorHints.videoSize ? s.behaviorHints.videoSize / 1e9 : 0);
  const seed = (text.match(/👤\s*(\d+)/) || [])[1];
  const cached = cachedRes.some((re) => re.test(s.name || ''));
  const lang = /multi/i.test(text) ? 'Multi' : '';
  return { res, hdr, codec, bit10, source, audio, sizeGB, seeders: seed ? +seed : 0, cached, lang, addon: addonName || '' };
}

export const resLabel = (r) => (r >= 2160 ? '4K' : r ? r + 'p' : 'HD');
export const heavy = (q) => q.res >= 2160 || q.source === 'Remux' || q.sizeGB > 18;

/** Lower is better. Prefers cached, at-or-below the chosen cap, efficient codecs, sane size. */
export function rank(q, maxRes = 1080) {
  let sc = 0;
  const res = q.res || 720;
  sc += res <= maxRes ? res / 10 : -40 - (res - maxRes) / 20;
  if (q.cached) sc += 60;
  if (q.codec === 'H.264') sc += 12; else if (q.codec === 'AV1') sc -= 8;
  if (q.hdr && maxRes < 2160) sc -= 14;
  if (q.source === 'Remux' && maxRes < 2160) sc -= 25;
  if (q.source === 'CAM') sc -= 200;
  if (q.sizeGB > 25) sc -= 20; else if (q.sizeGB > 12) sc -= 6;
  sc += Math.min(q.seeders, 200) / 40;
  return -sc;
}

export function describe(q) {
  const top = [resLabel(q.res), q.source, q.hdr, q.codec && (q.codec + (q.bit10 ? ' 10-bit' : ''))].filter(Boolean).join('  ·  ');
  const sub = [q.audio, q.sizeGB ? q.sizeGB.toFixed(1) + ' GB' : '', q.lang, q.seeders ? q.seeders + ' seeds' : ''].filter(Boolean).join('  ·  ');
  return { top, sub };
}
