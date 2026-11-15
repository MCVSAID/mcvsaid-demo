'use strict';
// The room map: the room from above, the stage at the top and the house below, with each camera where it stands and a
// wedge for what it sees. On Stage layout (LAYOUT, see stage.js) it is always open, and there the cameras are moved:
// drag one to move it; drag the round handle in front of it to turn it, or type the angle. Laid out once at setup:
// Stage Shots' camera marks follow from it (see roommap.py), each with a wedge as wide as on the map. Uses stage.js's
// state and helpers: it is loaded after it, on the manager's dashboard only.
//
// Room view, on Stage Shots, puts the map and the buttons together: the shot buttons stand on the map's stage where
// the performers are, the wide shots in a row at the front of the stage and the audience out in the house, with each
// camera drawn where it stands. Pressing a button puts it on air as ever; nothing is moved there. stage.js's own rows
// are moved onto the map for it and back again after, so everything it does with them goes on working. Not offered on
// a screen too narrow for buttons a finger can press on a map that small.
//
// Expand opens the map over the whole window (Esc closes it). On Stage layout, with a camera chosen, the camera's own
// picture is shown beside it, with where the map says the stage's corners are drawn on it, to check the wedge against
// what it really sees; Mark the corners there has the manager work out where it stands and points from them
// (roomfit.py, /api/stage/room/fit), offered as a dashed wedge to take or leave. A camera with a height and a tilt on
// the map is drawn by what it sees of the floor (its picture's frame cut by the floor) rather than a flat wedge, with a
// side view of it against a performer.
(() => {
  const NS = 'http://www.w3.org/2000/svg', W = 1000;
  const panel = document.querySelector('#room'), together = document.querySelector('#roomview'), roomHint = document.querySelector('#roomhint');
  const NARROWEST = 720;              // pixels across, below which Room view is not offered
  const open = LAYOUT;                // the map by itself, its cameras there to be moved
  let chosen = null, built = null, held = null, combined = false;
  try { combined = localStorage.getItem('stage-room-view') === 'on'; } catch (error) { /* private window: not remembered */ }
  // stage.js's rows, moved onto the map in Room view, and where they go back to.
  const rows = ['#performers', '#wides', '#crowds'].map(selector => document.querySelector(selector)), home = document.querySelector('#front');
  const local = {}, drawn = new Map();
  function svg(tag, attributes = {}, parent) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attributes)) e.setAttribute(k, v); if (parent) parent.append(e); return e; }
  const room = () => state.room;
  const H = () => room().depth * W;
  const spot = id => local[id] || room().map[id];
  const colour = cameraColour;
  const fovOf = id => spot(id)?.fov ?? room().map[id]?.fov ?? room().views[id]?.fov ?? 70;
  const turn = degrees => ((Math.round(degrees) % 360) + 360) % 360;
  const ASPECT = 16 / 9, PERSON = 1.7;     // a camera's picture, unless its own says otherwise; a performer's height in metres
  const CORNERS = [['front_left', 'front left', 'the front corner on the left of the map (stage right)'], ['front_right', 'front right', 'the front corner on the right of the map (stage left)'],
    ['back_left', 'back left', 'the back corner on the left of the map'], ['back_right', 'back right', 'the back corner on the right of the map']];
  let expanded = false, fitting = null, shotAt = Date.now(), shot = null;
  // The administrator's: a camera's field of view. Read from the session where the page has it.
  const admin = () => (window.concert?.session ? window.concert.session.role === 'admin' : !!state.remote);
  const lifted = entry => typeof entry?.height === 'number' && typeof entry?.tilt === 'number';

  // -- the camera as a pinhole, in metres: x across the map, y down it, z into the floor (so up is -z), as roomfit.py --
  const metres = () => room().width_m || 12;
  const add = (a, b) => a.map((v, i) => v + b[i]), times = (a, k) => a.map(v => v * k), dot = (a, b) => a.reduce((t, v, i) => t + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => times(a, 1 / Math.max(1e-12, Math.hypot(...a)));
  function rotation(aim, tilt, roll = 0) {
    const a = aim * Math.PI / 180, t = Math.max(-89.95, Math.min(89.95, tilt)) * Math.PI / 180, r = roll * Math.PI / 180;
    const ahead = [Math.sin(a) * Math.cos(t), -Math.cos(a) * Math.cos(t), -Math.sin(t)];
    const levelRight = unit(cross(ahead, [0, 0, -1])), levelDown = cross(ahead, levelRight);
    const right = add(times(levelRight, Math.cos(r)), times(levelDown, Math.sin(r)));
    return [right, cross(ahead, right), ahead];
  }
  const focal = (fov, aspect) => aspect / (2 * Math.tan(fov * Math.PI / 360));
  function pinhole(entry, fov, aspect = ASPECT) {
    const m = metres();
    return { R: rotation(entry.aim, entry.tilt, entry.roll || 0), C: [entry.x * m, entry.y * room().depth * m, -entry.height], f: focal(fov, aspect), aspect };
  }
  // What a camera sees of the floor: its picture's edge, each point's ray to where it meets the floor, or out to
  // `far` along the floor when it never does (above the horizon). Map units (shares of the map's width).
  function footprint(entry, fov) {
    const cam = pinhole(entry, fov), far = 3 * metres(), half = [cam.aspect / 2, 0.5], edge = [];
    const steps = 12;
    for (let i = 0; i < steps; i++) edge.push([-half[0] + 2 * half[0] * i / steps, -half[1]]);
    for (let i = 0; i < steps; i++) edge.push([half[0], -half[1] + 2 * half[1] * i / steps]);
    for (let i = 0; i < steps; i++) edge.push([half[0] - 2 * half[0] * i / steps, half[1]]);
    for (let i = 0; i < steps; i++) edge.push([-half[0], half[1] - 2 * half[1] * i / steps]);
    return edge.map(([a, b]) => {
      const ray = add(add(times(cam.R[0], a), times(cam.R[1], b)), times(cam.R[2], cam.f));
      const level = Math.hypot(ray[0], ray[1]);
      let reach = ray[2] > 1e-9 ? entry.height / ray[2] : Infinity;
      if (reach * level > far) reach = level > 1e-9 ? far / level : 0;
      return [(cam.C[0] + ray[0] * reach) / metres(), (cam.C[1] + ray[1] * reach) / metres()];
    });
  }
  // Where a camera sees a point of the floor (map units) in its picture: [across, down] shares, or null behind it.
  function seenAt(cam, point) {
    const d = [point[0] * metres() - cam.C[0], point[1] * metres() - cam.C[1], -cam.C[2]], c = cam.R.map(row => dot(row, d));
    return c[2] > 1e-6 ? [cam.f * c[0] / c[2] / cam.aspect + 0.5, cam.f * c[1] / c[2] + 0.5] : null;
  }
  const cornersOnMap = () => { const s = room().stage, d = room().depth; return { front_left: [s.left, s.front * d], front_right: [s.right, s.front * d], back_left: [s.left, s.back * d], back_right: [s.right, s.back * d] }; };

  // Where a camera stands, in words: on the stage by the performers' sides, in the house by the audience's.
  function whereWords(entry) {
    const s = room().stage, onStage = entry.y < s.front, side = entry.x < 0.4 ? 0 : entry.x > 0.6 ? 2 : 1;
    if (room().set?.layout) return `${['on the left', 'in the middle', 'on the right'][side]}, ${onStage ? 'level with the set' : 'in front of the set'}`;
    return onStage ? `on the stage, ${['stage right', 'centre', 'stage left'][side]}` : `in the house, ${['house left', 'in the middle', 'house right'][side]}`;
  }

  // The room itself: drawn once, its words kept a readable size whatever the width of the screen.
  function build() {
    const box = panel.querySelector('.map'), s = room().stage, h = H();
    // Room view's buttons go back to stage.js before the map they stand on is made again.
    if (rows[0].closest('#room')) home.before(rows[0], rows[1]), home.after(rows[2]);
    box.replaceChildren();
    const canvas = node('div', undefined, 'canvas'), over = node('div', undefined, 'over'); box.append(canvas, grow);
    canvas.style.setProperty('--depth', room().depth);
    for (const [name, value] of [['--left', s.left], ['--right', s.right], ['--front', s.front]]) over.style.setProperty(name, value);
    const root = svg('svg', { viewBox: `0 0 ${W} ${h}`, role: 'group', 'aria-label': 'The room from above: the stage at the top, the house below. Each camera is a dot, with a wedge for what it sees.' }, canvas);
    canvas.append(over);
    const clip = svg('clipPath', { id: 'room-clip' }, svg('defs', {}, root)); svg('rect', { x: 0, y: 0, width: W, height: h }, clip);
    svg('rect', { x: 0, y: 0, width: W, height: h, class: 'house' }, root);
    const sx = s.left * W, sw = (s.right - s.left) * W, sd = s.front * h, set = room().set?.layout;
    const words = svg('g', { class: 'words', 'aria-hidden': 'true' }, root);
    const say = (text, x, y, anchor, className) => { const t = svg('text', { x, y, 'text-anchor': anchor, class: className || '' }, words); t.textContent = text; return t; };
    built = { root, over, words, key: setKey(), text: [] };
    if (set && window.setLayer) window.setLayer(root, W, h, words);          // this kind of event's own set (setmap.js), its shapes named on it
    else {
      root.insertBefore(svg('rect', { x: sx, y: 0, width: sw, height: sd, class: 'platform' }), words);
      root.insertBefore(svg('line', { x1: sx, y1: sd, x2: sx + sw, y2: sd, class: 'lip' }), words);
      built.text = [say('Back of stage', W / 2, 0, 'middle', 'quiet'), say('Stage', W / 2, sd / 2, 'middle', 'big'),
        say('SR', sx, sd / 2, 'start', 'side'), say('SL', sx + sw, sd / 2, 'end', 'side'), say('Front of stage', W / 2, sd, 'middle', 'quiet'),
        say('House left', 0, h, 'start'), say('House right', W, h, 'end'), say('House', W / 2, (sd + h) / 2, 'middle', 'big')];
    }
    built.cones = svg('g', { 'clip-path': 'url(#room-clip)' }, root);
    built.proposed = svg('path', { class: 'cone proposed', 'clip-path': 'url(#room-clip)' }, root); built.marks = svg('g', {}, root);
  }

  // Expand: the map over the whole window, and back with the button or Esc.
  const grow = node('button', 'Expand', 'grow');
  grow.type = 'button';
  function widen(on) {
    expanded = on; panel.classList.toggle('expanded', on); document.body.classList.toggle('room-expanded', on);
    grow.textContent = on ? 'Close the big map' : 'Expand'; grow.setAttribute('aria-pressed', String(on));
    grow.setAttribute('aria-label', on ? 'Close the big map (Esc)' : 'Expand the room map to the whole window');
    if (!on) fitting = null;
    draw(); grow.focus();
  }
  grow.onclick = () => widen(!expanded);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); widen(false); } });
  // The map is drawn afresh when its shape, its stage or its set changes (the set's cameras are drawn as ever).
  const setKey = () => { const set = room().set?.layout; return JSON.stringify([room().depth, room().stage, set && { ...set, cameras: undefined }]); };

  // Viewbox units for one pixel on screen: icons and words are sized in pixels, so that a phone's are big enough to touch.
  const pixel = () => W / Math.max(1, built.root.clientWidth || panel.querySelector('.map').clientWidth || W);
  function placeWords() {
    const p = pixel(), s = room().stage, h = H(), sx = s.left * W, sw = (s.right - s.left) * W, sd = s.front * h, size = 13 * p, pad = 8 * p;
    built.words.style.fontSize = `${size}px`;
    if (!built.text.length) return;
    const [back, big, sr, sl, front, hl, hr, house] = built.text;
    back.setAttribute('y', size + pad); big.setAttribute('y', sd / 2); front.setAttribute('y', sd - pad);
    // SR and SL low in the wings, clear of the cameras that usually stand at their middle.
    sr.setAttribute('x', sx + pad); sl.setAttribute('x', sx + sw - pad); sr.setAttribute('y', sd * 0.8); sl.setAttribute('y', sd * 0.8);
    hl.setAttribute('x', pad); hl.setAttribute('y', h - pad); hr.setAttribute('x', W - pad); hr.setAttribute('y', h - pad); house.setAttribute('y', (sd + h) / 2);
  }

  // A camera on the map: its wedge, a dot with an arrowhead the way it points, a handle to turn it, and its name.
  function camera(id) {
    if (drawn.has(id)) return drawn.get(id);
    const cone = svg('path', { class: 'cone' }, built.cones);
    const g = svg('g', { class: 'mark', tabindex: '0', role: 'button' }, built.marks);
    const turnable = svg('g', {}, g), stem = svg('line', { class: 'stem' }, turnable), handle = svg('circle', { class: 'handle' }, turnable);
    const body = svg('circle', { class: 'body' }, g), head = svg('path', { class: 'head' }, g), label = svg('text', { class: 'label', 'text-anchor': 'middle' }, g);
    const parts = { cone, g, turnable, stem, handle, body, head, label };
    wire(id, parts); drawn.set(id, parts); return parts;
  }

  // The flat wedge for what it sees; with a height and a tilt, what it sees of the floor.
  function wedge(id, entry = spot(id), fov = fovOf(id)) {
    if (lifted(entry)) return 'M' + footprint(entry, fov).map(([x, y]) => `${x * W} ${y * W}`).join(' L') + ' Z';
    const r = 2 * W, a = (entry.aim - fov / 2) * Math.PI / 180, b = (entry.aim + fov / 2) * Math.PI / 180;
    const x = entry.x * W, y = entry.y * H();
    return `M${x} ${y} L${x + r * Math.sin(a)} ${y - r * Math.cos(a)} A${r} ${r} 0 0 1 ${x + r * Math.sin(b)} ${y - r * Math.cos(b)} Z`;
  }

  function show(id) {
    const c = state.cameras.find(o => o.id === id), entry = spot(id), parts = camera(id), p = pixel();
    const radius = 15 * p, reach = 52 * p, mine = chosen === id;
    parts.cone.setAttribute('d', wedge(id)); parts.cone.style.fill = parts.cone.style.stroke = colour(c); parts.cone.style.strokeWidth = 1.5 * p; parts.cone.classList.toggle('chosen', mine);
    parts.g.setAttribute('transform', `translate(${entry.x * W} ${entry.y * H()})`); parts.g.classList.toggle('chosen', mine); parts.g.style.color = colour(c);
    parts.turnable.setAttribute('transform', `rotate(${entry.aim})`);
    parts.stem.setAttribute('y1', -radius); parts.stem.setAttribute('y2', -reach); parts.stem.style.strokeWidth = 2 * p;
    parts.handle.setAttribute('cy', -reach); parts.handle.setAttribute('r', 9 * p); parts.handle.style.strokeWidth = 2 * p;
    parts.body.setAttribute('r', radius); parts.body.style.strokeWidth = (mine ? 4 : 2.5) * p;
    const t = entry.aim * Math.PI / 180, tip = (x, y) => `${x * Math.cos(t) - y * Math.sin(t)} ${x * Math.sin(t) + y * Math.cos(t)}`;
    parts.head.setAttribute('d', `M${tip(0, -radius * 0.75)} L${tip(radius * 0.5, radius * 0.25)} L${tip(-radius * 0.5, radius * 0.25)} Z`);
    // The name below the dot, unless its handle is there (pointing down the page): then above. At the back wall,
    // where there is no room below, beside it; at a side wall, running inwards. On a map too small for every name, only
    // the chosen camera's is shown: the list beside the map names them all.
    const near = entry.y > 0.88, below = Math.cos(t) > -0.5, side = entry.x > 0.7 ? -1 : 1;
    parts.label.textContent = shows(c); parts.label.style.fontSize = `${13 * p}px`; parts.label.style.strokeWidth = 4 * p;
    parts.label.style.display = mine || built.root.clientWidth >= 560 ? '' : 'none';
    if (near && below) { parts.label.setAttribute('x', side * (radius + 8 * p)); parts.label.setAttribute('y', 5 * p); parts.label.setAttribute('text-anchor', side > 0 ? 'start' : 'end'); }
    else {
      parts.label.setAttribute('y', below ? radius + 17 * p : -radius - 8 * p);
      parts.label.setAttribute('text-anchor', entry.x > 0.85 ? 'end' : entry.x < 0.15 ? 'start' : 'middle'); parts.label.setAttribute('x', entry.x > 0.85 ? radius : entry.x < 0.15 ? -radius : 0);
    }
    parts.g.setAttribute('aria-label', `${shows(c)} (${c.name}), ${whereWords(entry)}, pointing ${aimWord(entry.aim)}, seeing ${Math.round(fovOf(id))} degrees across`);
  }

  // Dragging a camera moves it; dragging its handle turns it. Saved when let go. Arrow keys move a camera a little, and
  // with Shift turn it instead.
  function wire(id, parts) {
    const point = event => { const m = built.root.getScreenCTM().inverse(), p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m); return { x: p.x / W, y: p.y / H() }; };
    // In Room view the cameras are there to be seen while shots are chosen: moved only on Stage layout.
    const still = () => !open;
    parts.g.addEventListener('pointerdown', event => {
      if (still()) return;
      const how = event.target === parts.handle || event.target === parts.stem ? 'turn' : 'move', at = point(event), entry = spot(id);
      held = { id, how, from: at, start: { ...entry }, moved: false }; window.roomBusy = true;
      parts.g.setPointerCapture(event.pointerId); event.preventDefault();
    });
    parts.g.addEventListener('pointermove', event => {
      if (!held || held.id !== id) return;
      const at = point(event), entry = { ...held.start, ...local[id] };
      if (!held.moved && Math.hypot((at.x - held.from.x) * W, (at.y - held.from.y) * H()) < 3 * pixel()) return;
      held.moved = true;
      if (held.how === 'move') { entry.x = Math.min(1, Math.max(0, held.start.x + at.x - held.from.x)); entry.y = Math.min(1, Math.max(0, held.start.y + at.y - held.from.y)); }
      else {
        // Clockwise from up the page; within 4 degrees of a multiple of 15 it settles on it, as straight lines are easier to keep.
        const raw = Math.atan2((at.x - entry.x) * W, -(at.y - entry.y) * H()) * 180 / Math.PI, snapped = Math.round(raw / 15) * 15;
        entry.aim = turn(Math.abs(raw - snapped) < 4 ? snapped : raw);
      }
      local[id] = entry; show(id); details();
    });
    const drop = async () => {
      if (!held || held.id !== id) return;
      const was = held; held = null; window.roomBusy = false;
      if (!was.moved) { chosen = chosen === id ? null : id; draw(); return; }
      chosen = id;
      const entry = local[id];
      await save(id, was.how === 'move' ? { x: round(entry.x), y: round(entry.y) } : { aim: entry.aim });
    };
    parts.g.addEventListener('pointerup', drop); parts.g.addEventListener('pointercancel', drop);
    parts.g.addEventListener('keydown', event => {
      if (still()) return;
      const entry = spot(id), step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chosen = id; draw(); return; }
      if (!step) return;
      event.preventDefault(); chosen = id;
      if (event.shiftKey) save(id, { aim: turn(entry.aim + (step[0] || step[1]) * 5) });
      else save(id, { x: round(Math.min(1, Math.max(0, entry.x + step[0] / 100))), y: round(Math.min(1, Math.max(0, entry.y + step[1] / 100))) });
    });
  }
  const round = value => Math.round(value * 1000) / 1000;

  async function save(id, entry) {
    const answer = await act('/api/stage', { room: { [id]: entry } });
    delete local[id];
    if (answer) state = answer;
    draw();
  }

  // The camera chosen: where it stands, its aim exactly, what it sees and why, and what Stage Shots takes from it.
  function details() {
    const box = panel.querySelector('.details'), c = chosen && state.cameras.find(o => o.id === chosen), entry = c && spot(c.id);
    if (!c || !entry) { box.replaceChildren(node('p', 'Press a camera on the map to set it exactly. Stage Shots’ camera marks follow from this map, with the same wedge for what each camera sees.')); box.dataset.key = ''; return; }
    const view = room().views[c.id] || { fov: 70, lens: 'usual lens', source: 'typical' }, own = room().map[c.id]?.fov, derived = room().derived[c.id], hand = state.layout[c.id]?.cam;
    const key = JSON.stringify([c.id, entry, view, own, derived, hand, !!state.remote, shows(c), room().width_m, room().width_from, expanded, room().stage]);
    if (box.dataset.key === key) return;
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    box.dataset.key = key; box.replaceChildren();
    const title = node('h3', `${shows(c)} (${c.name})`); title.style.setProperty('--swatch', colour(c)); box.append(title);
    box.append(node('p', `Stands ${whereWords(entry)}, pointing ${aimWord(entry.aim)}.`));
    // The aim, exactly: a dial for the hand and a number for the keyboard.
    const aimField = node('div', undefined, 'field');
    const dial = node('label', 'Aim '), slider = document.createElement('input'), number = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '359'; slider.step = '1'; slider.value = String(entry.aim); slider.dataset.k = 'aim-range';
    number.type = 'number'; number.min = '0'; number.max = '359'; number.step = '1'; number.value = String(entry.aim); number.dataset.k = 'aim-number'; number.setAttribute('aria-label', 'Aim in degrees, clockwise from up the page');
    slider.oninput = () => { local[c.id] = { ...entry, aim: Number(slider.value) }; number.value = slider.value; show(c.id); };
    slider.onchange = () => save(c.id, { aim: Number(slider.value) });
    number.onchange = () => { const v = Number(number.value); if (Number.isFinite(v)) save(c.id, { aim: turn(v) }); };
    dial.append(slider, number, node('span', '°')); aimField.append(dial);
    const nudges = node('div', undefined, 'compass');
    for (const [text, by] of [['↺ 15°', -15], ['↺ 1°', -1], ['1° ↻', 1], ['15° ↻', 15]]) {
      const b = node('button', text); b.dataset.k = `nudge${by}`; b.setAttribute('aria-label', `Turn ${Math.abs(by)} degrees ${by < 0 ? 'anticlockwise' : 'clockwise'}`);
      b.onclick = () => save(c.id, { aim: turn(entry.aim + by) }); nudges.append(b);
    }
    aimField.append(nudges, node('small', 'Degrees clockwise from up the page: 0 points at the back of the stage, 180 out at the house.')); box.append(aimField);
    // What it sees: from its lens, unless the administrator has set it.
    const seeing = node('div', undefined, 'field');
    seeing.append(node('p', own !== undefined ? `Sees ${own}° across: set by the administrator. Its lens gives ${view.fov}° (${view.lens}, ${view.source}).`
      : `Sees ${view.fov}° across: ${view.lens}, ${view.source}.`));
    if (state.remote) {
      const set = node('label', 'Field of view '), field = document.createElement('input');
      field.type = 'number'; field.min = String(room().narrowest); field.max = String(room().widest); field.step = '1'; field.value = String(own ?? view.fov); field.dataset.k = 'fov';
      field.onchange = () => { const v = Number(field.value); if (v >= room().narrowest && v <= room().widest) save(c.id, { fov: v }); else result.textContent = `A field of view is from ${room().narrowest} to ${room().widest} degrees.`; };
      set.append(field, node('span', '°'));
      const back = node('button', `Use the lens’s ${view.fov}°`); back.dataset.k = 'fov-reset'; back.disabled = own === undefined; back.onclick = () => save(c.id, { fov: null });
      seeing.append(set, back);
    }
    box.append(seeing);
    // Up and down: its height and tilt, for what it sees of the floor and a gimbal's tilt to a performer.
    const upright = node('div', undefined, 'field');
    const numberField = (words, k, value, low, high, step, unitWord) => {
      const label = node('label', words), input = document.createElement('input');
      input.type = 'number'; input.min = String(low); input.max = String(high); input.step = String(step); input.value = value === undefined ? '' : String(value); input.dataset.k = k;
      label.append(input, node('span', unitWord)); return [label, input];
    };
    const [heightLabel, heightInput] = numberField('Height ', 'height', entry.height, 0, room().highest || 30, 0.1, 'm');
    const [tiltLabel, tiltInput] = numberField('Tilt ', 'tilt', entry.tilt, -90, 90, 1, '°');
    tiltInput.setAttribute('aria-label', 'Tilt in degrees: up is positive, down negative, 0 level');
    const both = () => {
      const h = heightInput.value === '' ? null : Number(heightInput.value), t = tiltInput.value === '' ? null : Number(tiltInput.value);
      if (h === null || t === null) { if (h === null && t === null && lifted(entry)) save(c.id, { height: null, tilt: null, roll: null }); return; }
      if (h >= 0 && h <= (room().highest || 30) && t >= -90 && t <= 90) save(c.id, { height: h, tilt: Math.round(t) });
      else result.textContent = `A height is 0 to ${room().highest || 30} m, a tilt -90 to 90 degrees.`;
    };
    heightInput.onchange = both; tiltInput.onchange = both;
    upright.append(heightLabel, tiltLabel);
    if (lifted(entry)) {
      upright.append(node('small', `${entry.height.toFixed(1)} m above the floor the performers stand on, ${entry.tilt === 0 ? 'level' : `tilted ${Math.abs(entry.tilt)}° ${entry.tilt < 0 ? 'down' : 'up'}`}${entry.roll ? `, rolled ${Math.abs(entry.roll)}°` : ''}: the map shows what it sees of the floor. A gimbal on it is tilted to each performer from this.`));
      upright.append(elevation(entry, fovOf(c.id)));
      const flat = node('button', 'Back to a flat wedge'); flat.dataset.k = 'flat'; flat.onclick = () => save(c.id, { height: null, tilt: null, roll: null });
      upright.append(flat);
    } else upright.append(node('small', 'Give its height and tilt (or mark the stage’s corners on its picture, expanded) to see what it really sees of the floor, for a camera pointing well up or down.'));
    // The map's width in metres, which heights are measured against.
    const [wideLabel, wideInput] = numberField('Map width ', 'width', room().width_m, 0.5, 200, 0.1, 'm');
    wideInput.onchange = async () => {
      const v = Number(wideInput.value);
      if (!(v >= 0.5 && v <= 200)) { result.textContent = 'The map is 0.5 to 200 m across.'; return; }
      const answer = await act(room().set?.layout ? '/api/stage/set' : '/api/stage', room().set?.layout ? { width_m: v } : { room_width_m: v });
      if (answer) state = { ...state, ...answer };
      draw();
    };
    upright.append(wideLabel, node('small', { set: 'From the set layout’s scale.', room: 'As set here.', default: 'A guess: set how wide the map is, wall to wall, for heights to be right.' }[room().width_from] || ''));
    box.append(upright);
    if (open && !expanded) { const check = node('button', 'Check against its picture'); check.dataset.k = 'check'; check.onclick = () => widen(true); box.append(check); }
    // What Stage Shots takes from it.
    if (derived) {
      const follows = node('div', undefined, 'field');
      follows.append(node('p', `In Stage Shots its button’s mark shows the camera ${standsWord(derived.cam.at)}, pointing ${aimWord(derived.cam.aim)}, with this wedge.`));
      if (derived.w) follows.append(node('small', `It takes in about ${Math.round(derived.w * 100)}% of the ${c.kind === 'crowd' ? words().audience || 'audience' : 'stage'}’s width there: its button below is offered that as its width.`));
      box.append(follows);
    }
    const off = node('button', 'Take it off the map'); off.dataset.k = 'off';
    off.onclick = async () => { chosen = null; await save(c.id, { x: null, y: null }); };
    const close = node('button', 'Close'); close.dataset.k = 'close'; close.onclick = () => { chosen = null; draw(); };
    box.append(off, close);
    if (focused) box.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus();
  }

  // What a fit proposes, as the fields saved with it: what the corners gave, a field of view only by the administrator
  // (it is theirs to set), and a roll left over from before taken off when a whole pose comes without one.
  function proposal(answer) {
    const found = { ...answer.proposal };
    if (!admin()) delete found.fov;
    if (answer.method === 'corners' && found.roll === undefined) found.roll = null;
    return found;
  }
  const poseWords = p => [p.x !== undefined && `stands ${whereWords(p)}`, `points ${aimWord(p.aim)} (${p.aim}°)`, p.tilt !== undefined && `${p.tilt === 0 ? 'level' : `tilted ${Math.abs(p.tilt)}° ${p.tilt < 0 ? 'down' : 'up'}`}`,
    p.height !== undefined && `${p.height.toFixed(1)} m up`, p.roll && `rolled ${Math.abs(p.roll)}° ${p.roll > 0 ? 'clockwise' : 'anticlockwise'}`, p.fov !== undefined && `sees ${Math.round(p.fov)}° across`].filter(Boolean).join(', ');

  // On Stage layout, expanded, with a camera chosen: its picture, the map's idea of where the stage's corners are in
  // it, and marking the corners to have the manager work out where it stands and points.
  function look() {
    let box = panel.querySelector('.look');
    if (!box) { box = node('div', undefined, 'look'); box.setAttribute('aria-live', 'polite'); panel.querySelector(':scope > .side').prepend(box); }
    const c = chosen && state.cameras.find(o => o.id === chosen), entry = c && spot(c.id);
    box.hidden = !(open && expanded && c && entry);
    if (box.hidden) { box.dataset.key = ''; return; }
    const key = JSON.stringify([c.id, entry, fovOf(c.id), shotAt, fitting, room().width_m, room().stage, room().depth, !!state.remote]);
    if (box.dataset.key === key) return;
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    box.dataset.key = key; box.replaceChildren();
    const title = node('h3', `What ${shows(c)} sees`); title.style.setProperty('--swatch', colour(c)); box.append(title);
    // The picture itself kept while the camera and New picture are the same: each one is taken from OBS afresh.
    const source = `/api/stage/set/grab/${encodeURIComponent(c.id)}?width=960&at=${shotAt}`;
    if (shot?.source !== source) { shot = { source, img: document.createElement('img'), failed: false }; shot.img.src = source; }
    const figure = node('figure', undefined, 'picture'), img = shot.img, over = svg('svg', { viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    img.alt = `${shows(c)}’s picture now${fitting ? `: press ${CORNERS[fitting.next]?.[2] || 'Work it out'}` : ''}`;
    const said = node('small');
    const failed = () => { said.textContent = 'No picture from this camera now (it needs OBS, and the camera in it): its wedge can still be set by hand.'; figure.hidden = true; };
    img.onerror = () => { shot.failed = true; failed(); };
    if (shot.failed) failed();
    img.onload = () => { if (fitting) fitting.aspect = img.naturalWidth / img.naturalHeight; paintOver(); };
    figure.append(img, over); box.append(figure, said);
    function paintOver() {
      over.replaceChildren();
      const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : ASPECT, fov = fovOf(c.id), places = cornersOnMap(), p = 1 / Math.max(1, img.clientWidth);
      over.setAttribute('viewBox', `0 0 ${aspect} 1`);
      const at = ([u, v]) => [u * aspect, v];
      // Where the map has the corners: rings where it can say (with a height and tilt), otherwise upright lines
      // across the picture where the wedge's own sides say the front corners are.
      if (lifted(entry)) {
        const cam = pinhole(entry, fov, aspect), seen = Object.fromEntries(Object.entries(places).map(([k, point]) => [k, seenAt(cam, point)]));
        const ring = ['front_left', 'front_right', 'back_right', 'back_left'].map(k => seen[k]);
        if (ring.every(Boolean)) svg('polygon', { points: ring.map(q => at(q).join(',')).join(' '), class: 'expected', stroke: colour(c), 'stroke-width': 2 * p * aspect }, over);
        for (const [k, q] of Object.entries(seen)) if (q) svg('circle', { cx: at(q)[0], cy: q[1], r: 6 * p * aspect, class: 'expected', stroke: colour(c), 'stroke-width': 2 * p * aspect }, over);
      } else {
        const [cx, cy] = [entry.x, entry.y * room().depth];
        for (const k of ['front_left', 'front_right']) {
          const [px, py] = places[k], off = Math.atan2(px - cx, -(py - cy)) * 180 / Math.PI - entry.aim, d = ((off + 540) % 360) - 180;
          if (Math.abs(d) >= 89) continue;
          const u = 0.5 + Math.tan(d * Math.PI / 180) / (2 * Math.tan(fov * Math.PI / 360));
          if (u > -0.05 && u < 1.05) svg('line', { x1: u * aspect, x2: u * aspect, y1: 0, y2: 1, class: 'expected', stroke: colour(c), 'stroke-width': 2 * p * aspect }, over);
        }
      }
      for (const [k, q] of Object.entries(fitting?.points || {})) {
        svg('circle', { cx: at(q)[0], cy: q[1], r: 7 * p * aspect, class: 'marked', 'stroke-width': 2.5 * p * aspect }, over);
        const t = svg('text', { x: at(q)[0] + 10 * p * aspect, y: q[1] - 8 * p * aspect, class: 'marked-word', 'font-size': 13 * p * aspect, 'stroke-width': 4 * p * aspect }, over);
        t.textContent = CORNERS.find(([n]) => n === k)[1];
      }
    }
    if (img.complete && img.naturalWidth) paintOver();
    box.append(node('small', lifted(entry) ? 'The coloured outline is where the map says the stage’s corners are in this picture: if they sit on the real corners, the camera is placed right.'
      : 'The coloured lines are where the wedge’s sides say the front corners of the stage are in this picture: if they line up with the real corners, the aim and field of view are right.'));
    const row = node('div', undefined, 'buttons'), again = node('button', 'New picture'); again.dataset.k = 'shot'; again.onclick = () => { shotAt = Date.now(); draw(); };
    row.append(again);
    if (!fitting) {
      const mark = node('button', 'Mark the corners', 'primary'); mark.dataset.k = 'mark';
      mark.onclick = () => { fitting = { id: c.id, points: {}, next: 0, answer: null, said: '', aspect: img.naturalWidth ? img.naturalWidth / img.naturalHeight : ASPECT }; draw(); };
      row.append(mark); box.append(row);
      box.append(node('small', 'Mark where the stage’s corners are in this picture, and the manager works out where the camera stands and points: with all four, its place, height, aim, tilt and field of view; with the two front ones, its aim from where it stands on the map.'));
    } else {
      // Marking: a press on the picture puts the corner asked for there.
      img.style.cursor = 'crosshair';
      img.onclick = event => {
        if (fitting.answer || fitting.next >= CORNERS.length) return;
        const r = img.getBoundingClientRect(), u = (event.clientX - r.left) / r.width, v = (event.clientY - r.top) / r.height;
        fitting.points[CORNERS[fitting.next][0]] = [Math.round(u * 10000) / 10000, Math.round(v * 10000) / 10000];
        fitting.next += 1; draw();
      };
      const asking = CORNERS[fitting.next];
      if (!fitting.answer) box.append(node('p', asking ? `Press ${asking[2]} in the picture${fitting.next >= 2 ? ', or Skip it if it is hidden' : ''}.` : 'All four marked.'));
      if (asking && fitting.next >= 2) { const skip = node('button', 'Skip'); skip.dataset.k = 'skip'; skip.onclick = () => { fitting.next += 1; draw(); }; row.append(skip); }
      const marked = Object.keys(fitting.points).length;
      if (!fitting.answer) {
        const work = node('button', 'Work it out', 'primary'); work.dataset.k = 'work'; work.disabled = marked < 2 || fitting.busy;
        work.onclick = async () => {
          fitting.busy = true; fitting.said = ''; draw();
          try { fitting.answer = await api('/api/stage/room/fit', { camera: c.id, points: fitting.points, aspect: fitting.aspect }); }
          catch (error) { fitting.said = error.message; }
          fitting.busy = false; draw();
        };
        row.append(work);
      }
      const restart = node('button', 'Start again'); restart.dataset.k = 'restart'; restart.onclick = () => { fitting = { ...fitting, points: {}, next: 0, answer: null, said: '' }; draw(); };
      const cancel = node('button', 'Cancel'); cancel.dataset.k = 'cancel'; cancel.onclick = () => { fitting = null; draw(); };
      row.append(restart, cancel); box.append(row);
      if (fitting.said) { const why = node('p', fitting.said, 'recording-warning'); why.setAttribute('role', 'status'); box.append(why); }
      if (fitting.answer) {
        const a = fitting.answer, found = proposal(a), offer = node('div', undefined, 'offer');
        offer.append(node('p', `Proposed (dashed on the map): ${poseWords(a.proposal)}.`));
        offer.append(node('small', a.method === 'corners'
          ? `From four corners, the map ${a.width_m} m across${a.fov_from === 'the lens' ? `, the lens’s ${a.lens_fov}°` : ''}: they agree with this camera to about ${(a.error * 100).toFixed(1)}% of the picture.`
          : `From ${Object.keys(fitting.points).length} corners and where the map has the camera: the aim only. ${a.fov_seen ? `Those corners are as far apart as a ${Math.round(a.fov_seen)}° view puts them (it is taken to see ${Math.round(a.lens_fov)}°).` : ''}`));
        if (a.proposal.fov !== undefined && found.fov === undefined && Math.abs(a.proposal.fov - fovOf(c.id)) >= 1) offer.append(node('small', `Its field of view is the administrator’s to set: ${a.proposal.fov}° is not taken here.`));
        a.notes.forEach(text => offer.append(node('p', text, 'recording-warning')));
        const take = node('button', 'Use this', 'primary'); take.dataset.k = 'take';
        take.onclick = async () => { fitting = null; await save(c.id, found); };
        const leave = node('button', 'Not this'); leave.dataset.k = 'leave'; leave.onclick = () => { fitting = { ...fitting, answer: null }; draw(); };
        offer.append(take, leave); box.append(offer);
      }
    }
    if (focused) box.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus();
  }

  // From the side: the camera at its height, what it sees up and down, and a performer in the middle of the stage.
  function elevation(entry, fov) {
    const s = room().stage, m = metres(), target = [(s.left + s.right) / 2 * m, (s.back + s.front) / 2 * room().depth * m];
    const away = Math.max(0.5, Math.hypot(target[0] - entry.x * m, target[1] - entry.y * room().depth * m)), half = Math.atan(Math.tan(fov * Math.PI / 360) / ASPECT) * 180 / Math.PI;
    const w = 320, h = 140, pad = 14, reach = away * 1.35, top = Math.max(entry.height, PERSON) * 1.4, sx = (w - 2 * pad) / reach, sy = (h - 2 * pad) / top, k = Math.min(sx, sy);
    const X = d => pad + d * k, Y = z => h - pad - z * k;
    const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'elevation', role: 'img',
      'aria-label': `From the side: the camera ${entry.height.toFixed(1)} m up, ${entry.tilt === 0 ? 'level' : `tilted ${Math.abs(entry.tilt)}° ${entry.tilt < 0 ? 'down' : 'up'}`}, seeing ${Math.round(2 * half)}° up and down; a performer ${PERSON} m tall in the middle of the stage, ${away.toFixed(1)} m away.` });
    svg('rect', { x: 0, y: 0, width: w, height: Y(0) }, svg('clipPath', { id: 'side-clip' }, svg('defs', {}, root)));
    const above = svg('g', { 'clip-path': 'url(#side-clip)' }, root);
    svg('line', { x1: 0, x2: w, y1: Y(0), y2: Y(0), class: 'floor' }, root);
    const ray = degrees => { const r = degrees * Math.PI / 180, far = reach * 3; return [X(Math.cos(r) * far), Y(entry.height + Math.sin(r) * far)]; };
    const [ux, uy] = ray(entry.tilt + half), [dx, dy] = ray(entry.tilt - half), [mx, my] = ray(entry.tilt);
    svg('path', { d: `M${X(0)} ${Y(entry.height)} L${ux} ${uy} L${dx} ${dy} Z`, class: 'view' }, above);
    svg('line', { x1: X(0), y1: Y(entry.height), x2: mx, y2: my, class: 'axis' }, above);
    svg('line', { x1: X(away), x2: X(away), y1: Y(0), y2: Y(PERSON), class: 'person' }, root);
    svg('circle', { cx: X(away), cy: Y(PERSON) - 5, r: 5, class: 'person-head' }, root);
    svg('circle', { cx: X(0), cy: Y(entry.height), r: 6, class: 'camera' }, root);
    return root;
  }

  // Every camera by name: those on the map, pressed to choose one (a camera hidden under another, or on a phone, is
  // still easy to reach); those not on it yet, each put on it with a press, in the middle of the house pointing at the stage.
  function waiting() {
    const box = panel.querySelector('.waiting'), on = state.cameras.filter(c => room().map[c.id]), off = state.cameras.filter(c => !room().map[c.id]);
    const key = JSON.stringify([state.cameras.map(c => [c.id, shows(c), c.name, !!room().map[c.id]]), chosen]);
    if (box.dataset.key === key) return;
    box.dataset.key = key; box.replaceChildren();
    if (on.length) {
      box.append(node('h3', 'On the map'));
      const list = node('div', undefined, 'placed');
      on.forEach(c => {
        const b = node('button', `${shows(c)} (${c.name})`); b.style.setProperty('--swatch', colour(c)); b.setAttribute('aria-pressed', String(chosen === c.id));
        b.onclick = () => { chosen = chosen === c.id ? null : c.id; draw(); }; list.append(b);
      });
      box.append(list);
    }
    if (!off.length) return;
    box.append(node('h3', 'Not on the map yet'));
    off.forEach((c, i) => {
      const b = node('button', `＋ ${shows(c)} (${c.name})`);
      b.onclick = () => { chosen = c.id; save(c.id, { x: round((i + 1) / (off.length + 1)), y: round(room().stage.front + (1 - room().stage.front) * 0.45), aim: 0 }); };
      box.append(b);
    });
  }

  // Room view: stage.js's rows onto the map, or back where they were.
  function seat(onMap) {
    const there = rows[0].closest('#room');
    if (onMap && !there) built.over.append(...rows);
    else if (!onMap && there) { home.before(rows[0], rows[1]); home.after(rows[2]); }
  }

  function draw() {
    if (!room()) { if (together) together.hidden = true; panel.hidden = true; return; }
    const roomy = window.innerWidth >= NARROWEST, mixed = !open && combined && roomy;
    if (together) { together.hidden = !roomy; together.setAttribute('aria-pressed', String(mixed)); together.textContent = mixed ? 'Room view: on' : 'Room view'; }
    if (!open) stage.hidden = mixed;
    panel.hidden = !(open || mixed);
    panel.classList.toggle('together', mixed);
    if (!open && !mixed) { if (built) seat(false); return; }
    if (mixed) hint.textContent = 'Press a camera’s button to put it on air. The room is seen from above: each dot is where a camera stands, its wedge what it sees.';
    else if (roomHint) roomHint.textContent = window.setAsking || 'Drag each camera to where it stands and its round handle to where it points; the wedge is what it sees. Press one to set it exactly. Saved as you let go.';
    if (!built || built.key !== setKey()) { build(); drawn.clear(); }
    seat(mixed);
    // Each button striped in its camera's colour, to find its dot and wedge on the map by.
    state.cameras.forEach(c => tiles.get(c.id)?.style.setProperty('--swatch', mixed && room().map[c.id] ? colour(c) : 'transparent'));
    placeWords();
    if (chosen && !room().map[chosen]) chosen = null;
    panel.querySelector('.map').classList.toggle('choosing', !!chosen);
    for (const [id, parts] of drawn) if (!room().map[id] || !state.cameras.some(c => c.id === id)) { parts.cone.remove(); parts.g.remove(); drawn.delete(id); }
    // The chosen camera drawn last, over the others.
    const ids = state.cameras.map(c => c.id).filter(id => room().map[id]).sort((a, b) => (a === chosen) - (b === chosen));
    ids.forEach(id => { show(id); built.marks.append(drawn.get(id).g); });
    // The fit offered for the chosen camera, dashed, until it is taken or left.
    const offer = fitting?.answer && fitting.id === chosen && room().map[chosen] ? { ...spot(chosen), ...proposal(fitting.answer) } : null;
    built.proposed.style.display = offer ? '' : 'none';
    if (offer) { const c = state.cameras.find(o => o.id === chosen); built.proposed.setAttribute('d', wedge(chosen, offer, offer.fov ?? fovOf(chosen))); built.proposed.style.stroke = built.proposed.style.fill = colour(c); built.proposed.style.strokeWidth = 3 * pixel(); }
    // In Room view the list and the chosen camera's details are not shown: choosing shots needs the map alone.
    if (mixed) { chosen = null; return; }
    if (fitting && fitting.id !== chosen) fitting = null;
    look(); details(); waiting();
  }

  if (together) together.onclick = () => {
    combined = !combined; chosen = null;
    try { localStorage.setItem('stage-room-view', combined ? 'on' : 'off'); } catch (error) { /* not remembered */ }
    window.stageDraw();
  };
  // From a button's own panel on Stage layout: its camera chosen on the map, and the map brought into view.
  window.roomChoose = id => { if (!open || !room()?.map?.[id]) return; chosen = id; window.stageDraw(); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  window.roomDraw = () => { draw(); if (window.setDraw) window.setDraw(); };
})();
