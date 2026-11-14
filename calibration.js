'use strict';
// Set up › Calibrate (calibration.html, calibrate.py): the address of the calibrate page for a phone, with its QR code;
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
    timer = setTimeout(refresh, state?.run?.state === 'running' ? 1000 : 3000);
  }

  function draw(state) {
    const sig = JSON.stringify({ ...state, run: state.run && { ...state.run, yours: undefined } });
    if (sig === drawn) return; drawn = sig;
    phone(state); now(state); cameras(state);
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
    const what = run.kind === 'sync' ? 'Sound' : 'Colour';
    const when = new Date(run.started * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const head = node('p'); head.append(node('b', `${what}, `), node('span', `started ${when} by ${run.by_name}: `),
      node('span', run.state === 'running' ? run.said : run.state === 'done' ? 'done.' : `${run.state}. ${run.problem || ''}`, run.state === 'failed' ? 'bad' : ''));
    body.append(head);
    if (run.state === 'running' && run.kind === 'colour') {
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
          node('td', reference ? 'the one the others match' : camera.delta_e ? `${camera.delta_e.before.mean} → ${camera.delta_e.after.mean} (worst ${camera.delta_e.after.max})` : '—'), node('td', camera.problem || '', camera.problem ? 'bad' : ''));
        table.append(row);
      }
      body.append(table);
      if (run.result.reference) body.append(node('p', `Matched to ${run.result.reference}${run.result.in_obs ? ', and put in OBS' : ''}. The Colour page has each camera’s LUT.`, 'hint'));
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
