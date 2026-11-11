import { h, poster, huePair } from './ui.js';
import { glyphSVG } from './glyphs.js';

/** Landscape app/system tile (tvOS icon). */
export function appTile(app, small) {
  const el = h('div', { class: 'tile app' + (small ? ' sm' : ''), role: 'listitem', style: { '--a1': app.a1 || '#5a6070', '--a2': app.a2 || '#2b2f3a' } },
    h('div', { class: 'tilt' }, h('div', { class: 'face' },
      h('div', { class: 'gloss' }),
      app.icon ? h('img', { class: 'glyph', src: app.icon, alt: '' }) : h('div', { class: 'glyph', html: glyphSVG(app) }),
      h('div', { class: 'sheen' }))),
    h('div', { class: 'label' }, app.name));
  return el;
}

/** Portrait poster tile for titles. `item` is a catalog preview or a library item. */
export function posterTile(item, { progress = 0, badge } = {}) {
  const art = poster(item.poster);
  const pct = Math.max(0, Math.min(100, progress || 0));
  return h('div', { class: 'tile poster', role: 'listitem' },
    h('div', { class: 'tilt' }, h('div', { class: 'face' },
      art ? h('img', { class: 'art', src: art, loading: 'lazy', alt: item.name || '', onerror(e) { e.target.remove(); } }) : null,
      h('div', { class: 'ph' }, item.name || ''),               // shows through when there is no artwork
      pct > 1 ? h('div', { class: 'prog' }, h('i', { style: { width: pct + '%' } })) : null,
      badge ? h('div', { class: 'badge' }, badge) : null,
      h('div', { class: 'sheen' }))));
}

/* ---------- top shelf: big backdrop + title block that crossfades as focus moves ---------- */
export class Shelf {
  constructor(root) {
    this.root = root;
    this.panes = [0, 1].map(() => {
      const p = h('div', { class: 'shelf-item' },
        h('div', { class: 'shelf-art' }, h('img', { class: 'bd', alt: '' }), h('div', { class: 'glyph-bg' })),
        h('div', { class: 'shelf-text' }, h('div', { class: 'logo-wrap' }, h('img', { class: 'logo', alt: '' }), h('h1', {})), h('div', { class: 'meta' }), h('p', {}), h('div', { class: 'shelf-prog' }, h('i'))));
      root.append(p);
      return p;
    });
    this.cur = 0; this.key = null;
  }
  show(info) {
    const k = JSON.stringify([info.title, info.bg, info.id]);
    if (k === this.key) return; this.key = k;
    this.cur ^= 1;
    const p = this.panes[this.cur];
    const [a1, a2] = info.colors || huePair(info.id || info.title);
    p.style.setProperty('--a1', a1); p.style.setProperty('--a2', a2);
    const bd = p.querySelector('.bd'), logo = p.querySelector('.logo'), h1 = p.querySelector('h1');
    bd.classList.remove('ready'); bd.removeAttribute('src');
    if (info.bg) { bd.onload = () => bd.classList.add('ready'); bd.onerror = () => bd.removeAttribute('src'); bd.src = info.bg; }
    const gb = p.querySelector('.glyph-bg'); gb.innerHTML = info.glyphHTML || '';
    logo.classList.remove('ready'); logo.removeAttribute('src'); h1.hidden = false; h1.textContent = info.title || '';
    if (info.logo) {
      logo.onload = () => { logo.classList.add('ready'); h1.hidden = true; };
      logo.onerror = () => { logo.removeAttribute('src'); };
      logo.src = info.logo;
    }
    p.querySelector('.meta').textContent = (info.meta || []).filter(Boolean).join('   ·   ');
    p.querySelector('.meta').hidden = !(info.meta && info.meta.some(Boolean));
    p.querySelector('p').textContent = info.desc || '';
    const sp = p.querySelector('.shelf-prog'); sp.hidden = !(info.progress > 1); sp.firstChild.style.width = (info.progress || 0) + '%';
    this.panes.forEach((q, i) => q.classList.toggle('on', i === this.cur));
  }
  hide() { this.key = null; this.panes.forEach((q) => q.classList.remove('on')); }
}

/** Landscape result tile (16:9 backdrop) used by Search, like the tvOS search results. */
export function wideTile(item) {
  const id = item.id || item._id || '';
  const imdb = /^tt\d+/.test(id) ? String(id).split(':')[0] : null;
  const art = item.background || (imdb && `https://images.metahub.space/background/small/${imdb}/img`) || poster(item.poster);
  return h('div', { class: 'tile wide', role: 'listitem' },
    h('div', { class: 'tilt' }, h('div', { class: 'face' },
      h('div', { class: 'ph' }, item.name || ''),
      art ? h('img', { class: 'art', src: art, loading: 'lazy', alt: item.name || '', onerror(e) { const p = poster(item.poster); if (p && e.target.src !== p) e.target.src = p; else e.target.remove(); } }) : null,
      h('div', { class: 'wide-title' }, item.name || ''),
      h('div', { class: 'sheen' }))));
}
