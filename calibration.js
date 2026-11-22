'use strict';
// Set up › Calibrate (calibration.html, calibrate.py): before the show, what is lined up and what is not (preshow.py);
// the address of the calibrate page for a phone, with its QR code;
// the run going on (started from that phone), followed here and stopped from here if need be; and what was measured.
(() => {
  const $ = selector => document.querySelector(selector);
  let session = null, timer = null, drawn = '';
  function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf || '' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.detail || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  }

  async function enter(found) {
    session = found; window.concert.session = session;
    $('#password').value = ''; $('#login').hidden = true; $('#calibration').hidden = false;
    window.concert.nav(session.role);
    refresh();
  }
  $('#login').onsubmit = async event => {
    event.preventDefault();
    try { await enter(await api('/api/login', { name: $('#username').value, password: $('#password').value })); }
    catch (error) { concert.fail(error); }
  };
  window.concert.resume().then(found => { if (found) enter(found); });

  async function refresh() {
    clearTimeout(timer);
    let state = null;
    try { state = await api('/api/calibrate'); window.concert.polled(true); }
    catch (error) { if (error.status === 401) { location.reload(); return; } window.concert.polled(false); }
    if (state) draw(state);
    try { preshow(await api('/api/preshow')); } catch (error) { if (error.status === 401) { location.reload(); return; } }
    timer = setTimeout(refresh, state?.run?.state === 'running' ? 1000 : 3000);
  }

  function draw(state) {
    const sig = JSON.stringify({ ...state, run: state.run && { ...state.run, yours: undefined } });
    if (sig === drawn) return; drawn = sig;
    phone(state); now(state); cameras(state);
  }

  // Before the show (preshow.py): each thing with its state, what is known of it, and the one thing to do about it.
  const STATES = { ready: ['Ready', 'ok'], todo: ['Needs doing', 'fail'], unknown: ['Cannot tell', 'warn'], idle: ['Not in use', ''] };
  let shown = '';
  function preshow(report) {
    const sig = JSON.stringify({ ...report, at: undefined });
    if (sig === shown) return; shown = sig;
    const body = $('#preshow-body'); body.replaceChildren();
    const worst = report.counts.todo ? 'todo' : report.counts.unknown ? 'unknown' : 'ready';
    const head = node('p', undefined, 'preshow-said'); head.append(node('span', STATES[worst][0], `badge ${STATES[worst][1]}`), node('b', ` ${report.said}.`));
    body.append(head);
    for (const group of report.groups) {
      body.append(node('h3', group.title));
      if (group.empty) { body.append(node('p', group.empty, 'hint')); continue; }
      const list = node('ul', undefined, 'preshow-list');
      for (const item of group.items) {
        const row = node('li', undefined, `preshow-${item.state}`);
        const [word, cls] = STATES[item.state] || STATES.unknown;
        const said = node('div'); said.append(node('b', item.label), node('span', ` ${item.detail}`));
        if (item.action) {
          const action = node('p', undefined, 'preshow-action'); action.append(node('span', 'To do: '));
          if (item.href) { const link = node('a', item.action); link.href = item.href; action.append(link); } else action.append(node('span', item.action));
          action.append(node('span', '.'));
          said.append(action);
        }
        row.append(node('span', word, `badge ${cls}`), said);
        list.append(row);
      }
      body.append(list);
    }
  }

  function phone(state) {
    const body = $('#phone-body'); body.replaceChildren();
    if (state.phone) {
      const link = node('a', state.phone); link.href = state.phone; link.target = '_blank'; link.rel = 'noopener';
      const line = node('p', 'On the camera Wi-Fi, open '); line.append(link, node('span', ' on the phone, or scan this, and log in as a setup tech or an operator.'));
      const code = document.createElement('img'); code.src = '/api/calibrate/qr.svg'; code.alt = `QR code for ${state.phone}`; code.className = 'qr'; code.width = 180; code.height = 180;
      body.append(line, code);
    } else {
      const here = node('a', 'the calibrate page'); here.href = '/calibrate';
      const line = node('p', 'The calibrate page is not offered on the camera network yet: offer the dashboard, Stage Shots or the teleprompter there (System › Logins), or set calibrate_page to true, and it is at https://calibrate.mcvsaid.local. Until then, try ');
      line.append(here, node('span', ' on this computer.'));
      body.append(line);
    }
    body.append(node('p', 'Brightness up, and Night Shift, True Tone or any eye-comfort mode off. Hold it still and facing the cameras, under the show’s lights; a stand or a mic clip helps.', 'hint'));
  }

  function now(state) {
    const body = $('#now-body'); body.replaceChildren();
    const run = state.run;
    if (!run) { body.append(node('p', 'Nothing has been calibrated from a phone since the manager started.', 'hint')); return; }
    const what = { sync: 'Sound', timing: 'Network camera timing', walk: 'Camera by camera' }[run.kind] || 'Colour';
    const when = new Date(run.started * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const head = node('p'); head.append(node('b', `${what}, `), node('span', `started ${when} by ${run.by_name}: `),
      node('span', run.state === 'running' ? run.said : run.state === 'done' ? 'done.' : `${run.state}. ${run.problem || ''}`, run.state === 'failed' ? 'bad' : ''));
    body.append(head);
    if (run.state === 'running' && run.kind !== 'sync') {      // a walk stops between cameras, or once the camera on air has been measured
      const stop = node('button', 'Stop'); stop.type = 'button'; stop.className = 'danger';
      stop.onclick = async () => { try { draw(await api('/api/calibrate/stop', { anyone: true })); } catch (error) { concert.fail(error); } };
      body.append(stop);
    }
    if (run.kind === 'colour' && run.result?.cameras) {
      const table = node('table'); const head = node('tr');
      for (const h of ['Camera', 'Phone seen', 'ΔE before → after', '']) head.append(node('th', h));
      table.append(head);
      for (const camera of Object.values(run.result.cameras)) {
        const row = node('tr');
        const reference = camera.name === run.result.reference;
        row.append(node('td', camera.name), node('td', camera.share && !camera.problem ? `${(camera.share * 100).toFixed(1)}% of the picture` : '—'),
          node('td', reference ? 'the one the others match' : camera.delta_e ? `${camera.delta_e.before.mean} → ${camera.delta_e.after.mean} (worst ${camera.delta_e.after.max})` : '—'), node('td', camera.problem || (camera.warnings || []).join('; '), camera.problem || camera.warnings?.length ? 'bad' : ''));
        table.append(row);
      }
      body.append(table);
      if (run.result.reference) body.append(node('p', `Matched to ${run.result.reference}${run.result.in_obs ? ', and put in OBS' : run.result.held ? ' (measured only: not put on the pictures; look at it on the Colour page)' : ''}. The Colour page has each camera’s LUT.`, 'hint'));
    }
    if (run.kind === 'timing' && run.result?.cameras) {
      const list = node('ul');
      for (const c of Object.values(run.result.cameras)) list.append(node('li', c.why ? `${c.name}: not timed: ${c.why}` : `${c.name}: ${c.own_ms} ms late by itself, now held by ${c.held_ms} ms (was ${c.from_ms}); ${c.pairs} flashes seen with ${c.against.join(' and ')}, ±${c.spread_ms} ms`, c.why ? 'bad' : ''));
      body.append(list);
      body.append(node('p', 'The picture matching keeps each camera there from now on, and its card on Cameras says how it was last timed.', 'hint'));
    }
    if (run.kind === 'walk' && run.result) {
      const list = node('ul'), r = run.result;
      for (const c of Object.values(r.cameras || {})) list.append(node('li', `${c.name}: ${c.set_ms != null ? `lip sync set to ${c.set_ms} ms, measured alone in the programme (${c.pairs} flashes, ±${c.spread_ms} ms)` : c.skipped ? 'skipped' : `not measured: ${c.why}`}`, c.why ? 'bad' : ''));
      if (r.timing && !r.timing.skipped) for (const c of Object.values(r.timing.cameras || {})) list.append(node('li', c.why ? `${c.name}: not timed: ${c.why}` : `${c.name}: held by ${c.held_ms} ms (${c.pairs} flashes, ±${c.spread_ms} ms${c.spread_ms > 20 ? ': loose, worth timing again' : ''})`, c.why || c.spread_ms > 20 ? 'bad' : ''));
      if (r.timing?.why) list.append(node('li', `Network cameras not timed: ${r.timing.why}`, 'bad'));
      if (r.colour && !r.colour.skipped) {
        const missed = Object.values(r.colour.cameras || {}).filter(c => c.problem);
        list.append(node('li', r.colour.why ? `Colour not matched: ${r.colour.why}` : !r.colour.reference ? 'Colour: no camera’s chart was read' : `Colour: matched to ${r.colour.reference}${r.colour.in_obs ? ', and put in OBS' : ''}${missed.length ? `; not ${missed.map(c => `${c.name} (${c.problem})`).join('; ')}` : ''}`, r.colour.why || missed.length ? 'bad' : ''));
      }
      if (r.sound) list.append(node('li', r.sound.kept ? 'Programme sound left as it was' : `Programme sound: ${r.sound.camera}${{ muted: ' alone', aligned: ', the others joined in time', mixed: ' leading the programme mix' }[r.sound.others] || ''}`));
      if (r.mix && !r.mix.skipped) list.append(node('li', r.mix.trim_ms != null ? `Programme mix: timing set to ${r.mix.trim_ms} ms` : `Programme mix not measured: ${r.mix.why}`, r.mix.why ? 'bad' : ''));
      body.append(list);
    }
    if (run.kind === 'sync' && run.result?.calibration?.cameras) {
      const list = node('ul');
      for (const [name, r] of Object.entries(run.result.calibration.cameras)) list.append(node('li', `${name}: ${r.set_ms != null ? `lip sync set to ${r.set_ms} ms (${r.pairs} flashes, ±${r.spread_ms} ms)` : `not measured: ${r.why}`}`));
      body.append(list);
    }
  }

  function cameras(state) {
    const body = $('#cameras-body'); body.replaceChildren();
    if (!state.cameras.length) { body.append(node('p', 'No camera is paired.', 'hint')); return; }
    const list = node('ul');
    for (const c of state.cameras) {
      const lips = state.lip_sync_by_camera[c.name];
      list.append(node('li', `${c.name}: ${c.online ? (c.streaming ? 'streaming' : 'connected, not streaming') : 'not connected'}${lips != null ? ` · lip sync ${lips} ms, measured` : ''}`));
    }
    body.append(list);
    if (!state.relay) body.append(node('p', 'Sound is measured from the camera relay, which is off: switch it on (System › Network) first.', 'hint bad'));
  }
})();
