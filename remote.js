'use strict';
// The Remote page: every key on one page, as a remote control's buttons are, each one press (remotekeys.py). A key does
// one or more steps in turn: a camera on air, a gimbal camera turned and zoomed to a saved target, back from it, home,
// automatic choosing on or off, a wait. Its icon says what it does (a camera: on air; a target: to a saved angle and
// zoom; a red camera on its corner: then on air). It is lit while what it does is so (its camera on air, its gimbal
// camera on its target), and faint while it cannot be done. Edit keys, at the foot of the page, sets them out.
let csrf = '', state = null, editing = false, drafting = null, dragged = null, pressing = false;
const keysBox = document.querySelector('#keys'), editor = document.querySelector('#key-editor'), stepsBox = document.querySelector('#key-steps');
const editButton = document.querySelector('#edit');
const DO_NAMES = { take: 'Put a camera on air', target: 'Turn a gimbal camera to a saved target', back: 'Put a gimbal camera back from its target', home: 'Turn a gimbal camera home', auto: 'Automatic choosing', wait: 'Wait' };
const ICONS = {
  take: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v4.5M12 18v4.5M1.5 12h4.5M18 12h4.5"/>',
  back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  auto: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
};
// What a key is for, first: a turn to a target, else a camera on air, else its first step. The rest are badges.
const RANK = ['target', 'take', 'back', 'home', 'auto'];
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function svg(name) { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('aria-hidden', 'true'); e.innerHTML = ICONS[name]; return e; }
async function api(path, body) {
  const { response: r, data: d, unreachable } = await window.concert.fetchJson(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && csrf) location.reload();
  if (!r.ok) { const failure = Error(d.detail || `HTTP ${r.status}`); failure.unreachable = unreachable; throw failure; }
  return d;
}

async function enter(session) {
  csrf = session.csrf; document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#remote').hidden = false;
  window.concert.session = session; window.concert.nav(session.role);
  await refresh(); window.concert.every(refresh, 1500);
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { name: document.querySelector('#username').value, password: document.querySelector('#password').value })); }
  catch (error) { concert.fail(error); }
};
window.concert.resume().then(session => { if (session) enter(session); });

async function refresh() {
  if (dragged) return;                  // not while a key is being moved
  try { show(await api('/api/remote')); } catch (error) { concert.fail(error); }
}

const camera = id => state.cameras.find(c => c.id === id);
const keys = () => state.layout.keys;

// Whether a step can be done now, and why not.
function readiness(step) {
  if (!('camera' in step)) return null;
  const c = camera(step.camera);
  if (!c) return 'its camera is no longer paired';
  if (!c.online) return `${c.name} is not connected`;
  if (step.do === 'take') return null;
  if (!c.point) return `${c.name}'s gimbal cannot turn to a position`;
  if (step.do === 'home' && !c.home) return `${c.name} has no home position (Set home on its card)`;
  if (step.do === 'target') {
    const t = c.targets.find(x => x.id === step.target);
    if (!t) return `${c.name} has no such target in ${state.mode_name}`;
    if (t.stale) return `${c.name}'s target ${t.name} needs saving again (the phone restarted)`;
  }
  return null;
}
// Lit while what the key does is so: its camera on air, its gimbal camera on its target, automatic choosing as it sets.
function lit(key) {
  const shown = key.steps.filter(s => ['take', 'target', 'auto'].includes(s.do));
  if (!shown.length) return null;
  const so = shown.every(s => s.do === 'take' ? state.on_air === s.camera : s.do === 'target' ? camera(s.camera)?.on_target === s.target : s.on === 'toggle' ? state.auto : state.auto === s.on);
  if (!so) return null;
  return shown.some(s => s.do === 'take') ? 'live' : shown.some(s => s.do === 'target') ? 'there' : 'on';
}
const cameraName = step => camera(step.camera)?.name || 'Camera gone';
function stepWords(step) {
  if (step.do === 'take') return cameraName(step);
  if (step.do === 'target') return camera(step.camera)?.targets.find(t => t.id === step.target)?.name || 'Target gone';
  if (step.do === 'back') return 'Back';
  if (step.do === 'home') return 'Home';
  if (step.do === 'auto') return `Auto ${step.on === 'toggle' ? 'on/off' : step.on ? 'on' : 'off'}`;
  return `Wait ${step.seconds} s`;
}
const main = key => key.steps.find(s => s.do === RANK.find(r => key.steps.some(x => x.do === r))) || key.steps[0];
function keyLabel(key) { return key.label || capital(stepWords(main(key))); }
function capital(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

function show(answer) {
  state = answer;
  drawKeys();
  editButton.setAttribute('aria-pressed', String(editing)); editButton.textContent = editing ? 'Done' : 'Edit keys';
  document.querySelector('#edit-hint').hidden = !editing;
  document.querySelector('#no-keys').hidden = editing || keys().length > 0;
  document.querySelector('#address').textContent = state.address ? `On a phone or tablet: ${state.address}` : '';
}

function drawKeys() {
  const drawn = keys().map(drawKey);
  if (editing && keys().length < state.most_keys) {
    const add = node('button', undefined, 'key add'); add.type = 'button';
    add.append(Object.assign(node('span', undefined, 'key-icon'), {}), node('span', 'Add key', 'key-label'));
    add.querySelector('.key-icon').append(svg('add'));
    add.onclick = () => openEditor({ label: '', colour: 'grey', steps: [] });
    drawn.push(add);
  }
  keysBox.replaceChildren(...drawn);
}

function drawKey(key, index) {
  const b = node('button', undefined, `key c-${key.colour}${editing ? ' editing' : ''}`); b.type = 'button';
  const why = key.steps.map(readiness).find(Boolean), on = lit(key), first = main(key);
  if (why && !editing) b.classList.add('not-ready');
  if (on) b.classList.add('lit', ...(on === 'there' ? ['on-target'] : on === 'on' ? ['auto-on'] : []));
  // The icon for what it is for, and a badge on its corner for each other kind of step: a red camera for "then on air".
  const icon = node('span', undefined, 'key-icon'); icon.append(svg(first.do));
  const others = [...new Set(key.steps.filter(s => s !== first && s.do !== 'wait' && s.do !== first.do).map(s => s.do))].slice(0, 2);
  if (others.length) {
    const badges = node('span', undefined, 'key-badges');
    for (const kind of others) { const badge = node('span', undefined, kind === 'take' ? 'on-air' : ''); badge.append(svg(kind)); badges.append(badge); }
    icon.append(badges);
  }
  // Under the label, the camera it moves or puts on air, when the label does not say so already.
  const cameraOf = 'camera' in first ? cameraName(first) : '';
  const what = cameraOf && cameraOf !== keyLabel(key) ? cameraOf : '';
  b.append(icon, node('span', keyLabel(key), 'key-label'), ...(what ? [node('span', what, 'key-what')] : []));
  const said = key.steps.map(s => `${DO_NAMES[s.do]}: ${s.do === 'target' ? `${cameraName(s)}, ${stepWords(s)}` : stepWords(s)}`).join('; then ');
  b.title = [said, why ? `Not ready: ${why}` : ''].filter(Boolean).join('\n');
  b.setAttribute('aria-label', `${keyLabel(key)}${what ? `, ${what}` : ''}${on ? ', on' : ''}${why ? `, not ready: ${why}` : ''}`);
  b.onclick = () => editing ? openEditor(key) : press(key, b);
  if (editing) dragging(b, index);
  return b;
}

// Moving a key: dragged onto another, it takes that one's place.
function dragging(b, index) {
  b.draggable = true;
  b.ondragstart = () => { dragged = { index }; };
  b.ondragend = () => { dragged = null; };
  b.ondragover = e => { if (dragged) { e.preventDefault(); b.classList.add('dragover'); } };
  b.ondragleave = () => b.classList.remove('dragover');
  b.ondrop = async e => {
    e.preventDefault(); b.classList.remove('dragover');
    if (!dragged || dragged.index === index) return;
    const [moved] = keys().splice(dragged.index, 1); keys().splice(index, 0, moved); dragged = null;
    await keep();
  };
}

async function press(key, b) {
  if (pressing) return;
  pressing = true; b.classList.add('pressing');
  try { navigator.vibrate?.(15); } catch (error) { /* no vibration here */ }
  try {
    const answer = await api('/api/remote/press', { key: key.id });
    if (answer.failed) concert.say(answer.did.length ? `${answer.did.join('; ')}; then ${answer.failed}` : answer.failed, 'error');
    else concert.say(answer.did.join('; ') || keyLabel(key));
    show(answer.remote);
  } catch (error) { concert.fail(error); }
  finally { pressing = false; b.classList.remove('pressing'); }
}

async function keep() {
  try { show(await api('/api/remote', { layout: state.layout })); concert.say('Keys kept'); }
  catch (error) { concert.fail(error); await refresh(); }
}

editButton.onclick = () => { editing = !editing; show(state); };
// With no keys yet: one for each camera, to put it on air, in their colours' order.
document.querySelector('#per-camera').onclick = async () => {
  state.layout.keys = state.cameras.slice(0, state.most_keys).map((c, n) => ({ label: c.name.slice(0, 24), colour: state.colours[1 + n % (state.colours.length - 1)], steps: [{ do: 'take', camera: c.id }] }));
  await keep();
};

// ---- the key editor ----
function openEditor(key) {
  drafting = { key, colour: key.colour, steps: key.steps.map(s => ({ ...s })) };
  if (!drafting.steps.length) drafting.steps.push(firstStep());
  document.querySelector('#key-editor-title').textContent = key.id ? `Key: ${keyLabel(key)}` : 'New key';
  document.querySelector('#key-label').value = key.label;
  const at = keys().indexOf(key);
  document.querySelector('#delete-key').hidden = !key.id;
  document.querySelector('#move-earlier').hidden = document.querySelector('#move-later').hidden = !key.id;
  document.querySelector('#move-earlier').disabled = at <= 0; document.querySelector('#move-later').disabled = at < 0 || at >= keys().length - 1;
  const colours = document.querySelector('#key-colours');
  colours.replaceChildren(node('legend', 'Colour'), ...state.colours.map(c => {
    const label = node('label', undefined, `c-${c}`), input = node('input'), swatch = node('span');
    input.type = 'radio'; input.name = 'key-colour'; input.value = c; input.checked = c === drafting.colour; input.setAttribute('aria-label', c);
    input.onchange = () => { drafting.colour = c; };
    label.append(input, swatch); return label;
  }));
  drawSteps(); editor.showModal();
}
function firstStep() { const c = state.cameras.find(x => x.point) || state.cameras[0]; return c ? (c.point ? { do: 'target', camera: c.id, target: c.targets[0]?.id || '' } : { do: 'take', camera: c.id }) : { do: 'auto', on: 'toggle' }; }

function drawSteps() {
  stepsBox.replaceChildren(...drafting.steps.map((step, index) => {
    const li = node('li'), fields = node('span', undefined, 'step-fields');
    fields.append(select(Object.entries(DO_NAMES), step.do, value => { drafting.steps[index] = fresh(value, step); drawSteps(); }, 'What it does'));
    if ('camera' in step) {
      const cameras = state.cameras.filter(c => step.do === 'take' || c.point || c.id === step.camera);
      fields.append(select(cameras.map(c => [c.id, c.name + (c.online ? '' : ' (not connected)')]).concat(camera(step.camera) ? [] : [[step.camera, 'Camera gone']]), step.camera,
        value => { step.camera = value; if (step.do === 'target') step.target = camera(value)?.targets[0]?.id || ''; drawSteps(); }, 'Camera'));
    }
    if (step.do === 'target') {
      const c = camera(step.camera), targets = c ? c.targets : [];
      if (targets.length) fields.append(select(targets.map(t => [t.id, t.name + (t.stale ? ' (save again)' : '')]).concat(targets.some(t => t.id === step.target) ? [] : [[step.target, 'Target gone']]), step.target, value => { step.target = value; }, 'Target'));
      const save = node('button', 'Save where it points now…'); save.type = 'button'; save.disabled = !c?.online || !c?.point;
      save.onclick = () => saveTarget(step); fields.append(save);
    }
    if (step.do === 'auto') fields.append(select([[true, 'On'], [false, 'Off'], ['toggle', 'On and off in turn']], step.on, value => { step.on = value === 'true' ? true : value === 'false' ? false : 'toggle'; }, 'Automatic choosing'));
    if (step.do === 'wait') {
      const input = node('input'); input.type = 'number'; input.min = '0.1'; input.max = '10'; input.step = '0.1'; input.value = step.seconds; input.setAttribute('aria-label', 'Seconds');
      input.onchange = () => { step.seconds = Math.min(10, Math.max(0.1, Number(input.value) || 1)); }; fields.append(input, node('span', 'seconds'));
    }
    const up = node('button', '↑'); up.type = 'button'; up.disabled = index === 0; up.setAttribute('aria-label', 'Move step up');
    up.onclick = () => { [drafting.steps[index - 1], drafting.steps[index]] = [drafting.steps[index], drafting.steps[index - 1]]; drawSteps(); };
    const out = node('button', '✕'); out.type = 'button'; out.disabled = drafting.steps.length < 2; out.setAttribute('aria-label', 'Remove step');
    out.onclick = () => { drafting.steps.splice(index, 1); drawSteps(); };
    fields.append(up, out); li.append(fields);
    if (step.do === 'target' && !camera(step.camera)?.targets.length) li.append(node('small', `No targets saved for ${camera(step.camera)?.name || 'this camera'} in ${state.mode_name}: aim it, then Save where it points now.`, 'step-note'));
    else if (step.do === 'target' && !drafting.steps.some(s => s.do === 'take')) li.append(node('small', 'Turns and zooms there. Add step to cut to it as well: it goes on air once it has had a moment to turn.', 'step-note'));
    return li;
  }));
  document.querySelector('#add-step').disabled = drafting.steps.length >= state.most_steps;
}
function select(options, value, change, label) {
  const s = node('select'); s.setAttribute('aria-label', label);
  for (const [v, text] of options) s.append(new Option(text, String(v)));
  s.value = String(value); s.onchange = () => change(s.value); return s;
}
function fresh(kind, was) {
  const cameraId = was.camera || state.cameras.find(c => kind === 'take' || c.point)?.id || state.cameras[0]?.id || '';
  if (kind === 'take' || kind === 'back' || kind === 'home') return { do: kind, camera: cameraId };
  if (kind === 'target') return { do: kind, camera: cameraId, target: camera(cameraId)?.targets[0]?.id || '' };
  if (kind === 'auto') return { do: kind, on: 'toggle' };
  return { do: kind, seconds: 1.5 };
}
// A new saved target from where the camera points now and its zoom, as Save as target on its card.
async function saveTarget(step) {
  const c = camera(step.camera);
  const asked = await concert.ask({ title: `New target for ${c.name}`, text: 'Where it points now and its zoom are kept under this name, for this kind of event. It also answers to the name said aloud.', fields: [{ name: 'name', label: 'Name (what it shows)' }], ok: 'Save target' });
  if (!asked) return;
  try {
    const saved = await api(`/api/cameras/${encodeURIComponent(c.id)}/gimbal-targets`, { action: 'save', name: asked.name });
    const made = saved.targets.list.find(t => !c.targets.some(x => x.id === t.id)) || saved.targets.list[saved.targets.list.length - 1];
    show(await api('/api/remote'));
    step.target = made.id; if (!document.querySelector('#key-label').value) document.querySelector('#key-label').value = capital(made.name).slice(0, 24);
    drawSteps();
  } catch (error) { concert.fail(error); }
}

// The key's steps after one that turns a camera to a target and puts it on air: a wait between them, so it cuts once it has turned.
function settled(steps) {
  const out = [];
  steps.forEach((s, n) => { out.push(s); const next = steps[n + 1]; if (s.do === 'target' && next?.do === 'take' && next.camera === s.camera) out.push({ do: 'wait', seconds: 1.5 }); });
  return out.length <= state.most_steps ? out : steps;
}
document.querySelector('#add-step').onclick = () => {
  const last = drafting.steps[drafting.steps.length - 1] || {};
  drafting.steps.push(last.do === 'target' ? { do: 'take', camera: last.camera } : fresh('take', last)); drawSteps();
};
document.querySelector('#cancel-key').onclick = () => editor.close();
document.querySelector('#save-key').onclick = async () => {
  const { key } = drafting;
  const made = { id: key.id, label: document.querySelector('#key-label').value.trim().slice(0, 24), colour: drafting.colour, steps: settled(drafting.steps) };
  if (made.steps.some(s => s.do === 'target' && !s.target)) return concert.say('Choose or save a target for the gimbal step first', 'error');
  state.layout.keys = key.id ? keys().map(k => k.id === key.id ? made : k) : [...keys(), made];
  editor.close(); await keep();
};
document.querySelector('#delete-key').onclick = async () => { state.layout.keys = keys().filter(k => k.id !== drafting.key.id); editor.close(); await keep(); };
for (const [id, by] of [['#move-earlier', -1], ['#move-later', 1]]) document.querySelector(id).onclick = async () => {
  const at = keys().findIndex(k => k.id === drafting.key.id); if (at < 0) return;
  const [moved] = keys().splice(at, 1); keys().splice(Math.max(0, Math.min(keys().length, at + by)), 0, moved);
  editor.close(); await keep();
};
