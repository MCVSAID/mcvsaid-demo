'use strict';
// The calibrate page on a phone (calibrate.html): logged in as a setup tech or an operator, it starts Calibrate's runs
// (calibrate.py) and, for colour, shows what the manager asks for, step by step, saying back each step it shows.
// Sound is the sync flash page (syncflash.js, ?manager=1), which flashes while the manager measures; timing the network
// cameras is the same page without its beeps (?manager=timing), offered when there is a network camera. The chart
// itself, and what happens when the phone's screen changes size under it, is chartrun.js.
(() => {
  const $ = selector => document.querySelector(selector);
  let session = null, lock = null, timer = null, current = null, tries = 0, again = null;

  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf || '' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.detail?.message || data.detail || `The manager answered ${response.status}`); error.status = response.status; error.detail = data.detail; throw error; }
    return data;
  }
  const say = text => { $('#said').textContent = text || ''; };
  const ROLE = { tech: 'setup tech', operator: 'operator', admin: 'administrator' };

  function enter(found) {
    session = found;
    $('#login').hidden = !!session; $('#actions').hidden = !session;
    if (!session) return;
    $('#who').textContent = `Logged in as ${session.name || ROLE[session.role] || session.role}${session.name ? ` (${ROLE[session.role] || session.role})` : ''}.`;
    refresh();
  }

  // -- what the manager says ----------------------------------------------------------------------------------------
  async function refresh() {
    clearTimeout(timer);
    let state = null;
    try { state = await api('/api/calibrate'); }
    catch (error) { if (error.status === 401) { enter(null); return; } say(error.message); }
    if (state) take(state);
    if (state) api('/api/preshow').then(due).catch(() => {});
    const fast = state?.run?.state === 'running' && state.run.yours;
    timer = setTimeout(refresh, fast ? 300 : 2000);
  }

  function take(state) {
    const select = $('#reference'), keep = select.value;
    select.replaceChildren(new Option('the camera that sees the chart best', 'auto'), new Option('the chart’s own colours', 'chart'),
      ...state.cameras.map(c => new Option(c.name + (c.online ? '' : ' (not connected)'), c.id)));
    select.value = [...select.options].some(o => o.value === keep) ? keep : 'auto';
    $('#timing').hidden = !state.cameras.some(c => c.network);
    const run = state.run;
    const mine = run && run.kind === 'colour' && run.yours && run.state === 'running';
    if (mine) { current = run.id; chartRun.show(run, step => api('/api/calibrate/shown', { run: run.id, step }).catch(error => say(error.message))); }
    else if (run && run.kind === 'colour' && run.yours && run.moved && run.id === current && again !== run.id && tries < 2) {
      // The screen changed size under the chart (a browser bar, the phone turned): once more, placed for the screen as it is now.
      again = run.id; tries++; begin(true);
    }
    else if (!starting) leaveRun();
    $('#start-colour').disabled = run?.state === 'running' || starting;
    $('#last').textContent = run ? summary(run) : '';
  }

  // What is due, from the Before the show list (preshow.py): the lip sync, timing and colour items the walk would do.
  function due(report) {
    const all = report.groups.flatMap(g => g.items);
    // The colour items of the same list: what Calibrate colour, here or as the walk's colour step, would put right.
    const colour = all.filter(i => /^colour(:|$)/.test(i.id) && i.state === 'todo');
    const items = [...all.filter(i => /^(lip-sync|timed|programme|mix-trim):?/.test(i.id) && i.state !== 'ready' && i.state !== 'idle'), ...colour];
    $('#due').textContent = items.length ? `Due now: ${items.map(i => i.label).join('; ')}. It takes you to each camera once: you hold this phone in front of it and tap, the manager puts that camera on air with its own microphone and sets its lip sync, and then (when colours are due) this phone shows that camera a colour chart. Then the network cameras, and where the programme’s sound comes from.`
      : 'Nothing is due: every camera’s lip sync, each network camera’s timing and the cameras’ colour match are as measured. It can still take you round every camera again, or straight to where the programme’s sound comes from.';
    $('#colour-due').textContent = colour.length ? `Due now: ${colour.map(i => i.label).join('; ')}.` : '';
  }

  function summary(run) {
    const what = { sync: 'Sound', timing: 'Network camera timing', walk: 'Camera by camera' }[run.kind] || 'Colour';
    if (run.state === 'running') return `${what}: ${run.said}${run.yours ? '' : ` (started by ${run.by_name})`}`;
    if (run.state !== 'done') return `${what}: ${run.problem || run.state}`;
    if (run.kind === 'walk') {
      const colour = run.result?.colour;
      return 'Camera by camera, done.\n' + [...Object.values(run.result?.cameras || {}).map(c => `${c.name}: ${c.set_ms != null ? `lip sync ${c.set_ms} ms` : c.skipped ? 'skipped' : `not measured, ${c.why}`}`),
        ...(colour && !colour.skipped ? [colour.why ? `Colour: not matched, ${colour.why}` : !colour.reference ? 'Colour: no camera’s chart was read' : `Colour: matched to ${colour.reference}${colour.in_obs ? ', in OBS' : ''}`] : [])].join('\n');
    }
    if (run.kind === 'sync') {
      const cameras = run.result?.calibration?.cameras || {};
      return 'Sound measured.\n' + Object.entries(cameras).map(([name, r]) => `${name}: ${r.set_ms != null ? `lip sync ${r.set_ms} ms` : `not measured, ${r.why}`}`).join('\n');
    }
    if (run.kind === 'timing') {
      return 'Network cameras timed.\n' + Object.values(run.result?.cameras || {}).map(c => `${c.name}: ${c.why ? `not timed, ${c.why}` : `${c.own_ms} ms late by itself, held by ${c.held_ms} ms (against ${c.against.join(' and ')})`}`).join('\n');
    }
    const cameras = Object.values(run.result?.cameras || {});
    return `Colour matched to ${run.result?.reference}${run.result?.in_obs ? ', in OBS' : ''}.\n` + cameras.map(c => `${c.name}: ${c.problem ? c.problem : c.name === run.result?.reference ? 'the one the others match' : c.delta_e ? `ΔE ${c.delta_e.before.mean} → ${c.delta_e.after.mean}` : '—'}${c.warnings?.length ? `\n   to put right: ${c.warnings.join('; ')}` : ''}${c.camera ? `\n   its own settings: ${c.camera.why || (c.camera.changed ? `set to ${c.camera.now}` : `left at ${c.camera.now}`)}` : ''}`).join('\n');
  }

  // -- a colour run: the page drawn as the manager asks (chartrun.js) ------------------------------------------------
  let starting = false;
  function leaveRun() {
    if (!chartRun.open()) return;
    chartRun.leave();
    if (lock) { lock.release().catch(() => {}); lock = null; }
  }

  // Starts a colour run. The page is given over to the chart first and left a moment to keep one size (a phone's
  // browser bar shows itself as the page stops scrolling), so the patch area is placed where it will stay. Not full
  // screen: going full screen (or leaving it) resizes the page too, and puts the browser's own notice over the chart.
  async function begin(over) {
    if (starting) return;
    starting = true; $('#start-colour').disabled = true;
    clearTimeout(timer);
    try {
      chartRun.leave(); chartRun.begin(over ? 'The screen changed size: starting again. Hold the phone as it is now' : 'Starting: hold the phone still');
      await chartRun.settled();
      chartRun.leave(); chartRun.begin('Starting: hold the phone still');
      const state = await api('/api/calibrate/start', { kind: 'colour', reference: $('#reference').value, obs: $('#obs').checked });
      current = state.run?.id; starting = false; take(state);
    } catch (error) { starting = false; leaveRun(); say(error.message); }
    refresh();
  }
  chartRun.onMoved = async () => { try { take(await api('/api/calibrate/moved', { run: current })); } catch (error) { say(error.message); } };

  $('#start-colour').onclick = () => {
    say('');
    if (!chartRun.ready()) { say('The chart has not loaded yet: wait a moment.'); return; }
    // Awake for the run, asked on this tap.
    try { navigator.wakeLock?.request('screen').then(held => { lock = held; }).catch(() => {}); } catch (error) { /* the screen may dim; keep tapping it */ }
    tries = 0; again = null; begin(false);
  };
  $('#stop').onclick = async () => { tries = 2; try { await api('/api/calibrate/stop', {}); } catch (error) { say(error.message); } leaveRun(); refresh(); };

  // -- logging in -------------------------------------------------------------------------------------------------------
  $('#login').onsubmit = async event => {
    event.preventDefault(); say('');
    // An administrator from the network gives the authenticator code too (twofactor.py): the field appears when it is asked for.
    const login = { name: $('#username').value, password: $('#password').value, ...($('#code-line').hidden ? {} : { code: $('#code').value }) };
    try { enter(await api('/api/login', login)); $('#password').value = ''; $('#code').value = ''; $('#code-line').hidden = true; }
    catch (error) {
      if (error.detail?.code_needed) { $('#code-line').hidden = false; $('#code').value = ''; $('#code').focus(); }
      say(error.message);
    }
  };
  $('#logout').onclick = async () => { try { await api('/api/logout', {}); } catch (error) { /* gone already */ } clearTimeout(timer); enter(null); };

  fetch('/api/session').then(r => r.ok ? r.json() : null).catch(() => null).then(found => enter(found));
})();
