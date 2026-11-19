'use strict';
// The Operate page: the cameras chosen here, live from the camera relay (no look-ahead, about a fifth of a second behind
// real life), steered with Xbox controllers through the browser's Gamepad API (no driver or plugin), or the buttons.
// Each controller drives one camera at a time (LB/RB to change); its readings go to the manager ten times a second while
// a stick or trigger is held (/api/operate/control), and the phone stops its gimbal by itself half a second after the last.
// A network PTZ camera is shown and steered here too: its picture from OBS, its moves over its own control API (the
// manager stops it when the readings stop), its presets as its Positions.
let csrf = '', state = null;
// A setup tech (users.py) has this page to set each gimbal camera's positions before the show: aiming, zoom and the
// Positions under each picture, and nothing that cuts, arms, streams or records.
const tech = () => window.concert?.session?.role === 'tech';
// How quick aiming and zooming are, 1 to 10, each kept in this browser (the bar's Aim and Zoom). 2026-10-25: "incredibly
// slow" on a tablet, at the old default of a sixth of the gimbal's speed for a full push; 6 is now 60% of it.
const DEFAULT_AIM = 6, DEFAULT_ZOOM = 6;
const kept = (key, fallback) => { try { const n = Number(localStorage.getItem(key)); return n >= 1 && n <= 10 ? Math.round(n) : fallback; } catch (error) { return fallback; } };
let aimLevel = kept('operate-aim', DEFAULT_AIM), zoomLevel = kept('operate-zoom', DEFAULT_ZOOM);
const keep = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (error) { /* this visit only */ } };
const result = document.querySelector('#result'), feeds = document.querySelector('#feeds'), choices = document.querySelector('#choices');
const tiles = new Map(), drives = new Map(), pads = new Map();          // camera id -> tile; gamepad index -> camera id; index -> last reading
// Zoom's speed against the manager's own (operate_zoom_speed, 1.25 doublings a second at a full trigger), for each level.
const ZOOM_TIMES = [0.4, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0, 4.0];
const aimMost = () => aimLevel * 10;                                     // the most a full push asks of the gimbal (of 100)
const zoomTimes = () => ZOOM_TIMES[zoomLevel - 1];
const COLOURS = ['#5fb4ee', '#f4a261', '#90be6d', '#f78fb3'];
const DEAD = 0.18, ZOOM_DEAD = 0.1, EVERY_MS = 100, SOONEST_MS = 45;   // the manager takes a reading every 40 ms at most
// A camera's live feed; the clickable demo (demo-site) gives its drawn stills instead, having no relay.
const feed = (id, again) => window.concertDemo?.feed ? window.concertDemo.feed(id) : `/api/operate/feed/${encodeURIComponent(id)}${again ? `?t=${Date.now()}` : ''}`;
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  // A reading not answered in 10 s is given up (concert.fetchJson), so that hung ones do not pile up.
  const { response: r, data, unreachable } = await window.concert.fetchJson(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) { const failure = new Error(data.detail || `${r.status}`); failure.unreachable = unreachable; throw failure; }
  return data;
}
async function act(path, body) { try { const answer = await api(path, body); result.textContent = ''; return answer; } catch (error) { concert.fail(error); return null; } }
// What a camera last answered to a controller's or the buttons' reading (operate_control's said): a refusal shown, as
// "S23+ 2: CAMERA_NOT_RUNNING …", rather than a press that silently does nothing; cleared once it works again.
const refused = new Map();
function controlAnswer(id, answer) {
  const said = answer?.said || null;
  if (said === (refused.get(id) || null)) return;
  const name = state?.cameras?.find(c => c.id === id)?.name || 'Camera';
  if (said) { refused.set(id, said); result.textContent = `${name}: ${said}`; }
  else { if (result.textContent === `${name}: ${refused.get(id)}`) result.textContent = ''; refused.delete(id); }
}
const send = (camera, command, parameters = {}) => act(`/api/cameras/${encodeURIComponent(camera)}/commands`, { request_id: crypto.randomUUID(), command, parameters });

async function enter(session) {
  csrf = session.csrf; document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#operate').hidden = false;
  if (window.concert) { window.concert.session = session; window.concert.nav(session.role); }
  document.body.classList.toggle('setup-tech', session.role === 'tech');
  // A setup tech is often on a phone with no controller: the on-screen arrows at first, unless this browser chose.
  let chose = null; try { chose = localStorage.getItem('operate.onscreen'); } catch (error) { /* none */ }
  if (session.role === 'tech' && chose === null) { onscreen = true; document.querySelector('#onscreen').checked = true; }
  await refresh(); window.concert.every(refresh, 1000);        // not while the page is hidden
  // Read about sixty times a second, on a timer rather than animation frames, which a browser stops for a page not in view.
  setInterval(() => poll(performance.now()), 16);
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { name: document.querySelector('#username').value, password: document.querySelector('#password').value })); } catch (error) { concert.fail(error); }
};
fetch('/api/session').then(r => r.ok ? r.json() : null).then(session => { if (session) enter(session); }).catch(() => {});

// Which cameras are shown: kept in this browser. At first, every camera in use, up to six (each shown is decoded live).
// A camera added since the choice was made is shown too, until it is unticked: the choice is kept with the cameras
// there were to choose from (operate.cameras.known), so one never offered is told from one turned off. (A network
// camera added after the phones was left out, and looked as if Operate did not have it.) A choice kept before that
// list was has only network cameras counted as new: they are the kind that came after it.
function chosen() {
  let ids = null, known = null;
  try { ids = JSON.parse(localStorage.getItem('operate.cameras') || 'null'); known = JSON.parse(localStorage.getItem('operate.cameras.known') || 'null'); } catch (error) { ids = null; }
  const usable = state.cameras.filter(c => c.in_use !== false);
  if (!Array.isArray(ids)) ids = usable.slice(0, 6).map(c => c.id);
  else {
    const added = usable.filter(c => !ids.includes(c.id) && (Array.isArray(known) ? !known.includes(c.id) : isNetwork(c)));
    if (added.length || !Array.isArray(known)) { ids = [...ids, ...added.map(c => c.id)]; keepChoice(ids); }
  }
  return usable.filter(c => ids.includes(c.id));
}
function keepChoice(ids) {
  try { localStorage.setItem('operate.cameras', JSON.stringify(ids)); localStorage.setItem('operate.cameras.known', JSON.stringify(state.cameras.map(c => c.id))); } catch (error) { /* kept for this visit only */ }
}
function choose(ids) { keepChoice(ids); draw(); }
// A network PTZ camera (netcams.py): no phone and no gimbal. Its picture comes from OBS, and it is turned and zoomed
// over its own control API once its card has the address (has_control), with the same stick, arrows and triggers.
const isNetwork = camera => camera?.kind === 'network';
const steerable = camera => isNetwork(camera) && !!camera.has_control;
const control = (id, body) => api('/api/operate/control', { camera_id: id, pan: 0, tilt: 0, zoom: 0, ...body }).then(answer => { controlAnswer(id, answer); return answer; }).catch(error => { if (!/rate limit/i.test(error.message)) concert.fail(error); });
// Stop and home, for either kind: a phone is sent its gimbal's commands, a network camera is told through the manager.
const stopCamera = id => isNetwork(state?.cameras.find(c => c.id === id)) ? control(id, { do: 'stop' }) : send(id, 'gimbal.stop');
const targetsOf = camera => camera?.gimbal?.targets || (isNetwork(camera) ? camera.netfollow?.targets : null);

// How many live pictures a second: 24 shows a zoom or a pan smoothly, for twice the work per camera watched.
const rate = document.querySelector('#rate');
api('/api/operate/settings').then(s => { rate.value = String(s.rate); }).catch(() => {});
rate.onchange = async () => {
  const done = await act('/api/operate/settings', { rate: Number(rate.value) });
  if (done && window.concertDemo?.feed) for (const [id, tile] of tiles) tile.querySelector('img').src = feed(id, true);
  else if (done && socket) socket.close();                 // opened again at the new rate
};

// The live pictures, every camera shown over one WebSocket (the manager's operate_feeds). A picture stream for each
// camera took all six connections a browser keeps to an address, and nothing else the page asked for got through: on
// a tablet, Arm reached the camera but the page never updated, and the controller hardly moved the gimbal.
let socket = null, socketOpen = false, sent = '';
const pictureUrls = new Map(), stalls = new Map();
// No frame for 5 seconds: hide the last one and say it is being waited for.
function stalled(id) {
  const tile = tiles.get(id); if (!tile) return;
  tile.querySelector('img').hidden = true; const line = tile.querySelector('.said'); line.hidden = false; line.textContent = 'Waiting for its picture…';
}
function pictures() {
  if (window.concertDemo?.feed) return;
  const wanted = () => JSON.stringify({ cameras: [...tiles.keys()] });
  if (socket) { if (socketOpen && wanted() !== sent) { sent = wanted(); socket.send(sent); } return; }
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/operate/feeds`);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => { socketOpen = true; sent = wanted(); socket.send(sent); };
  socket.onmessage = event => {
    if (typeof event.data === 'string') {
      const said = JSON.parse(event.data), tile = tiles.get(said.id);
      if (tile) { tile.querySelector('img').hidden = true; const line = tile.querySelector('.said'); line.hidden = false; line.textContent = `No live picture: ${said.error}`; }
      return;
    }
    const bytes = new Uint8Array(event.data), length = bytes[0], id = new TextDecoder().decode(bytes.subarray(1, 1 + length));
    const tile = tiles.get(id); if (!tile) return;
    const url = URL.createObjectURL(new Blob([bytes.subarray(1 + length)], { type: 'image/jpeg' }));
    tile.querySelector('img').src = url;
    clearTimeout(stalls.get(id)); stalls.set(id, setTimeout(() => stalled(id), 5000));
    const before = pictureUrls.get(id); pictureUrls.set(id, url); if (before) URL.revokeObjectURL(before);
  };
  socket.onclose = () => { socket = null; socketOpen = false; setTimeout(pictures, 2000); };
}

// One run at a time; asked again meanwhile, once more when done (concert.single).
const refresh = window.concert.single(async () => {
  try { state = await api(tech() ? '/api/operate/cameras' : '/api/cameras'); } catch (error) { window.concert.polled(!error.unreachable); window.concert.fail(error); return; }
  window.concert.polled(true);
  draw();
});

const showsContext = {
  words: () => window.concert?.mode?.words || { role: 'instrument', roles: 'instruments', anyone: 'anyone performing', crowd: 'crowd', example: 'banjo, harmonica, pedal steel' },
  ask: dialog => window.concert.ask(dialog), tell: message => { result.textContent = message; },
  direct: async body => { await act('/api/director', body); refresh(); },
  framing: async (id, framing) => { await act(`/api/cameras/${encodeURIComponent(id)}/framing`, { framing }); refresh(); } };
const followContext = camera => ({ role: window.concert?.session?.role || 'operator', off: !camera.online,
  post: (path, body) => api(path, body), send: (c, command, parameters) => send(c.id, command, parameters), refresh, tell: message => { result.textContent = message; } });

function draw() {
  if (!state) return;
  const shown = chosen(), director = state.director || {};
  const name = id => state.cameras.find(c => c.id === id)?.name || id;
  const programme = document.querySelector('#programme'), onAirNow = director.pair ? `On air: ${director.pair.map(name).join(' + ')}` : director.on_air ? `On air: ${name(director.on_air)}` : director.scene ? `On air: ${director.scene}` : '';
  if (programme.textContent !== onAirNow) programme.textContent = onAirNow;       // a live region: written to only when it changes
  drawProgramme(director);
  drawEvery(state.cameras.filter(c => c.in_use !== false));
  drawAuto(state.auto);
  document.querySelector('#main-stage').disabled = !director.default_shot;
  document.querySelector('#main-stage').title = director.default_shot ? `Put ${director.default_shot} on air. Controller: View` : 'No stage shot is set: choose a default shot on the Director page';
  // The list of cameras to show.
  if (!document.querySelector('#chooser').open || !choices.childElementCount) {
    choices.replaceChildren(...state.cameras.filter(c => c.in_use !== false).map(camera => {
      const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = shown.some(c => c.id === camera.id);
      box.onchange = () => choose([...choices.querySelectorAll('input')].map((b, i) => b.checked ? state.cameras.filter(c => c.in_use !== false)[i].id : null).filter(Boolean));
      label.append(box, node('span', ` ${camera.name}${camera.gimbal?.address ? ' (gimbal)' : isNetwork(camera) ? ' (network)' : ''}`)); return label;
    }));
  }
  // A tile for each camera shown; its picture is the live feed, set once so the stream is not restarted.
  for (const [id, tile] of tiles) if (!shown.some(c => c.id === id)) { tile.querySelector('img').src = ''; clearTimeout(stalls.get(id)); tile.remove(); tiles.delete(id); }
  for (const camera of shown) {
    let tile = tiles.get(camera.id);
    if (!tile) {
      tile = node('article', undefined, 'feed'); tile.dataset.id = camera.id;
      const picture = node('div', undefined, 'picture'), img = document.createElement('img'), said = node('div', 'Waiting for its picture…', 'said');
      img.alt = `${camera.name}, live`; img.hidden = true;       // shown only once a frame has loaded: no broken-image icon
      img.onload = () => { img.hidden = false; said.hidden = true; };
      if (window.concertDemo?.feed) {
        img.onerror = () => { img.hidden = true; said.hidden = false; said.textContent = 'No live picture (is the camera streaming, and the relay on?). Trying again…'; setTimeout(() => { img.src = feed(camera.id, true); }, 3000); };
        img.src = feed(camera.id);
      }
      picture.append(img, said);
      tile.append(node('h2'), picture, onscreenPad(camera.id), node('p', '', 'line'), node('div', undefined, 'buttons'), node('div', undefined, 'positions'), node('div', undefined, 'shows'), node('div', undefined, 'follow'));
      tile.onclick = event => { if (event.target.closest('button')) return; const index = [...drives.keys()][0]; if (index !== undefined) { drives.set(index, camera.id); draw(); } };
      feeds.append(tile); tiles.set(camera.id, tile);
    }
    const onAir = director.on_air === camera.id || (director.pair || []).includes(camera.id);
    const drivers = [...drives].filter(([, id]) => id === camera.id).map(([index]) => index);
    tile.classList.toggle('on-air', onAir); tile.classList.toggle('driven', drivers.length > 0);
    if (drivers.length) tile.style.setProperty('--driver', COLOURS[drivers[0] % COLOURS.length]);
    const heading = tile.querySelector('h2'); heading.replaceChildren(node('span', camera.name));
    if (onAir) heading.append(node('span', 'ON AIR', 'badge air'));
    for (const index of drivers) { const badge = node('span', `Controller ${index + 1}`, 'badge'); badge.style.background = COLOURS[index % COLOURS.length]; badge.style.color = '#101820'; heading.append(badge); }
    const t = camera.telemetry || {}, gimbal = camera.gimbal;
    if (camera.online && t.recording) heading.append(node('span', 'REC', 'badge rec'));
    const heat = temperature(camera); if (heat) heading.append(heat);
    const zoom = t.zoom_percent ? ` · zoom ${(t.zoom_percent / 100).toFixed(1)}×` : '';
    const line = tile.querySelector('.line');
    const network = isNetwork(camera), steered = steerable(camera);
    const about = network ? `Network camera · ${!camera.online ? 'OBS has no source for it yet (Refresh OBS scenes)' : !t.streaming ? 'no picture from it in OBS' : steered ? 'aim and zoom it from here' : 'cut only: give its control address on its card to aim and zoom it'}${camera.delay_ms ? ` · picture held ${camera.delay_ms} ms in OBS` : ''}`
      : !camera.online ? 'Offline' : gimbal?.summary || (gimbal ? 'Gimbal not connected' : 'No gimbal: zoom and cut only');
    line.textContent = `${about}${camera.lens_now ? '' : zoom}${director.gimbal_out?.[camera.id] ? ` · kept off air: ${director.gimbal_out[camera.id]}` : ''}`;
    if (camera.lens_now) line.append(' ', window.lensChip(camera.lens_now));
    const buttons = tile.querySelector('.buttons'); buttons.replaceChildren();
    if (!tech()) {
      const take = node('button', onAir ? 'On air' : 'Put on air'); take.disabled = onAir || !camera.online; take.onclick = () => act('/api/director', { take: camera.id }).then(refresh);
      buttons.append(take);
    }
    // Back to no zoom (1x), kept on the phone, for a camera left zoomed in.
    if (camera.online && (t.zoom_percent || 100) !== 100) {
      const reset = node('button', 'Reset zoom'); reset.title = `Back to 1x (now ${((t.zoom_live_percent || t.zoom_percent) / 100).toFixed(1)}x), and kept on the phone`;
      reset.onclick = () => resetZoom(camera, t);
      buttons.append(reset);
    }
    const pad = tile.querySelector('.onscreen');
    pad.hidden = !onscreen;
    for (const b of pad.querySelectorAll('[data-pan], [data-tilt]')) b.disabled = network ? !steered : !camera.online || !gimbal?.connected;
    for (const b of pad.querySelectorAll('[data-zoom]')) b.disabled = network ? !steered : !camera.online;
    if (!tech()) buttons.append(...autoButtons(camera, state.auto));
    // Arming, streaming and recording, as on its card: only what fits the camera's state; stopping asks first.
    if (camera.online && !tech() && !network) buttons.append(...capture(camera, t));      // a network camera is armed and started on itself
    if (steered) {
      const stop = node('button', 'Stop camera'); stop.title = 'Stop it turning and zooming. Controller: press B'; stop.onclick = () => stopCamera(camera.id);
      // Its home: where Set home kept it (one of the camera's own presets, with its zoom), else the camera's own.
      const homeSet = !!camera.netfollow?.home?.set;
      const home = node('button', 'Go home'); home.title = `${homeSet ? 'Turn it back to its home position, and its zoom there' : 'No home set here yet, so this is the camera’s own home (straight ahead): aim it, then Set home'}. Controller: press the right stick`;
      home.onclick = () => goHome(camera.id);
      const sethome = node('button', homeSet ? 'Set home again' : 'Set home'); sethome.title = 'Keep where it points now, and its zoom, as its home position (saved on the camera as one of its presets)';
      sethome.onclick = () => act(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-home`, { action: 'set' }).then(done => { if (done) result.textContent = done.did || `${camera.name}: home set`; refresh(); });
      buttons.append(stop, home, sethome);
    }
    if (gimbal?.connected) {
      const stop = node('button', 'Stop gimbal'); stop.title = 'Stop the gimbal moving (the stream carries on). Controller: press B'; stop.onclick = () => send(camera.id, 'gimbal.stop');
      buttons.append(stop);
      // Its home position (gimbal.point to angles kept here): set where it points now, and go back there.
      if (gimbal.home) {
        const home = node('button', 'Go home'); home.disabled = !gimbal.home.set || gimbal.home.stale;
        home.title = !gimbal.home.set ? 'No home position yet: aim it, then Set home' : gimbal.home.stale ? 'The phone restarted since Set home: aim it where its home was and Set home again, which brings its saved positions back too' : 'Turn it back to its home position (stops following). Controller: press the right stick';
        home.onclick = () => goHome(camera.id);
        const sethome = node('button', gimbal.home.set ? 'Set home again' : 'Set home'); sethome.title = 'Keep where it points now as its home position';
        sethome.onclick = () => act(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-home`, { action: 'set' }).then(done => { if (done) result.textContent = `${camera.name}: home set${done.restored ? `; ${done.restored}` : ''}`; refresh(); });
        buttons.append(home, sethome);
        // After a phone restart: home and the positions found again from what it sees (matchhome.py), nobody aiming it.
        if (gimbal.home.findable) {
          const find = node('button', 'Find home'); find.title = 'The phone restarted: find its home and positions again from what it sees. It stops, zooms out, turns to check and ends at home';
          find.onclick = async () => {
            if (onAir && !await window.concert.sure(`${camera.name} is on air: Find home turns it and zooms out, and the audience sees it. Go ahead?`, { ok: 'Find home', danger: true })) return;
            result.textContent = `${camera.name}: finding home…`;
            act(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-home`, { action: 'find', on_air: onAir }).then(done => { if (done) result.textContent = done.did; refresh(); });
          };
          buttons.append(find);
        }
      }
    }
    drawPositions(tile.querySelector('.positions'), camera, onAir);
    // What it shows: the camera card's own control (shows.js), the same setting; for every camera, gimbal or not.
    const shows = tile.querySelector('.shows');
    if (director.camera_focus !== undefined && !tech()) window.whatItShows.into(shows, camera, director, { ...showsContext, studio: state.creator });
    else { shows.replaceChildren(); delete shows.dataset.signature; }
    // Whom its gimbal follows and its follow plan: the camera card's own control (follow.js), the same setting.
    const follow = tile.querySelector('.follow');
    if (gimbal?.connected && t.capabilities?.gimbal_follow && !tech()) window.gimbalFollow.into(follow, camera, followContext(camera));
    else { follow.replaceChildren(); delete follow.dataset.signature; }
  }
  drawPads(shown);
  pictures();
}

// Positions: a gimbal camera's saved targets (gimbaltargets.py, the same as on its card and Remote's keys), set up here
// with the live picture: aim and zoom it, Save as…; Go turns it there to check, Update to here keeps where it points now
// in place of what one had. The first four are on a controller too: hold Menu (≡) and press A, B, X or Y to go there,
// Menu and the left stick to save a new one. Drawn again only when something in it changes, so a name being typed holds.
function drawPositions(box, camera, onAir) {
  const gimbal = camera.gimbal, targets = targetsOf(camera), preset = isNetwork(camera);
  if (!targets || (preset && !steerable(camera) && !targets.list.length)) { box.replaceChildren(); delete box.dataset.signature; return; }
  const off = preset ? !steerable(camera) : !camera.online || !gimbal.connected;
  const signature = JSON.stringify([targets.list, targets.mode, off, onAir, gimbal?.stage?.calibrated, editing.get(camera.id)]);
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  const post = async (body, did) => {
    const answer = await act(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-targets`, body);
    if (answer) { result.textContent = answer.did || did || ''; editing.delete(camera.id); }
    refresh();
    return answer;
  };
  const heading = node('h3', `Positions · ${targets.mode_name} `);
  heading.append(node('span', `${targets.list.length} of ${targets.most}`, 'count'));
  const list = node('ol');
  targets.list.forEach((target, index) => {
    const item = node('li'); if (target.stale) item.className = 'stale';
    if (editing.get(camera.id) === target.id) {
      const name = document.createElement('input'); name.type = 'text'; name.maxLength = 40; name.value = target.name; name.setAttribute('aria-label', `New name for ${target.name}`);
      const keep = node('button', 'Keep'); keep.onclick = () => post({ action: 'change', id: target.id, name: name.value }, `${camera.name}: renamed ${name.value.trim()}`);
      const cancel = node('button', 'Cancel'); cancel.onclick = () => { editing.delete(camera.id); delete box.dataset.signature; drawPositions(box, camera, onAir); };
      name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); keep.click(); } if (event.key === 'Escape') cancel.click(); });
      item.append(name, keep, cancel);
      list.append(item); setTimeout(() => { name.focus(); name.select(); }, 0);
      return;
    }
    const label = node('span', target.name, 'name');
    const where = node('span', `${preset ? `the camera's preset ${target.preset}` : `pan ${target.pan}°, tilt ${target.tilt}°${target.zoom_percent ? `, ${(target.zoom_percent / 100).toFixed(1)}×` : ''}`}${index < 4 ? ` · Menu + ${'ABXY'[index]}` : ''}`, 'where');
    const go = node('button', 'Go'); go.disabled = off || target.stale;
    go.title = target.stale ? 'The phone restarted since this was saved: aim it where its home was and Set home again to bring every position back, or aim it here and Update to here' : `Turn it to ${target.name} and zoom there, to check${onAir ? ' (it is on air: the audience sees it move)' : ''}`;
    go.onclick = async () => { if (onAir && !await window.concert.sure(`${camera.name} is on air. Turn it to ${target.name} anyway? The audience sees it move.`, { ok: 'Turn it' })) return; post({ action: 'go', id: target.id }); };
    const update = node('button', 'Update to here'); update.disabled = off;
    update.title = `Keep where it points now and its zoom as ${target.name}, in place of what it had`;
    update.onclick = () => post({ action: 'update', id: target.id });
    const rename = node('button', 'Rename'); rename.onclick = () => { editing.set(camera.id, target.id); delete box.dataset.signature; drawPositions(box, camera, onAir); };
    const drop = node('button', 'Delete'); drop.className = 'danger';
    drop.onclick = async () => { if (await window.concert.sure(`Delete the position “${target.name}” from ${camera.name}? Remote keys and voice calls that use it stop working.`, { ok: 'Delete', danger: true })) post({ action: 'delete', id: target.id }, `${camera.name}: ${target.name} deleted`); };
    const acts = node('div', undefined, 'acts'); acts.append(go, update, rename, drop);
    item.append(label, where, acts);
    if (target.stale) item.append(node('small', 'The phone restarted since this was saved, so the angle no longer lines up: aim it where its home was and Set home again to bring every position back, or aim it here and Update to here.'));
    list.append(item);
  });
  const parts = [heading];
  if (targets.list.length) parts.push(list);
  if (targets.list.length < targets.most) {
    const save = node('button', 'Save as…'); save.disabled = off;
    save.title = 'Aim and zoom it first: where it points now and its zoom are kept under a name you give';
    save.onclick = () => savePosition(camera);
    parts.push(save);
  }
  const anyStale = targets.list.some(t => t.stale);
  parts.push(node('small', !targets.list.length
    ? `Aim and zoom it at something it should show on cue (the lead vocal, the piano), then Save as…. Kept for ${targets.mode_name}; used by Remote's keys${targets.voice ? ' and voice calls' : ''}.`
    : preset ? 'Kept on the camera as its own presets, so they hold whatever restarts. Go holds the shot, with its tracker off.'
    : gimbal.stage?.calibrated ? 'Aimed from the stage (Stage layout): these hold across a restart of the phone.'
    : `${anyStale ? 'Some no longer line up. ' : ''}A restart of the phone moves these off: calibrate its aim from the stage (Stage layout) and they hold.`));
  box.replaceChildren(...parts);
}
const editing = new Map();                                              // camera id -> the position being renamed
async function savePosition(camera, quick = false) {
  const targets = targetsOf(camera); if (!targets) return;
  const taken = new Set(targets.list.map(t => t.name.toLowerCase()));
  let number = targets.list.length + 1; while (taken.has(`position ${number}`)) number++;
  let name = `Position ${number}`;
  if (!quick) {
    const asked = await window.concert.ask({ title: `Save ${camera.name}'s position`, text: 'Where it points now and its zoom, kept under this name: what it shows, as you would say it.',
                                             fields: [{ name: 'name', label: 'Name', value: name }], ok: 'Save' });
    if (!asked) return;
    name = asked.name;
  }
  const answer = await act(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-targets`, { action: 'save', name });
  if (answer) result.textContent = answer.did || `${camera.name}: ${name} saved`;
  refresh();
}
function goPosition(cameraId, index) {
  const camera = state?.cameras.find(c => c.id === cameraId), target = targetsOf(camera)?.list[index];
  if (!target) { result.textContent = `${camera?.name || 'This camera'} has no position ${index + 1}`; return; }
  if (target.stale) { result.textContent = `${camera.name}: ${target.name} no longer lines up (the phone restarted): aim it where its home was and Set home again, or aim it here and Update to here`; return; }
  act(`/api/cameras/${encodeURIComponent(cameraId)}/gimbal-targets`, { action: 'go', id: target.id }).then(answer => { if (answer?.did) result.textContent = answer.did; refresh(); });
}

// The capture controls of a tile: Arm when not armed; once armed, the stream and the recording each started or
// stopped, and Disarm when it is doing neither. Stopping asks first, with the card's words; starting syncs the phone's
// clock first when it is off, as the card does.
const WARN = { 'stream.stop': 'This can interrupt capture.', 'recording.stop': 'This can interrupt capture.',
  'camera.disarm': 'Disarm stops the capture service. Remote Arm only works on a phone set up as device owner; otherwise someone must tap Arm on the phone.' };
function capture(camera, t) {
  const streaming = !!(t.streaming || t.capture?.streamRequested), made = [];
  const button = (label, command, danger) => {
    const b = node('button', label); if (danger) b.className = 'danger';
    b.onclick = async () => {
      if (WARN[command] && !await window.concert.sure(`${label} on ${camera.name}?\n${WARN[command]}`, { ok: label, danger: true })) return;
      b.disabled = true;
      const clockOff = ['stream.start', 'recording.start'].includes(command) && t.capabilities?.time_sync && typeof camera.clock_offset_ms === 'number' && Math.abs(camera.clock_offset_ms) > 20;
      if (clockOff) await send(camera.id, 'time.sync');
      await send(camera.id, command, command === 'camera.arm' && t.capabilities?.stream_only_arm ? { local_recording: false } : {});
      refresh();
    };
    return b;
  };
  if (!t.armed) return [button('Arm', 'camera.arm')];
  made.push(streaming ? button('Stop stream', 'stream.stop', true) : button('Start stream', 'stream.start'));
  made.push(t.recording ? button('Stop recording', 'recording.stop', true) : button('Record', 'recording.start'));
  if (!streaming && !t.recording) made.push(button('Disarm', 'camera.disarm', true));
  return made;
}

// The phone's temperature, small, coloured by how hot (thermal.py's levels), and the rest when pointed at.
function temperature(camera) {
  const h = camera.thermal; if (!camera.online || !h || h.temperature_c == null) return null;
  const chip = node('span', `${Math.round(h.temperature_c)}°`, `badge heat ${h.level}`);
  const trend = typeof h.trend_c_per_minute === 'number' && Math.abs(h.trend_c_per_minute) >= 0.05 ? `, ${h.trend_c_per_minute > 0 ? 'rising' : 'falling'} ${Math.abs(h.trend_c_per_minute).toFixed(1)} °C a minute` : ', steady';
  const left = typeof h.minutes_to_stop === 'number' ? `; at this rate it reaches its ${h.stop_c} °C stop in about ${Math.round(h.minutes_to_stop)} minutes` : '';
  const word = { ok: '', warm: ' Warm: give it air or a lighter load.', hot: ' Hot: at its stop temperature, the phone protects itself.', critical: ' Critical: cool it now.' }[h.level] || '';
  chip.title = `Phone at ${h.temperature_c.toFixed(1)} °C${trend}${left}.${word}`;
  chip.setAttribute('aria-label', chip.title);
  if (h.level !== 'ok') chip.textContent += ` ${h.level}`;
  return chip;
}

// Reset zoom: a phone that zooms by itself glides back to 1x; every phone is then given 1x as its zoom, which it keeps
// (the Pixel 8 had kept a zoom it was left at, 2026-10-24).
async function resetZoom(camera, t) {
  if (t.capabilities?.zoom_ramp && (t.streaming || t.recording)) await send(camera.id, 'camera.zoom', { to_percent: 100, seconds: 0.6 });
  await send(camera.id, 'camera.lens', { zoom_percent: 100 });
  refresh();
}

// On-screen controls (a choice kept in this browser): under each picture, arrows that aim its gimbal while held and
// buttons that zoom while held, sent as a controller's readings are (/api/operate/control), for a person without one.
let onscreen = false;
try { onscreen = localStorage.getItem('operate.onscreen') === '1'; } catch (error) { /* off */ }
document.querySelector('#onscreen').checked = onscreen;
document.querySelector('#onscreen').onchange = event => { onscreen = event.target.checked; try { localStorage.setItem('operate.onscreen', onscreen ? '1' : '0'); } catch (error) { /* this visit */ } draw(); };
const HELD_PAN = 45, HELD_ZOOM = 0.6;
function onscreenPad(id) {
  // Made once with the tile and never redrawn, so a press held across a refresh is let go of properly.
  const pad = node('div', undefined, 'onscreen'); pad.hidden = true;
  let timer = null, reading = null;
  // The arrows go as fast as Aim says (HELD_PAN at the default), the zoom buttons as Zoom does.
  const sendReading = () => {
    const scale = aimLevel / DEFAULT_AIM, held = v => Math.max(-100, Math.min(100, Math.round(v * scale)));
    // The ■ on a network camera's tile is a stop said outright (do: stop), whatever set it moving.
    const { stop, ...values } = reading, outright = stop && isNetwork(state?.cameras.find(c => c.id === id)) ? { do: 'stop' } : {};
    api('/api/operate/control', { camera_id: id, ...values, ...outright, pan: held(values.pan || 0), tilt: held(values.tilt || 0), zoom_speed: zoomTimes() })
      .then(answer => controlAnswer(id, answer)).catch(error => { if (!/rate limit/i.test(error.message)) concert.fail(error); });
  };
  const release = () => { if (!timer) return; clearInterval(timer); timer = null; reading = { pan: 0, tilt: 0, zoom: 0 }; sendReading(); };
  const hold = (label, title, values, kind) => {
    const b = node('button', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.dataset[kind] = '1';
    b.onpointerdown = event => { event.preventDefault(); b.setPointerCapture?.(event.pointerId); reading = { pan: 0, tilt: 0, zoom: 0, ...values }; sendReading(); clearInterval(timer); timer = setInterval(sendReading, 120); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = release;
    b.oncontextmenu = event => event.preventDefault();
    return b;
  };
  const aim = node('div', undefined, 'aim');
  aim.append(node('span'), hold('▲', 'Tilt up (hold)', { tilt: HELD_PAN }, 'tilt'), node('span'),
    hold('◀', 'Pan left (hold)', { pan: -HELD_PAN }, 'pan'), hold('■', 'Stop it turning', { pan: 0, tilt: 0, stop: true }, 'pan'), hold('▶', 'Pan right (hold)', { pan: HELD_PAN }, 'pan'),
    node('span'), hold('▼', 'Tilt down (hold)', { tilt: -HELD_PAN }, 'tilt'), node('span'));
  const zoom = node('div', undefined, 'zoom');
  zoom.append(hold('−', 'Zoom out (hold)', { zoom: -HELD_ZOOM }, 'zoom'), node('span', 'Zoom'), hold('+', 'Zoom in (hold)', { zoom: HELD_ZOOM }, 'zoom'));
  pad.append(aim, zoom);
  window.addEventListener('blur', release);
  return pad;
}

// The programme: recorded to a file, and OBS's own stream, as on the Show page. Stopping either asks first.
document.querySelector('#record').onclick = async () => {
  const recording = state?.director?.recording;
  if (recording && !await window.concert.sure('Stop recording the programme? The file is finished and checked.', { ok: 'Stop recording', danger: true })) return;
  await act('/api/director', { record: !recording }); refresh();
};
document.querySelector('#stream').onclick = async () => {
  const live = state?.director?.streaming;
  if (!await window.concert.sure(live ? 'Stop OBS streaming? Viewers lose the programme.' : 'Start OBS streaming to the service set up in OBS? The programme goes out to its audience.', { ok: live ? 'Stop OBS stream' : 'Start OBS stream', danger: !!live })) return;
  await act('/api/director', { stream: !live }); refresh();
};
// Tracking and the automatic crop zoom (autoswitch.py), as on the camera cards and the Show page: for every camera on
// the bar, and each camera's own on its tile. Off, a gimbal stops where it points and the crop in OBS holds where it
// is; Whole picture puts a crop gone wrong back to the whole picture and keeps it there.
const autoSend = (body, id) => act('/api/auto', { ...body, ...(id ? { camera_id: id } : {}) }).then(answer => { if (answer?.did) result.textContent = answer.did; refresh(); });
for (const [selector, kind] of [['#auto-tracking', 'tracking'], ['#auto-zoom', 'zoom']]) document.querySelector(selector).onclick = () => autoSend({ kind, on: !state?.auto?.[kind]?.all });
document.querySelector('#auto-whole').onclick = () => autoSend({ kind: 'zoom', whole: true });
function drawAuto(auto) {
  for (const [selector, kind, word] of [['#auto-tracking', 'tracking', 'Tracking'], ['#auto-zoom', 'zoom', 'Auto zoom']]) {
    const button = document.querySelector(selector), all = auto?.[kind]; button.hidden = !all;
    if (all) { button.setAttribute('aria-pressed', String(all.all)); button.textContent = `${word}: ${all.all ? 'on' : 'off'}${all.all && all.off.length ? ` (${all.off.length} off)` : ''}`; button.classList.toggle('held', !all.all); }
  }
  document.querySelector('#auto-whole').hidden = !auto;
}
function autoButtons(camera, auto) {
  if (!auto) return [];
  const made = [];
  for (const [kind, word, about] of [['tracking', 'Tracking', isNetwork(camera) ? 'its own tracker, aimed from the stage' : 'its gimbal following someone, aimed from the stage'], ['zoom', 'Auto zoom', 'the director’s crop of its picture in OBS']]) {
    if (kind === 'tracking' && steerable(camera)) {
      // A network PTZ camera's own tracker, on or off, whether or not the manager follows with it: shown as last set
      // from here (the camera does not say), and told to the camera on every press.
      const on = camera.netfollow?.tracking === true, b = node('button', `Tracking: ${on ? 'on' : camera.netfollow?.tracking == null ? 'not set' : 'off'}`);
      b.setAttribute('aria-pressed', String(on)); b.classList.toggle('held', !on);
      b.title = `${camera.name}'s own tracker${camera.netfollow?.tracking == null ? ' (not set from here yet: it is as the camera was left)' : ''}. On, it frames its own subject${camera.netfollow?.armed ? ', aimed from the stage' : ' where it points'}; off, it stays where you aim it. Controller: X`;
      b.onclick = () => autoSend({ kind, on: !on }, camera.id);
      made.push(b); continue;
    }
    if (kind === 'tracking' && !(auto.tracking.gimbals || []).includes(camera.id)) continue;
    const mine = auto[kind].cameras[camera.id]; if (!mine) continue;
    const b = node('button', `${word}: ${mine.on ? 'on' : 'off'}${mine.own && !mine.on ? ' (every camera off)' : ''}`);
    b.setAttribute('aria-pressed', String(mine.own)); b.classList.toggle('held', !mine.on);
    b.title = `${word}, ${about}, for ${camera.name}. Off, it holds where it is; on again, it takes up from there.`;
    b.onclick = () => autoSend({ kind, on: !mine.own }, camera.id);
    made.push(b);
  }
  const whole = node('button', 'Whole picture'); whole.title = `${camera.name}'s whole picture now, and its automatic crop zoom off, for a zoom gone wrong`;
  whole.onclick = () => autoSend({ kind: 'zoom', whole: true }, camera.id);
  made.push(whole);
  return made;
}

function drawProgramme(director) {
  const record = document.querySelector('#record'), stream = document.querySelector('#stream');
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  record.textContent = director.recording ? `Stop recording ${clock(director.recording.seconds || 0)}` : 'Record programme';
  record.classList.toggle('danger', !!director.recording);
  stream.textContent = director.streaming ? `Stop OBS stream ${clock(director.streaming.seconds || 0)}${director.streaming.reconnecting ? ' · reconnecting' : ''}` : 'Start OBS stream';
  stream.classList.toggle('danger', !!director.streaming);
}

// Arm all cameras and Start all camera streams, on every camera in use here and not only those shown: the dashboard's
// own (fleet.js), with the same rules for which cameras each touches. Each lists those it will touch and those it leaves
// out, and why, and does nothing until accepted. A stream's start sets the clocks that are off first, as on its tile.
const { FLEET } = window.concertFleet;
let everyBusy = '';
function drawEvery(cameras) {
  for (const button of document.querySelectorAll('#arm-all, #stream-all')) {
    const action = FLEET.find(a => a.command === button.dataset.command), targets = cameras.filter(action.targets);
    const label = everyBusy === action.command ? `${button.id === 'arm-all' ? 'Arming' : 'Starting'}…` : `${button.id === 'arm-all' ? 'Arm all cameras' : 'Start all camera streams'}${targets.length ? ` (${targets.length})` : ''}`;
    if (button.textContent !== label) button.textContent = label;
    button.disabled = !targets.length || !!everyBusy;
    button.title = targets.length ? `${button.id === 'arm-all' ? 'Arm' : 'Start the stream to OBS on'} ${targets.map(c => c.name).join(', ')}` : 'No camera needs this right now';
    button.onclick = () => every(action);
  }
}
const clockOff = c => c.online && c.telemetry?.capabilities?.time_sync && typeof c.clock_offset_ms === 'number' && Math.abs(c.clock_offset_ms) > 20;
async function every(action) {
  const name = action.command === 'camera.arm' ? 'Arm all cameras' : 'Start all camera streams';
  everyBusy = action.command; draw();      // while the clocks are set, nothing else pressed
  try {
    let cameras = state.cameras.filter(c => c.in_use !== false);
    // Before the question: the clocks that are off set, then the cameras read again so that each one's readiness is fresh.
    if (action.preflight && cameras.filter(action.targets).some(clockOff)) {
      result.textContent = 'Setting the clocks first…';
      const off = cameras.filter(action.targets).filter(clockOff);
      await Promise.all(off.map((c, i) => new Promise(resolve => setTimeout(resolve, i * 350)).then(() => send(c.id, 'time.sync'))));
      await new Promise(resolve => setTimeout(resolve, 7000));            // a few fresh readings to measure them again
      const now = await act('/api/cameras'); if (now) cameras = now.cameras.filter(c => c.in_use !== false);
    }
    const targets = cameras.filter(action.targets);
    const left = cameras.filter(c => !action.targets(c)).map(c => [c, action.skipped(c)]).filter(([, why]) => why);
    if (!targets.length) { result.textContent = `${name}: no camera needs it now.`; return; }
    const ready = c => !action.preflight || !c.readiness ? '' : c.readiness.overall === 'ok' ? ' — ready'
      : `\n      ${c.readiness.overall === 'fail' ? 'NOT READY' : 'check'}: ${(c.readiness.checks || []).filter(k => k.status !== 'ok').map(k => `${k.label}: ${k.detail}`).join('; ')}`;
    let question = `${action.lead(targets.length)}\n\n${targets.map(c => `  • ${c.name}${action.detail?.(c) ? ` (${action.detail(c)})` : ''}${ready(c)}`).join('\n')}\n\n${action.tail}`;
    if (left.length) question += `\n\nNOT included:\n${left.map(([c, why]) => `  • ${c.name} (${why})`).join('\n')}`;
    result.textContent = ''; everyBusy = ''; draw();          // "Arming…" only once accepted, not while it is asked
    if (!await window.concert.sure(question, { ok: name })) return;
    everyBusy = action.command; draw();
    const done = [], failed = [];
    // A third of a second apart (the manager limits how fast commands arrive), then awaited together.
    await Promise.all(targets.map(async (camera, index) => {
      await new Promise(resolve => setTimeout(resolve, index * 350));
      try {
        const outcome = await api(`/api/cameras/${encodeURIComponent(camera.id)}/commands`, { request_id: crypto.randomUUID(), command: action.command, parameters: action.parameters ? action.parameters(camera) : {} });
        if (outcome.state !== 'SUCCEEDED') throw new Error(`${outcome.state}${outcome.result?.error ? ` — ${outcome.result.error}` : ''}`);
        done.push(camera.name);
      } catch (error) { failed.push(`${camera.name}: ${error.message}`); }
    }));
    result.textContent = `${new Date().toLocaleTimeString()} ${name}: ${action.did} ${done.length ? done.join(', ') : 'no cameras'}.${failed.length ? ` FAILED: ${failed.join('; ')}.` : ''}${left.length ? ` Not included: ${left.map(([c, why]) => `${c.name} (${why})`).join('; ')}.` : ''}`;
  } finally { everyBusy = ''; refresh(); }
}

function goHome(id) { const c = state?.cameras.find(x => x.id === id); return isNetwork(c) ? control(id, { do: 'home' }).then(answer => { if (answer && !answer.said) result.textContent = `${c.name}: turning to its home position`; }) : act(`/api/cameras/${encodeURIComponent(id)}/gimbal-home`, { action: 'go' }).then(refresh); }

document.querySelector('#main-stage').onclick = () => act('/api/operate/main', {}).then(refresh);
document.querySelector('#previous').onclick = () => act('/api/operate/previous', {}).then(refresh);

// ---- Xbox controllers --------------------------------------------------------------------------------------------
function drawPads(shown) {
  const box = document.querySelector('#pads');
  const connected = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  if (!connected.length) { box.replaceChildren(node('p', 'No controller seen yet. Connect an Xbox controller (Bluetooth or USB) and press any button on it.')); return; }
  box.replaceChildren(...connected.map(pad => {
    const row = node('p'), pick = document.createElement('select');
    for (const camera of shown) { const option = node('option', camera.name); option.value = camera.id; option.selected = drives.get(pad.index) === camera.id; pick.append(option); }
    pick.onchange = () => { drives.set(pad.index, pick.value); draw(); };
    const swatch = node('span', '■ '); swatch.style.color = COLOURS[pad.index % COLOURS.length];
    row.append(swatch, node('span', `Controller ${pad.index + 1} drives `), pick, node('span', ` · aim ${aimLevel} of 10 (d-pad up / down), zoom ${zoomLevel} of 10`));
    return row;
  }));
}
// Gentle near the middle for small corrections, the most Aim allows at the edge. Less steep than it was (a third straight,
// two thirds cubic): half a push asked for under 2% of the gimbal's speed at the old default, and moved it hardly at all.
const curve = v => { const a = Math.abs(v); if (a < DEAD) return 0; const x = (a - DEAD) / (1 - DEAD); return Math.sign(v) * (0.35 * x + 0.65 * x * x * x); };
// A trigger: squared, so a light squeeze creeps and a full one moves.
const squeeze = v => { const a = Math.abs(v); if (a < ZOOM_DEAD) return 0; const x = (a - ZOOM_DEAD) / (1 - ZOOM_DEAD); return Math.sign(v) * x * x; };
function setAim(level) { aimLevel = Math.max(1, Math.min(10, level)); keep('operate-aim', aimLevel); aimInput.value = String(aimLevel); aimSaid.textContent = String(aimLevel); draw(); }
function setZoom(level) { zoomLevel = Math.max(1, Math.min(10, level)); keep('operate-zoom', zoomLevel); zoomInput.value = String(zoomLevel); zoomSaid.textContent = String(zoomLevel); draw(); }
const aimInput = document.querySelector('#aim-level'), zoomInput = document.querySelector('#zoom-level');
const aimSaid = document.querySelector('#aim-said'), zoomSaid = document.querySelector('#zoom-said');
aimInput.value = aimSaid.textContent = String(aimLevel); zoomInput.value = zoomSaid.textContent = String(zoomLevel);
aimInput.oninput = () => setAim(Number(aimInput.value)); zoomInput.oninput = () => setZoom(Number(zoomInput.value));
function step(index, delta) {
  const shown = chosen(); if (!shown.length) return;
  const at = Math.max(0, shown.findIndex(c => c.id === drives.get(index)));
  drives.set(index, shown[(at + delta + shown.length) % shown.length].id); draw();
}
function poll(time) {
  if (!state || !navigator.getGamepads) return;
  const shown = chosen();
  for (const pad of navigator.getGamepads()) {
    if (!pad || pad.mapping !== 'standard') continue;
    if (!drives.has(pad.index) || !shown.some(c => c.id === drives.get(pad.index))) {
      // A new controller drives a shown camera no other controller has, or else the first.
      const free = shown.find(c => ![...drives.values()].includes(c.id)) || shown[0];
      if (!free) continue;
      drives.set(pad.index, free.id); draw();
    }
    const camera = drives.get(pad.index), last = pads.get(pad.index) || { buttons: [], sent: 0, active: false };
    const pressed = i => pad.buttons[i]?.pressed && !last.buttons[i];
    // Menu (≡) held: A, B, X and Y go to positions 1 to 4, the left stick saves a new one (named Position N).
    if (pad.buttons[9]?.pressed) {
      for (const [button, index] of [[0, 0], [1, 1], [2, 2], [3, 3]]) if (pressed(button)) goPosition(camera, index);
      if (pressed(10)) { const c = state.cameras.find(x => x.id === camera); if (targetsOf(c)) savePosition(c, true); }
    } else {
      if (pressed(0) && !tech()) act('/api/director', { take: camera }).then(refresh);
      if (pressed(1)) stopCamera(camera);
      if (pressed(2) && !tech()) { const c = state.cameras.find(x => x.id === camera);
        // A network camera's own tracker: its tile's Tracking, on or off.
        if (steerable(c) && state.auto) autoSend({ kind: 'tracking', on: c.netfollow?.tracking !== true }, camera);
        if (c?.gimbal?.connected) send(camera, 'gimbal.follow', c.gimbal.follow ? { on: false } : { on: true, who: 'face' }).then(refresh); }
      if (pressed(3) && !tech()) act('/api/operate/previous', {}).then(refresh);
    }
    if (pressed(8) && !tech()) act('/api/operate/main', {}).then(refresh);
    if (pressed(11)) goHome(camera);
    if (pressed(4) || pressed(14)) step(pad.index, -1);
    if (pressed(5) || pressed(15)) step(pad.index, 1);
    if (pressed(12)) setAim(aimLevel + 1);
    if (pressed(13)) setAim(aimLevel - 1);
    const most = aimMost();
    // Aimed with the right stick (axes 2 and 3 in the standard mapping), as a camera operator's right hand does.
    const pan = Math.round(curve(pad.axes[2] || 0) * most), tilt = Math.round(-curve(pad.axes[3] || 0) * most);
    const zoomed = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0), zoom = Math.round(squeeze(zoomed) * 100) / 100;
    const active = pan !== 0 || tilt !== 0 || zoom !== 0;
    // At once when a stick or trigger is first pushed or moves clearly (no waiting for the next tenth of a second), ten
    // times a second while held, and once more when let go, so the gimbal is told to stop at once.
    const moved = !last.active || Math.abs(pan - (last.pan || 0)) >= 8 || Math.abs(tilt - (last.tilt || 0)) >= 8 || Math.abs(zoom - (last.zoom || 0)) >= 0.08;
    if ((active && (time - last.sent >= EVERY_MS || (moved && time - last.sent >= SOONEST_MS))) || (!active && last.active)) {
      last.sent = time; last.pan = pan; last.tilt = tilt; last.zoom = zoom;
      api('/api/operate/control', { camera_id: camera, pan, tilt, zoom, zoom_speed: zoomTimes() }).then(answer => controlAnswer(camera, answer)).catch(error => { if (!/rate limit/i.test(error.message)) concert.fail(error); });
    }
    pads.set(pad.index, { buttons: pad.buttons.map(b => b.pressed), sent: last.sent, active, pan: last.pan, tilt: last.tilt, zoom: last.zoom });
  }
}
window.addEventListener('gamepadconnected', () => draw());
window.addEventListener('gamepaddisconnected', event => { const camera = drives.get(event.gamepad.index); drives.delete(event.gamepad.index); pads.delete(event.gamepad.index); if (camera) api('/api/operate/control', { camera_id: camera, pan: 0, tilt: 0, zoom: 0 }).catch(() => {}); draw(); });
