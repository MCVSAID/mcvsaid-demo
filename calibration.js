'use strict';
// Set up › Calibrate (calibration.html, calibrate.py): before the show, what is lined up and what is not (preshow.py);
// the address of the calibrate page for a phone, with its QR code;
// the run going on (started from that phone), followed here and stopped from here if need be; and what was measured.
(() => {
  const $ = selector => document.querySelector(selector);
  let session = null, timer = null, drawn = '';
  function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  // How far sound is from its picture, in words; and a moment, with its day when that is not today (a timing kept may be days old).
  const late = ms => `${Math.abs(ms)} ms ${ms >= 0 ? 'late' : 'early'}`;
  const moment = at => { const d = new Date(at * 1000), clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? `at ${clock}` : `on ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at ${clock}`; };
  // The programme mix's own timing as the check's last step left it (calibrate.Calibrate.mix_timing): set with the flashes,
  // or by the stage beacon set, checked (left as it was, being as good as right), or read and not set over what is kept.
  function mixTimed(m) {
    if (m.by !== 'beacon') return m.trim_ms != null ? `Programme mix: timing set to ${m.trim_ms} ms` : `Programme mix not measured: ${m.why}`;
    if (m.state === 'set') return `Programme mix: timing set to ${m.trim_ms} ms from the stage beacon (it was heard ${late(m.off_ms)} against the leading camera’s picture)`;
    if (m.state === 'checked') return `Programme mix: timing left at ${m.trim_ms} ms, checked from the stage beacon (heard ${late(m.off_ms)}, within what that reading can tell)`;
    if (m.state === 'left') return `Programme mix: the stage beacon heard it ${late(m.off_ms)} and set nothing (it is still ${m.trim_ms} ms): ${m.why}`;
    return `Programme mix not timed from the stage beacon: ${m.why}`;
  }
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
    let lit = null;
    try { lit = await api('/api/beacon'); beacon(lit); } catch (error) { if (error.status === 401) { location.reload(); return; } }
    timer = setTimeout(refresh, state?.run?.state === 'running' || lit?.running ? 1000 : 3000);
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
    // A stage beacon standing ready (calibrate.Calibrate.standing): what the check on the phone offers it for, and what is still a person's.
    if (report.beacon) {
      const lit = report.beacon, timing = lit.timing ? ' and time the network cameras by its light' : '';
      // With the programme mix: whether the check's last step asks it for the mix's own timing (standing's 'mix'), and why not.
      const mixed = !lit.mix ? '' : !lit.mix.cannot ? ' With the programme mix, the check offers it once more as its last step, for the mix’s own timing: the camera that leads the mix is put on air and OBS records the programme for about half a minute, and nobody goes back on stage.'
        : lit.mix.cannot === lit.cannot ? ' Nor is it asked for the programme mix’s own timing until then: that is measured with the flashes at the camera that leads the mix.'
        : ` It is not asked for the programme mix’s own timing, which is measured with the flashes at the camera that leads the mix: ${lit.mix.cannot}.`;
      body.append(node('p', (lit.cannot ? `The stage beacon (${lit.name}) is ready${lit.timing ? ', and the check on the phone offers it for the network cameras’ timing' : ''}, but it sets no lip sync yet: ${lit.cannot}. Until then each camera is walked to.`
        : `The stage beacon (${lit.name}) is ready: the check on the phone offers it first. From where it stands it can set the lip sync of each camera that is due${timing}, and the phone is walked only to a camera it could not see or hear, or was not sure of to within 25 ms.`)
        + mixed + ' Still a person’s: the beacon’s own part, measured once against a camera measured with the flashes (Stage beacon, below); the cameras’ colours; and where the programme’s sound comes from.', 'hint'));
    }
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
        if (item.measure) {
          // Its lip sync from the room's sound, now (lipsync.py): its picture on air and its microphone alone meanwhile.
          const words = 'Measure it now from the room’s sound';
          const button = node('button', words); button.type = 'button';
          button.onclick = async () => {
            button.disabled = true; button.textContent = 'Measuring: its picture is on air for a quarter of a minute…';
            try {
              const found = await api('/api/sync/measure', { camera: item.measure });
              shown = ''; preshow(found.preshow);
              if (found.measured.why) window.concert.fail(new Error(`${found.measured.name} was not measured: ${found.measured.why}`));
            } catch (error) { window.concert.fail(error); button.disabled = false; button.textContent = words; }
          };
          said.append(button);
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
      if (r.beacon && !r.beacon.skipped) {
        if (r.beacon.why) list.append(node('li', `Stage beacon: did not measure: ${r.beacon.why}`, 'bad'));
        else {
          list.append(node('li', `Stage beacon (${r.beacon.beacon}) first: ${r.beacon.settled.length ? `settled ${r.beacon.settled.join(', ')}, not walked to` : 'settled no camera'}`));
          for (const [name, why] of Object.entries(r.beacon.left)) list.append(node('li', `${name}: left to walk to by the beacon: ${why}`));
          if (r.beacon.timed?.length) list.append(node('li', `Stage beacon: timed ${r.beacon.timed.join(', ')} against the phones by its light`));
          for (const [name, why] of Object.entries(r.beacon.untimed || {})) list.append(node('li', `${name}: not timed by the beacon, left to the flashes: ${why}`, 'bad'));
        }
      }
      for (const c of Object.values(r.cameras || {})) list.append(node('li', `${c.name}: ${c.set_ms != null ? `lip sync set to ${c.set_ms} ms, measured alone in the programme (${c.pairs} flashes, ±${c.spread_ms} ms)` : c.skipped ? 'skipped' : `not measured: ${c.why}`}`, c.why ? 'bad' : ''));
      if (r.timing && !r.timing.skipped) for (const c of Object.values(r.timing.cameras || {})) list.append(node('li', c.why ? `${c.name}: not timed: ${c.why}` : `${c.name}: held by ${c.held_ms} ms (${c.pairs} flashes, ±${c.spread_ms} ms${c.spread_ms > 20 ? ': loose, worth timing again' : ''})`, c.why || c.spread_ms > 20 ? 'bad' : ''));
      if (r.timing?.why) list.append(node('li', `Network cameras not timed: ${r.timing.why}`, 'bad'));
      if (r.colour && !r.colour.skipped) {
        const missed = Object.values(r.colour.cameras || {}).filter(c => c.problem);
        list.append(node('li', r.colour.why ? `Colour not matched: ${r.colour.why}` : !r.colour.reference ? 'Colour: no camera’s chart was read' : `Colour: matched to ${r.colour.reference}${r.colour.in_obs ? ', and put in OBS' : ''}${missed.length ? `; not ${missed.map(c => `${c.name} (${c.problem})`).join('; ')}` : ''}`, r.colour.why || missed.length ? 'bad' : ''));
      }
      if (r.sound) list.append(node('li', r.sound.kept ? 'Programme sound left as it was' : `Programme sound: ${r.sound.camera}${{ muted: ' alone', aligned: ', the others joined in time', mixed: ' leading the programme mix' }[r.sound.others] || ''}`));
      if (r.mix && !r.mix.skipped) list.append(node('li', mixTimed(r.mix), r.mix.why ? 'bad' : ''));
      body.append(list);
    }
    if (run.kind === 'sync' && run.result?.calibration?.cameras) {
      const list = node('ul');
      for (const [name, r] of Object.entries(run.result.calibration.cameras)) list.append(node('li', `${name}: ${r.set_ms != null ? `lip sync set to ${r.set_ms} ms (${r.pairs} flashes, ±${r.spread_ms} ms)` : `not measured: ${r.why}`}`));
      body.append(list);
    }
  }

  // The stage beacon (stagebeacon.py): the beacon phones, measuring from one now, what it found of each camera, and
  // (the administrator's) whether it puts a camera right and measures by itself.
  let beaconDrawn = '', beaconNote = '', beaconPick = '', beaconAgainst = '';
  const switched = answer => { beaconNote = `${answer.switched.name} ${answer.switched.on ? 'is a stage beacon now' : 'is a camera again'}: ${answer.switched.screen}.`; };
  const FOUND = { marked: 'its mark taken (lip sync as it is now)', checked: 'unchanged', moved: 'moved', corrected: 'moved, and its lip sync put right', beacon: 'moved with every other camera: the beacon, not the camera' };
  function beacon(state) {
    const sig = JSON.stringify(state);
    if (sig === beaconDrawn) return; beaconDrawn = sig;
    const body = $('#beacon-body'); body.replaceChildren();
    const admin = session?.role === 'admin';
    // Managing the beacon phones (StageBeacon.set_mode/test/stop): the administrator's, but stopping a run.
    const act = (button, path, body, done) => async () => {
      button.disabled = true;
      try { const answer = await api(path, body); if (done) done(answer); beaconDrawn = ''; beacon(answer); }
      catch (error) { button.disabled = false; concert.fail(error); }
    };
    const button = (words, title) => { const b = node('button', words); b.type = 'button'; if (title) b.title = title; return b; };
    if (!state.beacons.length) body.append(node('p', `No phone is a stage beacon. Make a spare phone paired like a camera one below${admin ? '' : ' (the administrator’s)'}, or choose Stage beacon in the camera app on it; it then shows here.`, 'hint'));
    else {
      const list = node('ul', undefined, 'beacon-phones');
      for (const b of state.beacons) {
        const item = node('li', undefined, b.online && b.open ? '' : 'bad');
        const bits = [!b.online ? 'not connected' : b.running ? 'running' : b.open ? 'ready, its beacon screen up' : 'connected, its beacon screen not open'];
        if (b.battery_percent != null) bits.push(`battery ${b.battery_percent}%${b.charging ? ', charging' : ', not charging'}`);
        if (b.temperature_c != null) bits.push(`${b.temperature_c} °C`);
        if (b.route) bits.push(b.route === 'speaker' ? 'sound to its own speaker' : `sound would go to ${b.route}: disconnect it, the beacon refuses`);
        if (b.app_version) bits.push(`app ${b.app_version}`);
        // Its own part (beacon.own_from): what it puts between its screen and its speaker, taken off every reading.
        const how = (state.own_measured || {})[b.id];
        bits.push(b.own_known ? `its own part ${b.own_ms} ms${how ? ` (measured ${new Date(how.at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${how.how})` : ''}` : 'its own part not measured yet');
        item.append(node('b', b.name), node('span', `: ${bits.join(' · ')}`));
        if (admin) {
          const row = node('span', undefined, 'beacon-actions');
          const test = button(`Test (${state.test_seconds || 8} s)`, 'Its light code and hiss for a few seconds, measuring nothing: look and listen on stage');
          test.disabled = state.running || !b.online;
          test.onclick = act(test, '/api/beacon/test', { camera_id: b.id });
          const back = button('Make it a camera again', b.switchable ? '' : 'Its camera app is too old to be switched from here: hold the beacon screen for three seconds on the phone');
          back.disabled = !b.online || !b.switchable;
          back.onclick = act(back, '/api/beacon/mode', { camera_id: b.id, on: false }, switched);
          row.append(' ', test, ' ', back);
          item.append(row);
        }
        list.append(item);
      }
      body.append(list);
    }
    if (beaconNote) body.append(node('p', beaconNote));
    if (state.running) {
      const stop = button('Stop the beacon'); stop.onclick = act(stop, '/api/beacon/stop', {}); body.append(stop, ' ');
    }
    const tested = state.tested;
    if (tested) {
      const when = new Date(tested.at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const said = tested.said ? ` (${tested.said.frames} refreshes, ${tested.said.late_frames} late; sound began after ${tested.said.start_delay_ms} ms)` : '';
      const words = tested.state === 'running' ? 'testing: look at its screen and listen near it' : tested.state === 'done' ? `it ran as it should${said}` : tested.state === 'stopped' ? 'stopped' : `it did not run as it should: ${tested.why}`;
      body.append(node('p', `${tested.beacon} tested at ${when}, ${tested.by}: ${words}.`, tested.state === 'failed' ? 'bad' : ''));
    }
    const go = node('button', !state.running ? 'Measure every camera now' : state.tested?.state === 'running' ? 'Testing…' : 'Measuring…'); go.type = 'button'; go.disabled = state.running || !state.beacons.some(b => b.online && b.open);
    go.onclick = async () => { try { beacon(await api('/api/beacon/measure', {})); } catch (error) { concert.fail(error); } };
    // Lip sync from nothing (beacon.from_reading): every phone's set from its reading, then marked.
    // With the programme mix on air and able to be timed (StageBeacon.mix_facts), that run times the mix too, which is
    // no longer nothing on air and nothing recorded: said before it is begun, and why not when it will not.
    const mix = state.mix?.chosen ? state.mix : null, leads = mix?.leader || 'the camera that leads the mix';
    const records = `${leads} is put on air and OBS records the programme for about half a minute, with ${leads}’s microphone alone in the mix and every other sound in OBS muted meanwhile; all of it is put back after`;
    const set = node('button', 'Set lip sync from the beacon'); set.type = 'button'; set.disabled = go.disabled;
    set.onclick = async () => {
      const mixToo = !mix ? '' : mix.cannot ? ` The programme mix’s own timing is not measured with it: ${mix.cannot}.` : ` Programme sound is the programme mix, so the mix’s own timing is measured in the same run, and for that ${records}. Before the show only.`;
      if (!await concert.sure('Measure every camera from the beacon and set each phone’s lip sync from what it finds? Each is set from its reading less its distance from the beacon (the room map, Stage layout) and the beacon’s own part, with OBS’s part as last measured.' + mixToo, { ok: 'Set lip sync' })) return;
      try { beacon(await api('/api/beacon/measure', { purpose: 'set' })); } catch (error) { concert.fail(error); }
    };
    body.append(go, ' ', set);
    // The programme mix's own timing alone (a 'mix' run): what it is on now and what that rests on (Manager.mix_kept), and
    // the run that sets it, which no camera's lip sync, mark or timing is touched by. Disabled with the reason said.
    if (mix) {
      const kept = mix.kept;
      const rests = !kept ? `its usual ${mix.trim_ms} ms, not measured here`
        : `${mix.trim_ms} ms, ${kept.by === 'beacon' ? 'set from the stage beacon' : 'measured with the flashes'}${kept.at ? ` ${moment(kept.at)}` : ''}${kept.by === 'beacon' && kept.sure === false ? `, to within about ${kept.unsure_ms} ms only` : ''}`
          + `${kept.checked_at > (kept.at || 0) ? `, and checked by the beacon ${moment(kept.checked_at)}` : ''}${kept.stale?.length ? `; no longer known to hold: ${kept.stale.join('; ')}` : ''}`;
      const time = button('Set the mix’s timing from the beacon', mix.cannot ? `Not just now: ${mix.cannot}` : `${records}. No camera’s lip sync is touched`);
      time.disabled = go.disabled || !!mix.cannot;
      time.onclick = async () => {
        if (!await concert.sure(`Time the programme mix from the beacon? ${records}. Its timing is set from how far the beacon’s hiss is from its light in that recording, less the beacon’s own part and its distance from ${leads} (the room map, Stage layout); a timing measured better than this run can is left as it is. Before the show only.`, { ok: 'Set the mix’s timing' })) return;
        try { beacon(await api('/api/beacon/measure', { purpose: 'mix' })); } catch (error) { concert.fail(error); }
      };
      const line = node('p'); line.append(time, node('span', ` The programme mix’s timing: ${rests}.${mix.cannot ? ` It cannot be set from the beacon just now: ${mix.cannot}.` : ''}`, !kept || kept.stale?.length || (kept.by === 'beacon' && kept.sure === false) ? 'hint bad' : 'hint'));
      body.append(line);
    }
    // A run for the network cameras' timing alone (beaconsync.py): the light only, its hiss too soft to hear.
    if (state.network_cameras?.length) {
      const time = button('Time the network cameras now', `${state.network_cameras.join(', ')}: timed against the phones by the beacon’s light as OBS shows it from each. Next to no hiss, and no camera’s lip sync is measured`);
      time.disabled = go.disabled; time.onclick = act(time, '/api/beacon/measure', { purpose: 'network' }); body.append(' ', time);
    }
    // The beacon's own part: held up to a camera whose flash reading is known, or where it stands, by the room map.
    const own = node('p'), against = document.createElement('select');
    for (const [value, words] of [['', 'every camera with a flash reading, the beacon where the room map has it'], ...(state.flashed || []).map(c => [c.id, `held up to ${c.name}, about ${state.held_m} m in front of it`])]) {
      const o = document.createElement('option'); o.value = value; o.textContent = words; against.append(o);
    }
    against.value = beaconAgainst; against.onchange = () => { beaconAgainst = against.value; };
    const measureOwn = node('button', 'Measure the beacon’s own part'); measureOwn.type = 'button'; measureOwn.disabled = go.disabled || !(state.flashed || []).length;
    measureOwn.onclick = async () => { try { beacon(await api('/api/beacon/measure', { purpose: 'own', ...(against.value ? { camera: against.value } : {}) })); } catch (error) { concert.fail(error); } };
    own.append(measureOwn, node('span', ' against '), against);
    body.append(own);
    if (!(state.flashed || []).length) body.append(node('p', 'To measure the beacon’s own part, Calibrate sync one camera with the flash page first: the beacon is measured against what that reading found.', 'hint'));
    const last = state.last;
    if (last) {
      const when = new Date(last.at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const [doing, did, not] = last.light_only ? ['Timing the network cameras', 'Timed the network cameras', 'not timed'] : last.purpose === 'mix' ? ['Timing the programme mix', 'Timed the programme mix', 'not timed'] : ['Measuring', 'Measured', 'not measured'];
      // A run that times the mix, its own or a lip sync run's by the way, has a camera on air and OBS recording meanwhile (last.on_air).
      const onAir = last.on_air || (last.purpose === 'mix' ? 'the camera that leads the mix' : null);
      const showing = onAir ? `: OBS is recording the programme, ${onAir} on air, while the beacon shows its code (about 40 seconds)` : ': the beacon is showing its code (about 20 seconds)';
      // Stopped (Stop the beacon): said as that, not as a run that measured.
      body.append(node('p', last.state === 'stopped' ? `${doing} at ${when}, ${last.by}, was stopped before it was done.`
        : `${last.state === 'running' ? doing : did} at ${when}, ${last.by}${last.state === 'failed' ? `: ${not}: ${last.why}` : last.state === 'running' ? showing : ''}.`, last.state === 'failed' ? 'bad' : ''));
      // What the run muted in OBS for its recording and could not unmute again, OBS having gone away (Manager.mutes_owed_back).
      if (last.left_muted?.length) body.append(node('p', `${last.left_muted.join(', ')} could not be unmuted in OBS again after this run (OBS did not answer). The manager unmutes ${last.left_muted.length > 1 ? 'them' : 'it'} once OBS answers again: look at OBS’s mixer before the show.`, 'bad'));
      const list = node('ul');
      for (const [name, c] of Object.entries(last.cameras || {})) {
        const words = c.soundless ? 'sends no sound in its stream, so it has no lip sync to measure (its picture is timed against the phones by the beacon’s light)' : c.why ? `not measured: ${c.why}` : `${c.own_ms} ms (sound after picture in its own stream, the distance included; seen ${c.likeness}, heard ${c.clear_db} dB clear)${c.state ? `: ${FOUND[c.state] || c.state}` : last.purpose === 'own' ? ', the beacon’s own part included' : ''}${c.delta_ms != null && c.state !== 'checked' ? ` by ${c.delta_ms} ms` : c.state === 'checked' ? ` (${c.delta_ms >= 0 ? '+' : ''}${c.delta_ms} ms)` : ''}${c.set_ms != null ? `, to ${c.set_ms} ms` : ''}${c.state === 'moved' && c.waits ? (c.again ? ', as the reading before found' : ': one reading alone moves nothing, and its lip sync is put right if the next finds the same') : c.state === 'moved' && c.again ? ', as the reading before found' : ''}${c.state === 'moved' && c.cannot ? ' (the beacon cannot put this one right by itself: measure it again)' : ''}`;
        const made = c.from_beacon, item = node('li', `${name}: ${words}`, (c.why && !c.soundless) || c.state === 'moved' || c.state === 'beacon' ? 'bad' : '');
        if (made) item.append(node('div', made.why ? `Lip sync not set from it: ${made.why}.` : `Lip sync set from it to ${made.set_ms} ms (to within about ${made.unsure_ms} ms), resting on ${made.rests_on.join('; ')}.${made.sure ? '' : ' Measure it through OBS when you can (Pre-show calibration check).'}`, 'hint'));
        list.append(item);
      }
      if (list.children.length) body.append(list);
      // The programme mix's own timing, as this run read it in OBS's recording of the programme (StageBeacon.mixed): set,
      // checked (as good as right: left), left (not set over a better measurement), or not read, with why.
      const mixed = last.mix;
      if (mixed && last.state !== 'running') {
        const heard = mixed.off_ms == null ? '' : `heard ${late(mixed.off_ms)} against ${mixed.leader}’s picture in OBS’s recording of the programme${mixed.clear_db != null ? ` (its hiss ${mixed.clear_db} dB clear)` : ''}`;
        const rests = !mixed.rests_on ? '' : ` ${mixed.unsure_ms ? `To within about ${mixed.unsure_ms} ms, resting` : 'Resting'} on ${mixed.rests_on.join('; ')}.`;
        const words = mixed.state === 'set' ? `The programme mix: ${heard}. Its timing is set to ${mixed.trim_ms} ms, from ${mixed.from_ms}.${rests}`
          : mixed.state === 'checked' ? `The programme mix: ${heard}, which is within what this reading can tell. Its timing is left at ${mixed.trim_ms} ms, and counts as checked.${rests}`
          : mixed.off_ms != null ? `The programme mix: ${heard}. Nothing was changed (its timing is still ${mixed.trim_ms} ms): ${mixed.why}.${rests}`
          : `The programme mix’s timing was not measured: ${mixed.why}${mixed.clear_db != null ? ` (its hiss ${mixed.clear_db} dB clear)` : ''}.`;
        body.append(node('p', words, mixed.state === 'set' || mixed.state === 'checked' ? '' : 'bad'));
      }
      if (last.own) body.append(node('p', last.own.why ? `The beacon’s own part was not measured: ${last.own.why}.` : `The beacon’s own part: ${last.own.own_ms} ms (${last.own.how}${Object.keys(last.own.cameras).length > 1 ? `, the cameras within ${last.own.spread_ms} ms of each other` : ''}).`, last.own.why ? 'bad' : ''));
      // The network cameras, timed against the phones by the same light (sync.SyncKeeper.time_by_beacon).
      const net = last.network;
      if (net?.why) body.append(node('p', `The network cameras were not timed: ${net.why}.`, 'bad'));
      else if (net) {
        const timed = node('ul');
        for (const [name, c] of Object.entries(net.cameras || {})) {
          const words = c.why ? `not timed: ${c.why}${c.likeness != null ? ` (seen ${c.likeness})` : ''}`
            : `${Math.abs(c.own_ms)} ms ${c.own_ms < 0 ? 'early' : 'late'} by itself against ${c.against.join(', ')} (seen ${c.likeness}): ${c.held_ms === c.from_ms ? `left as it is, held by ${c.held_ms} ms` : `held by ${c.held_ms} ms now, from ${c.from_ms} ms`}`;
          timed.append(node('li', `${name}: ${words}`, c.why ? 'bad' : ''));
        }
        body.append(node('p', `Network cameras, timed by the beacon’s light as OBS shows it (phones watched: ${(net.phones || []).join(', ') || 'none'}):`), timed);
      }
    }
    for (const [key, words] of [['corrects', 'Put a camera’s lip sync right by itself when its own lateness has moved'], ['auto', 'Measure by itself before the show (its hiss is then heard in the room every quarter of an hour, and after a stream restarts, until OBS records or streams)'],
      ['network', 'Time the network cameras against the phones by its light, with every run']]) {
      const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = state[key]; box.disabled = !admin;
      box.onchange = async () => { try { beacon(await api('/api/beacon/settings', { [key]: box.checked })); } catch (error) { box.checked = !box.checked; concert.fail(error); } };
      label.append(box, node('span', ` ${words}`)); body.append(label);
    }
    // How loud its hiss is (beacon.LEVELS): a gentle "shhh", never a beep; louder only for a camera far off or a loud room.
    const LOUDNESS = { '-42': 'softest', '-36': 'soft (as it comes)', '-30': 'clearer, for a camera far off or a loud room', '-24': 'loudest' };
    const loud = node('label'), pick = document.createElement('select'); pick.disabled = !admin;
    for (const level of state.levels || []) { const o = document.createElement('option'); o.value = String(level); o.textContent = `${LOUDNESS[String(level)] || ''} (${level} dB)`; pick.append(o); }
    if (state.level_db != null) pick.value = String(state.level_db);
    const was = pick.value;
    pick.onchange = async () => { try { beacon(await api('/api/beacon/settings', { level_db: Number(pick.value) })); } catch (error) { pick.value = was; concert.fail(error); } };
    if (state.levels) { loud.append(node('span', 'Its hiss: '), pick); const line = node('p'); line.append(loud); body.append(line); }
    // How often a run is made by itself for the network cameras' timing alone (stagebeacon.NETWORK_MINUTES), in a show too.
    if (state.network_choices) {
      const often = node('label'), every = document.createElement('select'); every.disabled = !admin || !state.network;
      for (const minutes of state.network_choices) { const o = document.createElement('option'); o.value = String(minutes); o.textContent = minutes ? `every ${minutes} minutes` : 'never'; every.append(o); }
      every.value = String(state.network_minutes);
      const before = every.value;
      every.onchange = async () => { try { beacon(await api('/api/beacon/settings', { network_minutes: Number(every.value) })); } catch (error) { every.value = before; concert.fail(error); } };
      often.append(node('span', 'Time the network cameras by itself, during a show too (its light only, next to no hiss): '), every); const line = node('p'); line.append(often); body.append(line);
    }
    if (admin && state.candidates?.length) {
      const make = node('label'), choose = document.createElement('select');
      for (const c of state.candidates) {
        const o = document.createElement('option'); o.value = c.id;
        o.textContent = `${c.name}${!c.online ? ' (not connected)' : c.armed ? ' (armed as a camera: disarm it first)' : !c.switchable ? ` (app ${c.app_version || 'too old'}: choose Stage beacon on the phone)` : ''}`;
        o.disabled = !c.online || c.armed || !c.switchable; choose.append(o);
      }
      const first = state.candidates.find(c => c.online && !c.armed && c.switchable && (c.id === beaconPick || !beaconPick)) || state.candidates.find(c => c.online && !c.armed && c.switchable);
      if (first) choose.value = first.id;
      choose.onchange = () => { beaconPick = choose.value; };
      const go = button('Make it a stage beacon', 'It stops being a camera of the show: it shows the beacon screen and refuses to be armed until made a camera again');
      go.disabled = !first;
      go.onclick = act(go, '/api/beacon/mode', { get camera_id() { return choose.value; }, on: true }, switched);
      make.append(node('span', 'Make a paired phone a stage beacon: '), choose); const line = node('p'); line.append(make, ' ', go); body.append(line);
    }
    if (!admin) body.append(node('p', 'Those, and managing the beacon phones, are the administrator’s.', 'hint'));
    if (!state.relay) body.append(node('p', 'The cameras’ own streams are read from the camera relay, which is off: switch it on (System › Network) first. The network cameras’ timing is read from OBS and needs no relay.', 'hint bad'));
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
