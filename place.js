'use strict';
// EXPERIMENTAL, at the top of Stage layout on the manager's dashboard: each camera's button placed and sized from where
// its picture is found in the wide camera's (autoplace.py). It is the page's first step because it is the quickest way
// to a layout, and it is a first guess: the look takes about half a minute; what it found is drawn over the wide
// picture and listed, and nothing changes until the operator applies it, camera by camera, with an undo. A camera's aim
// for the room map is only offered, unticked: it is less sure than the place. With the person detector, a performer's
// button stands on the performer its camera shows; with a vision model, each performer's camera says what its performer
// seems to play, for the operator to take with a press ("guitar or bass?" when it cannot tell). Uses stage.js's state,
// helpers and act(); loaded after it, on Stage layout only.
(() => {
  const panel = document.querySelector('#place');
  if (!panel) return;
  let report = null, wide = null, busy = false, said = '', drawn = '', undo = null, polling = null, asked = false;
  const use = {}, aims = {};                       // camera id -> ticked to apply its place / its room-map aim
  const colour = cameraColour;
  const named = id => { const c = state.cameras.find(o => o.id === id); return c ? `${shows(c)} (${c.name})` : id; };

  async function ask() {
    try { report = await api('/api/stage/place'); } catch (error) { said = error.message; }
    if (report?.running && !polling) polling = setInterval(ask, 1000);
    if (!report?.running && polling) { clearInterval(polling); polling = null; }
    paint();
  }
  async function look() {
    busy = true; said = ''; undo = null; paint();
    try { report = await api('/api/stage/place', { wide }); } catch (error) { said = error.message; }
    busy = false; Object.keys(use).forEach(k => delete use[k]); Object.keys(aims).forEach(k => delete aims[k]);
    ask();
  }

  // Everything ticked, in one save: the buttons' places and widths, and any room-map aims ticked.
  async function apply() {
    const layout = {}, room = {}, before = { layout: {}, room: {} };
    for (const [id, found] of Object.entries(report.cameras || {})) {
      if (!found.layout || use[id] === false) continue;
      layout[id] = found.layout;
      const old = state.layout[id] || {};
      before.layout[id] = old.x === undefined ? { x: null, y: null, w: old.w ?? null } : { x: old.x, y: old.y, w: old.w ?? null };
      if (found.aim !== undefined && aims[id] && state.room?.map?.[id]) { room[id] = { aim: found.aim }; before.room[id] = { aim: state.room.map[id].aim }; }
    }
    if (!Object.keys(layout).length) { said = 'Nothing ticked to apply.'; paint(); return; }
    const answer = await act('/api/stage', Object.keys(room).length ? { layout, room } : { layout });
    if (answer) {
      state = answer; undo = before;
      said = `Applied to ${Object.keys(layout).length} camera${Object.keys(layout).length === 1 ? '' : 's'}${Object.keys(room).length ? `, and ${Object.keys(room).length} aim${Object.keys(room).length === 1 ? '' : 's'} on the room map` : ''}. Check the buttons below against the stage and drag any that are off, or undo.`;
    }
    drawn = ''; window.stageDraw();
  }
  async function takeBack() {
    const body = Object.keys(undo.room).length ? { layout: undo.layout, room: undo.room } : { layout: undo.layout };
    const answer = await act('/api/stage', body);
    if (answer) { state = answer; undo = null; said = 'Put back as it was.'; }
    drawn = ''; window.stageDraw();
  }

  // The wide picture with each camera found drawn on it as its outline, in its colour.
  function picture() {
    const figure = node('figure', undefined, 'seen'), img = document.createElement('img');
    img.src = `/api/stage/place/picture?at=${report.finished || report.started}`; img.alt = `The ${named(report.wide)} camera's picture, with what each camera found sees outlined on it`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    // Everyone the person detector found, faintly; a performer a camera shows, in that camera's colour.
    const box = (b, className, colourOf) => {
      const r = document.createElementNS(svg.namespaceURI, 'rect');
      r.setAttribute('x', b[0]); r.setAttribute('y', b[1]); r.setAttribute('width', b[2] - b[0]); r.setAttribute('height', b[3] - b[1]);
      r.setAttribute('class', className); if (colourOf) r.style.stroke = colourOf; svg.append(r);
    };
    (report.people || []).forEach(b => box(b, 'person'));
    for (const [id, found] of Object.entries(report.cameras || {})) {
      const c = state.cameras.find(o => o.id === id);
      if (found.performer && c) box(found.performer, 'performer', colour(c));
    }
    for (const [id, found] of Object.entries(report.cameras || {})) {
      const c = state.cameras.find(o => o.id === id);
      if (!found.found || !c) continue;
      const shape = document.createElementNS(svg.namespaceURI, 'polygon');
      shape.setAttribute('points', found.outline.map(p => p.join(',')).join(' ')); shape.style.stroke = colour(c);
      shape.classList.toggle('off', use[id] === false); svg.append(shape);
    }
    figure.append(img, svg); return figure;
  }

  // How far across the stage, in the performers' words as Stage Shots uses them (stage right is house left).
  const acrossWords = x => x < 0.2 ? 'at stage right' : x < 0.4 ? 'stage right of centre' : x <= 0.6 ? 'in the middle' : x <= 0.8 ? 'stage left of centre' : 'at stage left';

  function row(id, found) {
    const c = state.cameras.find(o => o.id === id), line = node('div', undefined, 'found');
    if (!c) return line;
    line.style.setProperty('--swatch', colour(c));
    const title = node('b', named(id));
    if (!found.found) {
      line.classList.add('missed'); line.append(title, node('span', ` Not placed: ${found.why}.`)); naming(line, id, found); return line;
    }
    if (!found.layout) { line.classList.add('missed'); line.append(title, node('span', ' Found, but where it looks does not reach the stage from where the wide camera stands on the room map.')); naming(line, id, found); return line; }
    const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = use[id] !== false;
    box.onchange = () => { use[id] = box.checked; drawn = ''; paint(); };
    const sure = `found in ${found.agreeing} of ${found.rounds} pictures`;
    const stands = found.performer ? ', standing on the performer it shows' : report.people && kindOf(c) === 'single' ? ', nobody found in its picture so placed by its middle' : '';
    label.append(box, title, node('span', ` takes in about ${Math.round(found.layout.w * 100)}% of the stage, ${acrossWords(found.layout.x)}${stands} (${sure})`));
    line.append(label);
    if (found.aim !== undefined) {
      const was = state.room.map[id]?.aim, turnLabel = node('label', undefined, 'aim'), turn = document.createElement('input'); turn.type = 'checkbox'; turn.checked = !!aims[id];
      turn.onchange = () => { aims[id] = turn.checked; };
      turnLabel.append(turn, node('span', ` Also turn it on the room map to ${found.aim}° (now ${was}°). Less sure than the place: tick it only if that looks right.`));
      line.append(turnLabel);
    }
    naming(line, id, found);
    return line;
  }

  // Who the camera's performer seems to be, with a press to make the camera show that. Never set by itself.
  function naming(line, id, found) {
    const plays = found.plays;
    if (!plays) return;
    const box = node('div', undefined, 'plays'), now = report.showing?.[id] || [], name = key => report.names?.[key] || key;
    const give = key => {
      const b = node('button', `${name(key)}`); b.setAttribute('aria-pressed', String(now.includes(key))); b.disabled = now.length === 1 && now[0] === key;
      b.onclick = async () => { await act('/api/director', { camera_focus: { [id]: [key] } }); drawn = ''; ask(); }; return b;
    };
    const nowWords = now.length ? ` It is set to show ${now.map(name).join(' + ')}.` : ' It is not set to show anyone yet.';
    if (!plays.plays) box.append(node('span', `Who is who: ${plays.why}.`));
    else if (plays.plays === 'guitar_or_bass') {
      box.append(node('span', `Plays guitar or bass? The picture cannot tell them apart${plays.leaning ? ` (leaning ${name(plays.leaning)})` : ''}.${nowWords} `), give('guitar'), give('bass'));
    } else if (now.includes(plays.plays)) box.append(node('span', `Looks like ${name(plays.plays)}, which it is set to show${now.length > 1 ? ` (with ${now.filter(k => k !== plays.plays).map(name).join(' + ')})` : ''}.`));
    else {
      box.append(node('span', `Looks like ${name(plays.plays)} (${Math.round(plays.sure * 100)}% sure).${nowWords} `));
      const b = give(plays.plays); b.textContent = `Show ${name(plays.plays)} on it`; box.append(b);
    }
    line.append(box);
  }

  function paint() {
    if (!state) return;
    const key = JSON.stringify([report, wide, busy, said, !!undo, use, state.cameras.map(c => [c.id, shows(c)]), state.room?.map]);
    if (key === drawn || panel.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    // Redrawn only when something in it changed; what was focused is focused again.
    const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    drawn = key; panel.replaceChildren();
    const heading = node('h2', 'Start from the wide shot '); heading.append(node('span', 'Experimental', 'badge warn')); panel.append(heading);
    panel.append(node('p', 'The quickest way to a layout. The manager takes every camera’s picture a few times over, finds where each one’s picture is in the wide camera’s, and places and sizes its button from that. It takes about half a minute and is a first guess to check: nothing changes until you apply it, and you can undo it or adjust it by hand below.'));
    if (report && !report.available) { panel.append(node('p', `Not available on this computer: ${report.why}. Arrange the cameras by hand below.`)); return; }
    const choose = node('label', 'Wide camera '), select = document.createElement('select');
    if (!wide || !state.cameras.some(c => c.id === wide)) wide = report?.wide || state.cameras.find(c => kindOf(c) === 'wide')?.id || state.cameras[0]?.id;
    state.cameras.forEach(c => { const o = node('option', `${shows(c)} (${c.name})`); o.value = c.id; o.selected = c.id === wide; select.append(o); });
    select.onchange = () => { wide = select.value; drawn = ''; paint(); };
    choose.append(select); panel.append(choose);
    const doing = report?.step === 'people' ? 'Finding the performers…' : report?.step === 'naming' ? 'Asking who is who…' : `Looking… picture ${report?.round} of ${report?.rounds}`;
    const go = node('button', report?.running ? doing : Object.keys(report?.cameras || {}).length ? 'Look again' : 'Place cameras from the wide shot', 'primary');
    go.dataset.k = 'look'; go.disabled = busy || !!report?.running || !wide; go.onclick = look; panel.append(go);
    if (report) { const caution = node('p', report.experimental); caution.className = 'recording-warning'; panel.append(caution); }
    if (report?.problem) { const trouble = node('p', `The look stopped: ${report.problem}`); trouble.className = 'recording-warning'; panel.append(trouble); }
    const results = Object.entries(report?.cameras || {});
    if (results.length && !report.running) {
      panel.append(picture());
      const list = node('div', undefined, 'list');
      results.sort(([, a], [, b]) => (b.found && !!b.layout) - (a.found && !!a.layout)).forEach(([id, found]) => list.append(row(id, found)));
      panel.append(list);
      if (results.some(([, f]) => f.layout)) { const put = node('button', 'Apply to the ticked cameras'); put.dataset.k = 'apply'; put.onclick = apply; panel.append(put); }
      if (report.people_why) { const why = node('small', 'Performers’ buttons go where the middle of their camera’s picture is. To put them on the performers themselves needs the person detector (Plus AI), which is not working here.'); why.title = report.people_why; panel.append(why); }
      if (results.some(([, f]) => f.plays)) { const note = node('small', 'Who is who is the vision model’s guess from each camera’s own picture, not yet tried on concert pictures. Drums, keys and singers should be the easiest; a guitar and a bass look alike, so it asks when it cannot tell. Nothing changes until you press one.'); panel.append(note); }
      else if (!report.naming) panel.append(node('small', 'With a vision model set up for choosing shots (Director page), it also suggests who each performer’s camera shows: drums, keys, guitar or bass and so on.'));
      if (!state.room?.map?.[report.wide]) panel.append(node('small', 'The wide camera is not on the room map, so its picture is taken to span the stage. Put it on the map for places measured from where it really stands, and to be offered aims.'));
    }
    if (undo) { const back = node('button', 'Undo'); back.dataset.k = 'undo'; back.onclick = takeBack; panel.append(back); }
    if (said) { const line = node('p', said); line.setAttribute('role', 'status'); panel.append(line); }
    if (focused) panel.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus();
  }

  // Drawn with the page (stage.js's draw); what the last look found is asked for once, when the page first has its cameras.
  window.placeDraw = () => { if (!asked) { asked = true; ask(); } paint(); };
})();
