# CLAUDE.md: streaming computer

Read this first. `README.md` is the user-facing doc; this file is what an agent needs to keep working without re-deriving anything.

## What this is

A smart-TV-style front end for a Linux laptop plugged into a TV, controlled from a phone.

- **Launcher UI**: tvOS 26 (Apple TV, "Liquid Glass") look-alike, full-screen in a kiosk browser. Original art only, no Apple assets or fonts.
- **Stremio built in**: the official `stremio-core` engine (WASM) runs in the page. The user signs in with their Stremio account; library, progress, watched episodes and addons sync with the official apps. There is no backend of ours.
- **mpv** plays the stream URLs. mpv's position/duration/pause are fed back into the core's `Player` model so progress and "watched" sync to the account. Playback controls (scrubber, captions, audio) are drawn inside mpv by `server/playerui.py` (see "Player controls").
- **Configured apps**: none by default (YouTube was removed on request). The launch machinery still works: an entry in `apps` of the config opens in its own kiosk window, shows as a tile row on Home, as an Apps section on the phone remote, and the phone Home button kills it.
- **Phone remote**: a vanilla-JS web app (D-pad, swipe/mouse touchpad, keyboard that fills the TV's focused text field, volume, power).
- **Installer** for Linux Mint (apt + LightDM autologin + autostart).

## The two machines (important)

| | Role | OS | Notes |
|---|---|---|---|
| This laptop | **dev** | Arch, **sway (swayfx) on Wayland** | Hybrid graphics: Intel Iris Xe + NVIDIA RTX 4050 (optimus-manager files in `/etc/X11/xorg.conf.d`). Has **mpv 0.41**, ffmpeg, grim, slurp, swaymsg, wtype, Firefox 159 (system) and LibreWolf (the user opens `localhost:8080` in it to look at the launcher). No `xdotool`. Three monitors; the second output is 2560x1440 at x=1920. |
| Old ThinkPad | **target (TV)** | Linux Mint (X11, LightDM, Cinnamon) | already runs Stremio fine; Intel graphics. Nothing here has been run on it yet. |

- The user runs several Claude sessions on the dev laptop at once (Alacritty windows). Another session can edit the same files: `src/nav.js` once ended up with the same fix applied twice, which broke `npm run build` with "symbol already declared". After any build failure, check for duplicated blocks first.
- The user's pacman database was stale (`mujs` 404) at one point; the fix is `sudo pacman -Syu` (never `-Sy` alone).

## Layout

```
server/server.py        stdlib-only Python (3.8+). HTTP + SSE hub, mpv IPC controller, app launcher, input routing, power
server/playerui.py      tvOS-style playback controls drawn INSIDE mpv (ASS vector overlay via the `osd-overlay` IPC command)
src/                    front-end source (vanilla ES modules, bundled by esbuild into web/dist/app.js)
  app.js                boot, wallpaper, launch zoom, system sheets, key/SSE routing. exposes window.__app for tests
  core.js               the ONLY file that talks to stremio-core-web (promise wrapper over the worker bridge)
  nav.js / focus.js     screen stack + key routing (also opens the sidebar and pauses wallpaper drift) / directional focus Grid (+ `aim` hook) and keepVisible()
  sidebar.js            tvOS-style floating glass side menu: Search, Home, Library
  text.js / sheet.js    text-entry target + on-screen keyboard (compact one-line for Search, 7-column for Login) / alert sheet
  tiles.js / glyphs.js  appTile, posterTile, wideTile (16:9 Search results), the top Shelf / original SVG glyphs
  quality.js            parses addon stream labels, ranks them for the device (cached-marker patterns configurable via `playback.cachedPatterns`)
  api.js / ui.js        server client + SSE / DOM helpers (h(), toast, huePair, SVG icons)
  screens/              home, detail, streams, playing, search, library, login
web/launcher/           index.html + launcher.css (all TV styling; 1rem = 10px @1920 wide). Later rules override earlier ones: the file is layered (base, glass, search, polish pass at the end)
web/remote/             phone app (index.html, remote.css, remote.js, manifest, icons)
web/dist/               BUILT output, committed on purpose (TV box has no Node): app.js, core-worker.js, stremio_core_web_bg.wasm
bin/streamingcomputer-session   boots server + kiosk browser loop on the TV (writes the Firefox user.js)
install/install.sh      Mint installer (--dry-run, --user-only, --lite, --no-autologin, --uninstall)
config/config.json      defaults (`"apps": []`); user overrides in ~/.config/streamingcomputer/config.json (merged)
tools/                  e2e tests, test_playerui.py, fake mpv, mock addon, pack script
```

## Commands

```bash
npm install
npm run build        # minified production bundle into web/dist (ALWAYS run before testing deploy/pack; dist is committed)
npm run dev          # unminified build
npm test             # node tools/e2e-regression.mjs  (21 checks, ~4 min, needs Firefox; uses the network for live Cinemeta). Run it in the background and watch the log; 21/21 passed at the last run
python3 tools/test_playerui.py         # overlay state machine + rendering logic, no mpv needed
npm run pack         # tarball for the TV machine (no node_modules)
python3 server/server.py --port 8080   # run it; launcher at /, remote at /remote
./install/install.sh --dry-run
```

CSS and HTML in `web/launcher` and `web/remote` are served straight from disk (no rebuild). Anything under `src/` needs `npm run build`. A running server must be restarted to pick up changes in `server/*.py` (the user once saw YouTube still served by an old process on 8080).

## UI design state (what the user asked for and what exists)

The user wants it to look and feel **exactly like Apple TV (tvOS 26, Liquid Glass)**. They send reference screenshots (grim) into `~/Pictures/`; read the newest ones before restyling:
- `20261110_18h29m10s_grim.png`: tvOS TV-app rows. **Focused poster = thin bright rounded glass outline + small lift**, others plain. Implemented as `.tile .face::before` (an overlay above the art; inset box-shadows get painted over by images).
- `20261110_18h30m17s_grim.png`: tvOS player: bottom gradient, small "S1, E2 · Deuce" over a big title, thin scrubber with elapsed time under the playhead and `-remaining` at right, round glass Captions/Audio buttons bottom-right.
- `20261110_18h39m06s_grim.png`: tvOS search (below).
Apple's own press images can be downloaded from the tvOS 26 Newsroom page (`apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/`, `images/.../article/*.jpg.large.jpg`) and 9to5Mac tvOS 26 articles; the video-poster URLs 404. Web research found no official description of a tvOS 26 search redesign; Apple's WWDC20 session says the keyboard is one line in many languages.

Decisions made (don't undo without being asked):
- **No top bar.** Search and Library live in a **left sidebar** (`sidebar.js`): floating rounded glass panel, items Search / Home / Library, white pill on the focused item. It opens with **Left at the left edge** of Home, Search or Library (screens opt in with `this.sidebar = true`; `nav.key` calls `sidebar.open()`), closes with Right/Back/Enter. While open, `body.sb-open` shifts `#stage` right by 9rem and dims it. **Never scale the page** (the user disliked the zoom-out; the backdrop image showed gaps). Choosing an item pops to the base screen first so pages never stack. Typing is ignored while it is open.
- **Home** has no app/Search/Library row. Rows: Continue Watching, board catalogs (movie/series only), System (Phone Remote, Account, Quality, Sleep, Restart, Power Off). It **starts focused on the first content row** (`Home.moved` is set from real arrow keys in `onKey`, so refreshes don't steal focus); "Loading…" shows until the first content row exists.
- **Liquid Glass tokens** are CSS variables (`--glass-tint`, `--glass-rim`, `--glass-drop`, `--glass-blur`). Clock/network capsule top-right, sheets, sidebar, toast, chips, buttons, fields, keys all use tint + bright edge. Backdrop blur only on transient surfaces (sidebar, sheets, toast).
- **Search** follows the user's tvOS screenshot: flat/glass field with a magnifier (no big title), one-line keyboard (`123`, `SPACE` chips, a-z, delete glyph; `123` swaps the row to digits/symbols), a **Search In: All / Movies / TV Shows** row (filters results), thin dividers over section titles, **16:9 backdrop tiles** with the title on them (`wideTile`, metahub backgrounds). **Before anything is typed it shows Popular Movies / Popular TV Shows** from the board catalogs. Multiple catalogs of one type are merged and de-duplicated. Typing debounces 500 ms. Down from the field lands on `a`. Search suggestions were tried and removed (Stremio has no suggestion source; the screenshot has none).
- Library, Streams, Detail and Login use the same glass chips/buttons/fields but have **not** been compared to Apple reference screenshots yet.
- The phone remote's last tab is "Power" (power icon); the "Open" apps section only appears if apps are configured.

## Player controls (mpv overlay)

mpv is fullscreen above the kiosk browser, so the page can't draw over video. `server/playerui.py` keeps a small state machine (hidden / controls / menu) and renders ASS shapes + text with the `osd-overlay` IPC command in three layers (7 background+title+buttons, 8 scrubber+times, 9 menu; 1920x1080 space). A layer is re-sent only when its data changed because libass re-rasterizes the whole layer; the 40-layer stacked gradient is costly, so it lives in the rarely-changing layer. Build gradients from stacked translucent layers that each run to the bottom (separate strips show seams; 18 layers visibly band).

- **Keys** (same handler for the phone remote, `POST /api/key`, and the TV's physical keyboard): hidden: Left/Right seek 10 s and show, OK pause, Up/Down reveal, Back exits. Controls: Left/Right seek, OK pause, **Up to the Captions/Audio buttons (they sit above the scrubber), Down back to the scrubber**, Back hides (auto-hide after 5 s unless paused). Buttons: Left/Right switch, OK opens the menu. Menu: Up/Down, OK picks, Back/Left/Right closes.
- **Physical keyboard on the TV**: mpv has window focus, so it ignores keys unless told. `Mpv._write_bindings` writes an input.conf (arrows repeatable, Enter, Space, Esc, Backspace, Menu) binding to `script-message sc-key <Key>`; `Mpv._handle` turns the resulting IPC `client-message` into `handle_key()`.
- **Languages/captions**: tracks come from mpv's observed `track-list`; picking sets `sid`/`aid` (Off = `sid no`) and is saved to `<DATA>/player_prefs.json` (`alang`, `slang`, `subs: off`) and applied on the next start as `--alang/--slang/--sid=no`. Addon subtitles are added by `Playing.addSubtitles` for **every language** (max 2 per language, 40 total) via `/api/player/subs` `{subs:[{url,lang}]}` -> `sub-add ... auto <title> <lang>` so they show in the menu.
- The launcher sends `title` and `subtitle` separately to `/api/player/start`. mpv runs with `--osd-level=0 --osd-bar=no --no-input-default-bindings --input-conf=<generated>`.
- The mpv socket send is bounded by the reader's 1 s socket timeout; `PlayerUI` holds its own `RLock` and calls `Mpv.cmd` (lock order ui -> mpv, never the reverse). One verification run hung once and could not be reproduced.
- Verified on dev with real mpv 0.41 (windowed): overlay, both menus, live track switching, prefs file, double-Back exit, keyboard path via mpv's `keypress` command. **Not verified**: fullscreen, X11, the ThinkPad, a real keyboard.

## Architecture in one paragraph

The server owns "who has the screen": `STATE.active` is `launcher | mpv | app`. Remote keys (`POST /api/key`) route by that: launcher gets them over SSE (`/api/events`, event `key`), mpv goes through `PlayerUI.key()`, an external app gets real keystrokes via `xdotool` (`wtype` fallback). The launcher posts its focused text field to `/api/ui` so the phone shows a matching text box; phone text arrives as SSE `text`. mpv runs with `--input-ipc-server`; a reader thread observes `time-pos/duration/pause/eof-reached/track-list` and republishes `player` events (time throttled to ~1/s). The launcher's `Playing` screen turns those into core `Player` actions (`TimeChanged` every 5 s, `Seek`, `PausedChanged`, `Ended`) and, on `exit`, persists the final position and pops back to the detail page. Home (`POST /api/home`) stops mpv, kills the app process group and publishes `home`.

## stremio-core facts (verified; see also memory `stremio-core-notes`)

- Pinned `@stremio/stremio-core-web@0.66.0` (MIT). The core repo's default branch is `development`. stremio-web (UI) is GPL-2.0: reference only, don't copy.
- Needs bundling (worker is CJS; wasm via esbuild `file` loader). Bridge: `new Bridge(window, worker)`; calls `init`, `getState(field)`, `dispatch(action, field, hash)`; events arrive on `window.onCoreEvent`.
- **To discover any action shape, dispatch a bogus variant**: the serde error lists the valid ones.
- Login: `Ctx → Authenticate {type:'Login', email, password, facebook:false}`. **Error events echo the whole request including the password** in `source`. Never log events; use only `error.message`. (This leaked once during the spike; fixed in `core.js` and the login screen, with a test.)
- `continue_watching_preview` is derived from the library (no Load). Library item id is `_id`; episode is `state.videoId` (preview) / `state.video_id` (full item).
- Board needs `LoadRange` after `Load CatalogsWithExtra`. Search = same model with `extra:[['search', q]]` (tuples). Library = `Load LibraryWithFilters {request:{type,sort,page}}`. Catalog items have `id`, `name`, `poster`, `type`; artwork for imdb ids is deterministic on metahub (`images.metahub.space/{background|logo|poster}/{small|medium}/{imdb}/img`).
- Streams state is `[{addon, content:{type:'Ready'|'Loading'|'Err', content:[…]}}]`; `addon` has no `transportUrl`, so look it up in `ctx.profile.addons` by manifest id when building Player requests.
- Playback progress must go through the **`Player` model** (`Load Player {stream, streamRequest, metaRequest, subtitlesPath}` then `TimeChanged/Seek {time,duration,device}` in ms, `Ended`). The simpler `MetaDetails.ExternalPlayerProgressChanged` never sets duration, so it can't mark watched.
- The core fires many `meta_details` events while a title loads (streams arriving etc.); screens must not rebuild on each one (see performance).
- The core logs harmless errors probing a local streaming server at `127.0.0.1:11470`; not used (addons return direct HTTP URLs).
- Playback uses whatever direct HTTP stream URLs the user's own addons return; mpv follows redirects. We never touch any service API key.

## Testing (how and the traps)

- No Chrome (the extension was never connected). Tests use `puppeteer-core` driving system Firefox over WebDriver BiDi (`tools/pt.mjs`). **Headless Firefox here renders in software**: frame times are ~83 ms vs ~17 ms on a GPU, and `backdrop-filter` is supported by the engine (`CSS.supports` true, Firefox 159) but screenshots do not show the blur. Don't tune blur from those screenshots.
- `tools/e2e-helpers.mjs`: `startServer()` runs the real server with `STREAM_MPV=tools/fake_mpv.py`, `STREAM_DRY_POWER=1`, `STREAM_DRY_APPS=1`, `STREAM_DATA=<dir>/data`, and kills any stale server on the port first; `SHOTS` is a hard-coded old scratchpad path (created on demand; `shot(page,name)` writes there). `startMock()` runs `tools/mock-addon.py` (fake addon streams) on 8098. Tests use port **8097** (not 8099/8080).
- URL flags: `?static` (no animation, for screenshots), `?lite`. `window.__app` = `{A, nav, core, api, sheet}` for assertions (`__app.A.openTitle/openSearch/openLibrary/openLogin/system`, `__app.nav.home()/pop()/top()`, `top().grid`).
- The anonymous profile can't produce real streams, so tests install the mock addon with `Ctx InstallAddon` and read library state via `core.getState('meta_details')`.
- Scratch files: the session scratchpad directory can disappear mid-session. Use `./.tmp-test/` inside the project for throwaway scripts/media and **delete it when done** (it was never committed). Don't put big media in it (a first `testsrc2` encode was 572 MB; use `-crf 42 -preset veryfast`).
- **Useful measurement recipes** (all were used): rAF frame deltas while pressing keys (median/p90) with a suspect layer toggled via `page.addStyleTag`; sample an element's `getBoundingClientRect().top` per frame after opening a page to count/measure layout movement (the detail page moved 212 px in 4 jumps before the fix, <1 px after); a random-walk of arrow keys on every screen asserting the `.focus` element stays >=85% inside the viewport (found no violations); `window.__app` for state.
- **Real mpv on this laptop** (works, briefly shows a window on the user's screen; clean up after): `STREAM_MPV=<wrapper>` where the wrapper is `exec mpv "$@" --fs=no --geometry=1280x720 --ao=null`; make a test video with ffmpeg (`testsrc2` + two `sine` audio + two `-f srt` subtitle inputs with `-metadata:s:a:0 language=eng` etc.); start via `POST /api/player/start {url:<local path>,title,subtitle,start}`; send keys with `POST /api/key`; find the window with `swaymsg -t get_tree` (name ends with `- mpv`, `app_id` is None because it is an XWayland window) and capture with `grim -g "X,Y WxH"` (plain `grim` captures all three monitors, ~11000 px wide); simulate a physical keyboard with the IPC command `keypress <NAME>`. Stale `streamingcomputer-mpv-<pid>.sock/.input.conf` files in `$XDG_RUNTIME_DIR` break "newest socket" lookups: delete them.
- **Traps I hit:**
  - A crashed test left a stale server holding the port, so later runs silently talked to the old one. `startServer` now kills it; keep that. Also kill your own test servers (`fuser -k 8097/tcp`).
  - `pkill -f <pattern>` matches your own bash command line and kills the shell (exit 144). Use `fuser -k PORT/tcp` or exact `pkill -x`.
  - `/api/key` while an external app is active injects a **real keystroke into the dev desktop** via `wtype`. Don't call it in tests with `active=app`. With `active=mpv` it is safe (goes to the overlay).
  - Non-dry app launches spawn real browsers: put a fake `chromium` earlier on PATH instead. Don't let tests write to `~/.local/share/streamingcomputer` (use `STREAM_DATA`).
  - CSS class collisions on the phone remote (`.ok` was both a status class and the OK button). Status classes are now `is-ok/is-bad`, the button is `.okbtn`.
  - Appending CSS overrides: later rules win at equal specificity. A new `.search .key.wide` background overrode `.search .key.focus`; fixed with `.search .key.wide.focus`. Re-check focus states after adding glass backgrounds.
  - An element created after the code that appends it (`this.sug` defined after `this.scroller`) silently renders nothing (`h()` skips null). The unit probe: log `children.length` and `getBoundingClientRect()`.

## Conventions

- Vanilla JS, no framework, no runtime dependencies besides the core. Keep bundle small: the target is an old ThinkPad.
- `core.js` is the only importer of `@stremio/stremio-core-web`. Screens never dispatch raw actions except through `core.js` helpers (a couple of `core.dispatch` uses exist in library paging and are acceptable).
- Grids: when replacing a screen's rows call `grid.clearFocus()` **before** assigning `grid.rows` (stale `.focus` classes bug). Use `Grid`'s `aim` hook to control landing column between rows. `Grid.set()` always calls `onFocus` (even when "silent"), so `onFocus` runs on re-render too.
- **Performance target: smooth on an old, not-new ThinkPad (Intel graphics).** Every UI change must keep row scrolling, focus moves and screen transitions fluid there; if in doubt, pick the cheaper option and keep lite mode working. Lessons (measured in software-rendered Firefox):
  - The always-running wallpaper drift took frames from ~17 ms to ~83 ms while navigating, so it pauses on every key press and resumes ~1.5 s later (`body.moving`, set in `nav.key`).
  - Never put `backdrop-filter` on permanently visible elements (clock capsule, System tiles, Search field/keys/chips): it re-blurs the moving wallpaper every frame. Blur is for transient surfaces (sidebar, sheets, toast).
  - Focus "breathing" (tilt + sheen) is a CSS keyframe animation on the compositor. There is **no per-frame JS loop** (the old rAF tilt restyled the focused tile 60x/s); the sheen no longer uses `mix-blend-mode`.
  - `keepVisible` (focus.js) moves a row only when the focused item would leave the screen (right margin / left margin), using layout (`offsetLeft`) and the row's *current* transform, never an animating `getBoundingClientRect`. The old version fed half-animated measurements back into the next target when Right was held, so rows ran off screen and jittered.
  - Home only does vertical/wallpaper work when the row changes (`_placedRow`) and defers the big backdrop + wallpaper change until the user pauses (key repeat < 220 ms).
  - Pages that re-render on core events (detail, library) compute a **signature of what is visible** and skip redraws when it is unchanged; late-loading parts (logo, description) have reserved space (`.d-head`, `.d-desc`) so nothing shifts; a redraw repositions without animating.
  - Measure with rAF deltas or element-position sampling, with and without the suspect layer.
- Animations: transform/opacity only; no animated blur. `body.away` pauses CSS animation while another app/mpv is in front. `lite` mode (config or `?lite`) drops the animated wallpaper, sheen, tilt, backdrop blur; **it keeps the masks** (removing them leaves hard edges).
- Server stays stdlib-only. A bad user config must never stop boot (it is caught and logged).
- Secrets/privacy: never log or persist the Stremio password, never print full stream URLs (they can carry account tokens; the spike printed only hosts). Treat the user's email as private.
- Design: tvOS look. Don't add kickers/eyebrow labels above headings, gradient text, or nested cards. Fonts: Inter if installed, else system sans (the dev laptop has no Inter; Noto Sans is used; installer adds `fonts-inter` on Mint). The impeccable skill's detector flagged Inter and the glow wallpaper; both are deliberate for this brief.

## Verified vs not verified

**Verified by automated tests (fakes where noted):** boot and navigation; all screens; remote→TV control (D-pad, swipe, live typing, Home); sidebar open/choose from Home and Search; search via keyboard/phone/on-screen keys; stream ranking; playback lifecycle with **fake mpv**; progress/watched sync into the **real core** (local profile); resume label and Continue Watching; Home-during-play persistence; mpv missing; lite mode; login error path; server process handling for external apps (fake `chromium`); installer in `--dry-run` and `--user-only`; session script with a fake browser. `tools/test_playerui.py` covers the overlay logic. The focus-visibility random walk and the layout-movement probes passed (ad hoc scripts, not in the suite).

**Verified on the dev laptop with real mpv 0.41 (windowed, XWayland):** overlay rendering, menus, track switching, prefs, keyboard via `keypress`.

**Verified by the user's real account earlier (spike):** sign-in works, 100 Continue Watching items synced, the user's addons returned 100+ direct-HTTP streams, all with instant-play markers in the labels.

**NOT verified (needs the real hardware/session; suspect these first when something fails on the TV):**
1. Fullscreen mpv on a display; layering over the kiosk browser; `--hwdec=auto-safe`; the overlay under X11.
2. Real addon stream links through mpv (redirects, non-cached streams, `behaviorHints.proxyHeaders` → `--http-header-fields`).
3. `xdotool` key/mouse injection on X11; text typing into external apps.
4. Per-app `userAgent` overrides (Firefox via a per-app `user.js` profile, Chromium via `--user-agent`).
5. `install.sh` real apt/LightDM/gsettings/ufw steps (only dry-run + user-only exercised). Package names `fonts-inter`, `intel-media-va-driver`, `i965-va-driver`, `unclutter` are checked with `apt-cache` but not confirmed on Mint's release.
6. Whether the Firefox kiosk is fast enough on the ThinkPad (user says Stremio's own app is fine there). Lite mode exists as a lever; the installer enables it for ≤2 cores or <3.5 GB RAM. The glass blur on sidebar/sheets has not been seen on a real GPU.
7. The writing of a real watched/progress update to the user's account (tested only on an anonymous local profile).
8. A real physical keyboard driving the overlay.

## Known issue in progress: video tearing in mpv on the dev laptop

The user reports **tearing (vsync-like) in the mpv video** on this Arch/sway laptop. Findings so far (nothing applied yet):
- mpv here runs as an **XWayland window**: in `swaymsg -t get_tree` it has `app_id` None and `shell xwayland`, even though `WAYLAND_DISPLAY=wayland-1` is set. This build lists GPU contexts `wayland`, `waylandvk`, `x11egl`, `x11`, `x11vk`, `drm`, `displayvk`.
- Hybrid graphics (Intel Iris Xe + NVIDIA RTX 4050; optimus-manager). The video may be rendered/presented across GPUs.
- Candidate fixes to try, in order: force a native Wayland window when `WAYLAND_DISPLAY` is set (`--gpu-context=wayland`, check `app_id` becomes `mpv` in the sway tree); `--vo=gpu-next` (mpv 0.41 default) with `--video-sync=display-resample`; make sure mpv uses one GPU consistently (try `DRI_PRIME`/`__NV_PRIME_RENDER_OFFLOAD` settings or force the Intel GPU); on X11 (ThinkPad) `--x11-bypass-compositor=no`, `--gpu-context=x11egl`, and an Intel `TearFree` xorg option documented for the installer. Keep any such arguments in `Mpv.start` conditional on the session type so the ThinkPad path is unchanged. Re-verify by looking at a panning test video (`testsrc2`) in the real window.
- Also unknown: whether the tearing the user sees is in the video or the overlay. They answered "Video in mpv" on "This laptop (Arch, sway)".

## Open work / ideas

- Fix the mpv tearing above.
- Overlay extras from the tvOS screenshot: Info / InSight / Continue Watching style buttons, next-episode, skip-intro, scrub-to-time (only 10 s steps today), a phone-remote shortcut for captions/audio.
- Auto-play next episode (core already advances `video_id` on `Ended`; UI just returns to the detail page).
- Compare Library, Streams, Detail and Login against Apple reference screenshots (only Home focus, Search and the player have references so far).
- Add e2e coverage for the sidebar, Search browse/filter and overlay (only `test_playerui.py` and ad hoc probes exist). The two e2e checks that used the old Home Search tile were already updated to the sidebar.
- Show addon install/config entry points? Currently addons are managed in the official Stremio app.
- Wake-on-LAN / resume handling; pairing PIN UI on the TV (config `pin` exists, remote prompts for it, the TV has no screen to set it).
- Possible: a Chromium/Flatpak path in the installer (Mint blocks the snap Chromium; Firefox is the default and works).
- `tools/e2e-home|flow|series|misc|remote.mjs` are older exploratory scripts (print, don't assert). `e2e-regression.mjs` is the real suite; fold or delete the rest.

## Working with the user

Terse, wants results and honest status. They test on the dev laptop (LibreWolf for the launcher, real mpv) and on the Mint box themselves, and paste output or screenshots back; screenshots land in `~/Pictures` (grim). They ask for exact tvOS fidelity and give corrections in one line ("up and down are reversed", "dont zoom out just move it to the side"); apply them literally and report. They sometimes interrupt a tool call to redirect (e.g. "put all info another agent may need into the claude md"); do the redirected thing. A truncated paste of a previous assistant message with no question means "nothing new yet"; ask what they want. Ask when the answer is theirs (e.g. which machine/where a bug appears), otherwise act. Don't claim something works on the target machine unless it was run there. After finishing UI changes, run `npm run build` and `npm test`, and keep this file current.
