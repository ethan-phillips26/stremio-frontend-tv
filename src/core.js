// Thin, promise-based wrapper around stremio-core-web (runs in a Web Worker).
// Everything the UI needs from Stremio goes through here; no other file touches the bridge.
const Bridge = require('@stremio/stremio-core-web/bridge');

const worker = new Worker('./core-worker.js');
const bridge = new Bridge(window, worker);        // worker -> page calls: localStorage, location.hash
const listeners = new Map();                       // field -> Set<fn>
let ready = null;

window.onCoreEvent = (e) => {
  if (!e) return;
  if (e.name === 'NewState') (e.args || []).forEach((f) => (listeners.get(f) || []).forEach((fn) => fn(f)));
  else if (e.name === 'CoreEvent' && e.args && e.args.event === 'Error') {
    // Never forward e.args.source: for auth errors it echoes the request, including the password.
    const er = e.args.args && e.args.args.error;
    if (er) (listeners.get('error') || []).forEach((fn) => fn(er));
  }
};

const call = (name, args) => bridge.call([name], args);
export const getState = (field) => call('getState', [field]);
export const dispatch = (action, field) => call('dispatch', [action, field, '']);
export const on = (field, fn) => { if (!listeners.has(field)) listeners.set(field, new Set()); listeners.get(field).add(fn); return () => listeners.get(field).delete(fn); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function init() {
  if (!ready) ready = call('init', [{ appVersion: '0.1.0', shellVersion: null }]);
  return ready;
}

/** Poll a state field until pred(state) is truthy (or timeout). Resolves with the last state either way. */
export async function waitFor(field, pred, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const s = await getState(field);
    if (pred(s) || Date.now() - t0 > ms) return s;
    await sleep(200);
  }
}

/* ---------- account ---------- */
export const profile = async () => (await getState('ctx')).profile;
export const isLoggedIn = async () => !!(await profile()).auth;

export async function login(email, password) {
  const errors = [];
  const off = on('error', (e) => errors.push(e));
  try {
    await dispatch({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email, password, facebook: false } } }, 'ctx');
    const p = await waitFor('ctx', (s) => s.profile.auth || errors.length, 15000);
    if (p.profile.auth) { await sleep(1200); return { ok: true }; }
    return { ok: false, error: (errors[0] && errors[0].message) || 'Could not sign in' };
  } finally { off(); }
}
export const logout = () => dispatch({ action: 'Ctx', args: { action: 'Logout' } }, 'ctx');

/* ---------- browsing ---------- */
export async function loadBoard(count = 8) {
  await dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { type: null, extra: [] } } }, 'board');
  await dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: count } } }, 'board');
}
export const board = () => getState('board');
export const continueWatching = async () => (await getState('continue_watching_preview')).items || [];

export async function search(query) {
  await dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { type: null, extra: [['search', query]] } } }, 'search');
  await dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: 4 } } }, 'search');
}
export const searchState = () => getState('search');

export async function loadLibrary(type = null, sort = 'lastwatched') {
  await dispatch({ action: 'Load', args: { model: 'LibraryWithFilters', args: { request: { type, sort, page: 1 } } } }, 'library');
}
export const library = () => getState('library');

export async function loadMeta(type, id, videoId) {
  await dispatch({ action: 'Load', args: { model: 'MetaDetails', args: {
    metaPath: { resource: 'meta', type, id, extra: [] },
    streamPath: type === 'movie' || videoId ? { resource: 'stream', type, id: videoId || id, extra: [] } : null,
  } } }, 'meta_details');
}
export const metaDetails = () => getState('meta_details');
export const unloadMeta = () => dispatch({ action: 'Unload' }, 'meta_details');

export const addToLibrary = (item) => dispatch({ action: 'Ctx', args: { action: 'AddToLibrary', args: item } }, 'ctx');
export const removeFromLibrary = (id) => dispatch({ action: 'Ctx', args: { action: 'RemoveFromLibrary', args: id } }, 'ctx');
export const markWatched = (isWatched) => dispatch({ action: 'MetaDetails', args: { action: 'MarkAsWatched', args: isWatched } }, 'meta_details');
export const markVideoWatched = (video, isWatched) => dispatch({ action: 'MetaDetails', args: { action: 'MarkVideoAsWatched', args: [video, isWatched] } }, 'meta_details');

/* ---------- playback (mpv feeds time/duration into the core's Player model) ---------- */
export const loadPlayer = (sel) => dispatch({ action: 'Load', args: { model: 'Player', args: sel } }, 'player');
export const unloadPlayer = () => dispatch({ action: 'Unload' }, 'player');
export const playerState = () => getState('player');
const P = (a) => dispatch({ action: 'Player', args: a }, 'player');
export const timeChanged = (time, duration) => P({ action: 'TimeChanged', args: { time, duration, device: 'mpv' } });
export const seeked = (time, duration) => P({ action: 'Seek', args: { time, duration, device: 'mpv' } });
export const pausedChanged = (paused) => P({ action: 'PausedChanged', args: { paused } });
export const ended = () => P({ action: 'Ended' });
