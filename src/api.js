// Client for our own local server (launch apps, mpv, power, phone-remote events).
const j = (r) => r.json();
export const get = (p) => fetch(p).then(j);
export const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(j).catch(() => null);

const handlers = new Map();
export const onEvent = (type, fn) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type).delete(fn); };

let es, retry = 500;
export function connectEvents() {
  if (es) return;
  const open = () => {
    es = new EventSource('/api/events');
    es.onopen = () => { retry = 500; (handlers.get('open') || []).forEach((f) => f()); };
    es.onmessage = (m) => { let e; try { e = JSON.parse(m.data); } catch (_) { return; } (handlers.get(e.type) || []).forEach((f) => f(e)); };
    es.onerror = () => { es.close(); es = null; setTimeout(open, retry); retry = Math.min(retry * 2, 8000); };
  };
  open();
}
