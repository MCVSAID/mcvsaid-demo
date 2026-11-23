'use strict';
// Programme sound from (programmesound.py), on the Sound page: which camera's microphone the programme carries, and
// whether the other cameras' join it, each only while it is lined up with the chosen one.
(() => {
  const panel = document.querySelector('#programme-sound');
  if (!panel) return;
  let state = null, drawnFrom = '', said = '', busy = false;

  async function send(body, where = '/api/programme-sound', saying = 'Saving…', done = 'Saved.') {
    busy = true; said = saying; paint(true);
    try { state = await api(where, { method: 'POST', body: JSON.stringify(body) }); said = done; }
    catch (error) { said = error.message; }
    finally { busy = false; paint(true); }
  }

  function paint(all) {
    if (!state) return;
    const now = JSON.stringify([state, said, busy]);
    if (!all && (now === drawnFrom || (panel.contains(document.activeElement) && ['SELECT', 'INPUT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'checkbox'))) return;
    drawnFrom = now;
    const parts = [node('h2', 'Programme sound'),
      node('p', 'Every streaming camera’s microphone is in the programme. Mixed together, a camera whose picture (and so its sound) is a little off the others is heard as an echo. Choose the camera whose microphone leads: it is always heard, and the others either join it, each only while it is lined up with it, or stay out.')];
    const row = node('p', ''); row.className = 'recipe-load-row';
    const pick = document.createElement('select'); pick.setAttribute('aria-label', 'Programme sound from'); pick.disabled = busy;
    for (const [value, text] of [['', 'every camera, as they are'], ...state.cameras.map(c => [c.id, c.soundless ? `${c.name} (sends no sound)` : c.name])]) {
      const o = node('option', text); o.value = value; o.selected = (state.camera || '') === value; pick.append(o);
    }
    const others = document.createElement('select'); others.setAttribute('aria-label', 'The other cameras'); others.disabled = busy || !state.camera;
    // Stay out first: phone microphones in different places, mixed, sound hollow and phasey however closely they are lined
    // up (2026-10-24), so one microphone is the coherent sound; joining is for when the others add something wanted.
    for (const [value, text] of [['muted', 'stay out: one coherent sound (recommended)'], ['auto', 'follow the speaker: only the microphone that hears them best (automixer)'],
      ['aligned', 'join it, each while lined up with it (can sound hollow)'],
      ['mixed', 'join it, each kept in time with it and mixed as one sound (programme mix: new, try it before a show)']]) {
      const o = node('option', text); o.value = value; o.selected = state.others === value; others.append(o);
    }
    pick.onchange = () => send({ camera: pick.value || null, others: state.camera ? others.value : 'muted' });
    others.onchange = () => send({ camera: state.camera, others: others.value });
    row.append(node('span', 'Programme sound from '), pick, node('span', '; the other cameras '), others);
    parts.push(row);
    // A network camera over SRT whose stream sends no sound (read from the relay's copy of it, not assumed): its source in
    // OBS is silent, so where its sound is heard is said. Amber when it is the camera Programme sound comes from: then
    // nothing is heard from that camera. It can still be chosen. In the mix, its line in the list below says it.
    const lead = state.cameras.find(c => c.id === state.camera);
    for (const c of state.cameras.filter(c => c.soundless)) {
      if (c.id === state.camera) {
        const line = node('p', `${c.name} sends no sound in its stream over SRT, so its source in OBS is silent and nothing is heard from the camera Programme sound comes from. Choose a phone camera instead: with the others “mixed as one sound”, ${c.name}’s sound joins the mix, read from the camera itself. Or take its picture over NDI, which carries its sound.`);
        line.className = 'recording-warning'; parts.push(line);
      } else if (!(state.camera && state.others === 'mixed')) {
        parts.push(node('p', `${c.name} sends no sound in its stream over SRT: its source in OBS is silent. Its sound is heard only in the programme mix (a phone camera chosen, the others “mixed as one sound”), which reads it from the camera itself; or with its picture taken over NDI.`));
      }
    }
    // Levelling (level.py): each source heard in the programme turned up, or down, by its fader in OBS.
    if (state.level) {
      const line = node('p', ''); line.className = 'recipe-load-row';
      const on = document.createElement('input'); on.type = 'checkbox'; on.checked = state.level.on; on.disabled = busy; on.id = 'sound-level-on';
      on.onchange = () => send({ level: { on: on.checked } });
      const label = document.createElement('label'); label.htmlFor = on.id; label.textContent = ' Level the programme’s sound by itself';
      line.append(on, label, node('small', ' Turns each camera heard in the programme up (or down) in OBS until its loud moments peak near '
        + `${state.level.target_db} dB, slowly, and not while nothing is heard; a limiter in OBS catches the peaks. Switched off, every fader it moved is put back.`));
      parts.push(line);
      const heard = Object.entries(state.level.sources || {});
      if (state.level.on && (heard.length || state.level.problem)) {
        parts.push(node('small', state.level.problem ? `Levelling is waiting for OBS: ${state.level.problem}.`
          : heard.map(([name, s]) => `${name}: ${s.gain_db == null ? '' : `${s.gain_db > 0 ? '+' : ''}${s.gain_db} dB, `}${s.level_db == null ? '' : `heard at ${s.level_db} dB, `}${s.state}`).join(' · ')));
      }
    }
    if (state.camera && state.others === 'auto') {
      // The automixer: which microphone is open, and how clearly each hears someone now.
      const a = state.automix;
      const line = node('p', a ? `Open now: ${a.open || '—'}${a.heard && a.heard !== a.open ? ` (changing to ${a.heard} as the programme gets there)` : ''}. ` : 'The automixer is starting (it needs the camera relay on).');
      if (a) line.append(node('small', Object.entries(a.clarity_db).map(([name, db]) => `${name} ${db == null ? '—' : `${db > 0 ? '+' : ''}${db} dB`}`).join(' · ')));
      parts.push(line, node('small', `Only one microphone is open at a time: the one hearing whoever is talking most clearly, over its own background. ${state.cameras.find(c => c.id === state.camera)?.name || 'The chosen camera'}'s is open while nobody is heard. It changes with a 0.3 s crossfade, as the programme reaches the moment.`));
    }
    if (state.camera && state.others === 'mixed') {
      // The programme mix (mixer.py): every microphone kept in time with the chosen camera's, mixed here, one source in OBS.
      const m = state.mix || {};
      const line = node('p', m.in_programme ? `The mix is in the programme (OBS source “${m.source}”, held ${m.offset_ms} ms by OBS, to be heard as ${lead?.name || 'the leading camera'}’s picture is shown); the cameras’ own microphones are muted.`
        : `The mix is not in the programme${m.why ? `: ${m.why}` : ''}.${lead?.soundless ? '' : ` ${lead?.name || 'The chosen camera'}’s own microphone is heard meanwhile.`}`);
      if (!m.in_programme) line.className = 'recording-warning';
      const list = node('ul', '');
      for (const c of state.cameras) {
        const e = (m.cameras || {})[c.name], db = (m.db || {})[c.id];
        // One that sends no sound in its stream is heard here or nowhere: said whether the mix reads it from the camera itself.
        // With nothing of it in the mix, the control address is named only when it is what is missing (has_control): with
        // it given, the mix is not going, or the camera's own sound is not read yet or cannot be.
        const quiet = c.soundless && c.id !== state.camera;
        const what = c.id === state.camera ? 'leads: the mix keeps its time'
          : !e ? (db === null ? 'left out' : !quiet ? 'not streaming, or its sound cannot be read'
            : c.has_control ? 'sends no sound in its stream over SRT, and the mix has none from the camera itself: the mix is not going, or its sound cannot be read from the camera'
            : 'sends no sound in its stream over SRT, and the mix is not reading it from the camera itself (that needs its control address, on its card)')
          : !e.placed ? 'not placed yet: it has to hear what the leading camera hears, for a few seconds'
          : `${e.in_mix ? 'in the mix' : e.late ? 'out: its sound is arriving too late' : 'coming in'} · ${Math.abs(e.behind_ms)} ms ${e.behind_ms >= 0 ? 'behind' : 'ahead'}`
            + `${e.drift_ppm ? `, drifting ${Math.abs(e.drift_ppm)} parts in a million` : ''}${e.unsteady_ms != null ? `, steady to ${e.unsteady_ms} ms` : ''}${e.flipped ? ' · turned the right way up' : ''}`;
        const item = node('li', `${c.name}: ${what}${quiet && e ? ' · read from the camera itself (it sends no sound in its stream over SRT)' : ''} · level `);
        const level = document.createElement('input'); level.type = 'number'; level.min = -30; level.max = 24; level.step = 1; level.disabled = busy;
        level.value = db === null ? '' : db || 0; level.placeholder = 'out'; level.setAttribute('aria-label', `${c.name}: level in the mix, decibels (empty: left out)`);
        level.onchange = () => send({ mix_db: { camera: c.id, db: level.value === '' ? null : Math.max(-30, Math.min(24, Number(level.value) || 0)) } });
        item.append(level, node('span', ' dB'));
        list.append(item);
      }
      parts.push(line, list, node('small', 'Each phone’s sound runs on its own clock, a few parts in a million from the next, so microphones lined up once slide apart and sound hollow. Here each is followed against the leading camera’s and played a very little faster or slower to stay with it, then all are mixed into one source for OBS. It needs the camera relay on. A level left empty leaves that microphone out. What the room does is still there: a microphone far from the others is its own echo however well it keeps time.'));
    }
    if (state.camera && state.others !== 'auto' && state.others !== 'mixed') {
      const list = node('ul', '');
      for (const c of state.cameras) {
        const trim = c.trim_ms ? ` · sound moved ${c.trim_ms > 0 ? 'later' : 'earlier'} by ${Math.abs(c.trim_ms)} ms to line up` : '';
        const silent = c.id === state.camera && c.soundless;
        const line = node('li', `${c.name}: ${silent ? 'leads, but sends no sound in its stream: its source in OBS is silent' : c.id === state.camera ? 'leads' : c.in_programme ? 'in the programme' : `out (${c.why})`}${trim}`);
        if (silent || (!c.in_programme && c.why !== 'not streaming' && state.others === 'aligned')) line.className = 'recording-warning';
        list.append(line);
      }
      parts.push(list);
      const m = state.measured;
      if (m && state.others === 'aligned') parts.push(node('small', m.error ? `Lining up: ${m.error}.` : `Lined up ${Math.max(0, Math.round(Date.now() / 1000 - m.at))} s ago against the chosen camera, from the cameras’ own streams; ${Object.keys(m.moved || {}).length ? 'moved: ' + Object.entries(m.moved).map(([k, v]) => `${k} ${v} ms`).join(', ') : 'nothing needed moving'}.`));
    }
    // A network camera's own input volume (tenveo.py), set on the camera itself: its line input has this one gain.
    for (const input of state.inputs || []) {
      const row = node('p', ''); row.className = 'recipe-load-row';
      const volume = document.createElement('input'); volume.type = 'number'; volume.min = 1; volume.max = input.most; volume.step = 1; volume.value = input.volume; volume.disabled = busy;
      volume.setAttribute('aria-label', `${input.name}: input volume, 1 to ${input.most}`);
      const set = document.createElement('button'); set.textContent = 'Set'; set.disabled = busy;
      set.onclick = () => send({ input_volume: { camera: input.id, value: Math.max(1, Math.min(input.most, Math.round(Number(volume.value)) || input.volume)) } }, '/api/programme-sound', `Setting ${input.name}…`, 'Set on the camera.');
      const guard = document.createElement('input'); guard.type = 'checkbox'; guard.checked = !!input.guard; guard.disabled = busy;
      guard.onchange = () => send({ input_guard: { camera: input.id, on: guard.checked } }, '/api/programme-sound', 'Saving…', guard.checked ? 'It will be turned down when it keeps getting near the top.' : 'Left as set.');
      const guarding = document.createElement('label'); guarding.append(guard, node('span', ' turn it down by itself when its sound keeps getting near the top'));
      const g = input.guarding;
      const heard = node('small', !input.guard ? '' : !g || !g.listening ? ' Not listening to it yet.' : ` Loudest in the last 10 s: ${g.peak_db == null ? '—' : `${g.peak_db} dB`}.${g.lowered ? ` Turned down from ${g.lowered.from} to ${g.lowered.to} at ${new Date(g.lowered.at * 1000).toLocaleTimeString()} (it reached ${g.lowered.peak_db} dB).` : ''}${g.stopped ? ` It has stopped at ${g.floor}, as far below where you set it as it goes: if it is still too loud, set it lower yourself.` : g.floor != null ? ` It goes no lower than ${g.floor}.` : ''} Never turned back up: do that here, between songs.`);
      row.append(node('span', `${input.name}: its own input volume `), volume, node('span', ` of ${input.most} `), set, node('span', ' '), guarding, heard,
        node('small', ` Set on the camera itself, for its sound ${state.cameras.find(c => c.id === input.id)?.soundless ? 'in the mix (its stream brings none to OBS)' : 'in OBS and in the mix alike'}, at once. Turn it down until the loudest sound of the show stays clear of the top.`));
      parts.push(row);
    }
    // Lip sync: every camera's sound moved against its picture, for a voice that comes after the mouth.
    const lips = node('p', ''); lips.className = 'recipe-load-row';
    const ms = document.createElement('input'); ms.type = 'number'; ms.min = -1500; ms.max = 1500; ms.step = 10; ms.value = state.lip_sync_ms || 0; ms.setAttribute('aria-label', 'Lip sync, milliseconds');
    const setLips = document.createElement('button'); setLips.textContent = 'Set'; setLips.disabled = busy; setLips.onclick = () => send({ lip_sync_ms: Number(ms.value) || 0 });
    lips.append(node('span', 'Lip sync: every camera’s sound '), ms, node('span', ' ms '), setLips,
      node('small', ' Negative moves the sound earlier: try −100 if voices come after the mouths, and adjust by ear on the programme. A camera measured by Calibrate sync uses its own instead.'));
    parts.push(lips);
    // Calibrate sync (avsync.py): a phone or tablet flashes and beeps in front of the cameras; each one's sound is
    // measured against its own picture and set as its own lip sync.
    const calibrate = node('div', ''); calibrate.className = 'recipe-load-row';
    const page = state.flash_url || `${location.origin}${state.flash_page || '/sync-flash'}`;     // the easy address (calibrate.<name>) once it is up
    const open = node('a', page); open.href = page; open.target = '_blank'; open.rel = 'noopener';
    const measure = document.createElement('button'); measure.textContent = 'Measure'; measure.disabled = busy;
    measure.onclick = () => send({}, '/api/sync/calibrate', 'Recording the programme to measure: keep the sync page flashing…', 'Measured.');
    const clear = document.createElement('button'); clear.textContent = 'Forget measurements'; clear.disabled = busy || !state.cameras.some(c => c.calibrated_ms != null);
    clear.onclick = () => send({ clear: true }, '/api/sync/calibrate', 'Forgetting…', 'Every camera is back on the one lip sync.');
    const how = node('p', 'Calibrate sync: open '); how.append(open, node('span', ' on a phone or tablet, turn its sound up, press Start flashing, and hold it where the cameras see it (all of them at once if you can). While it flashes, press '), measure, node('span', ' and keep it there until it says Measured (about 15 s: OBS records the programme with the camera your sound comes from on air and its microphone the only one open, then puts the shot and every microphone back as they were; about 30 s with the programme mix, whose own timing is measured after). '), clear);
    calibrate.append(how);
    const cal = state.calibration;
    const results = node('ul', '');
    for (const c of state.cameras) {
      const r = cal && cal.cameras ? cal.cameras[c.name] : null;
      const text = r ? (r.set_ms != null ? `sound ${Math.abs(r.offset_ms)} ms ${r.offset_ms >= 0 ? 'after' : 'before'} the picture in its own stream; lip sync set to ${r.set_ms} ms (${r.pairs} flashes, ±${r.spread_ms} ms)` : `not measured: ${r.why}`)
        : c.calibrated_ms != null ? `lip sync ${c.calibrated_ms} ms, as measured` : `lip sync ${c.lip_sync_ms} ms (every camera’s)`;
      const line = node('li', `${c.name}: ${text}`); if (r && r.set_ms == null) line.className = 'recording-warning';
      results.append(line);
    }
    if (cal && cal.programme) results.prepend(node('li', cal.programme.offset_ms != null
      ? `Programme (OBS's own recording, ${cal.programme.camera} on air): sound ${Math.abs(cal.programme.offset_ms)} ms ${cal.programme.offset_ms >= 0 ? 'after' : 'before'} the picture before this measurement${cal.programme.alone ? ', its microphone the only one open' : ''}${cal.programme.mix_trim_ms != null ? `. The programme mix was on air: its own timing was set (${cal.programme.mix_trim_ms} ms), and no camera’s lip sync was changed` : ''}${cal.programme.mix ? (cal.programme.mix.mix_trim_ms != null ? `. Then the programme mix, recorded as it is: its own timing was set (${cal.programme.mix.mix_trim_ms} ms)` : `. The programme mix’s own timing was not set: ${cal.programme.mix.why}`) : ''}${cal.programme.why ? `. ${cal.programme.why}.` : ''}`
      : `Programme not measured: ${cal.programme.why}`));
    calibrate.append(results);
    parts.push(calibrate);
    const message = node('p', said); message.setAttribute('aria-live', 'polite'); if (/not |need|fail|error|no such/i.test(said)) message.className = 'recording-warning';
    parts.push(message);
    panel.replaceChildren(...parts);
  }

  async function refresh() {
    // An operator's too.
    const showing = typeof part !== 'undefined' && part === '/sound' && soundTab === 'programme' && csrf;
    panel.hidden = !showing;
    if (!showing || busy) return;
    try { state = await api('/api/programme-sound'); paint(false); } catch (error) { said = error.message; }
  }
  document.addEventListener('sound-section', refresh);
  setInterval(refresh, 5000); refresh();
})();
