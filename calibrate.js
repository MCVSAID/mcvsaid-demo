'use strict';
// The calibrate page on a phone (calibrate.html): logged in as a setup tech or an operator, it starts Calibrate's runs
// (calibrate.py) and, for colour, shows what the manager asks for, step by step, saying back each step it shows.
// Sound is the sync flash page (syncflash.js, ?manager=1), which flashes while the manager measures.
(() => {
  const $ = selector => document.querySelector(selector);
  let session = null, chart = null, painted = 0, lock = null, timer = null, turned = false;

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
    const fast = state?.run?.state === 'running' && state.run.yours;
    timer = setTimeout(refresh, fast ? 300 : 2000);
  }

  function take(state) {
    const select = $('#reference'), keep = select.value;
    select.replaceChildren(new Option('the camera that sees the chart best', 'auto'), new Option('the chart’s own colours', 'chart'),
      ...state.cameras.map(c => new Option(c.name + (c.online ? '' : ' (not connected)'), c.id)));
    select.value = [...select.options].some(o => o.value === keep) ? keep : 'auto';
    const run = state.run;
    const mine = run && run.kind === 'colour' && run.yours && run.state === 'running';
    if (mine) showStep(run); else leaveRun();
    $('#start-colour').disabled = run?.state === 'running';
    $('#last').textContent = run ? summary(run) : '';
  }

  function summary(run) {
    const what = run.kind === 'sync' ? 'Sound' : 'Colour';
    if (run.state === 'running') return `${what}: ${run.said}${run.yours ? '' : ` (started by ${run.by_name})`}`;
    if (run.state !== 'done') return `${what}: ${run.problem || run.state}`;
    if (run.kind === 'sync') {
      const cameras = run.result?.calibration?.cameras || {};
      return 'Sound measured.\n' + Object.entries(cameras).map(([name, r]) => `${name}: ${r.set_ms != null ? `lip sync ${r.set_ms} ms` : `not measured, ${r.why}`}`).join('\n');
    }
    const cameras = Object.values(run.result?.cameras || {});
    return `Colour matched to ${run.result?.reference}${run.result?.in_obs ? ', in OBS' : ''}.\n` + cameras.map(c => `${c.name}: ${c.problem ? c.problem : c.name === run.result?.reference ? 'the one the others match' : c.delta_e ? `ΔE ${c.delta_e.before.mean} → ${c.delta_e.after.mean}` : '—'}`).join('\n');
  }

  // -- a colour run: the page drawn as the manager asks -------------------------------------------------------------
  function place() {
    // The patch area, 3:2, as large as fits with room round it; each of its 6 x 4 cells holds a patch in its middle,
    // as the Colour page samples a chart (colour.chart_patches: the middle half of each cell).
    const vw = innerWidth, vh = innerHeight, margin = Math.round(Math.min(vw, vh) * 0.05);
    const room = { w: vw - 2 * margin, h: vh - 2 * margin - 64 };
    const w = Math.floor(Math.min(room.w, room.h * 1.5)), h = Math.floor(w / 1.5);
    const area = $('#area');
    Object.assign(area.style, { width: `${w}px`, height: `${h}px`, left: `${Math.round((vw - w) / 2)}px`, top: `${Math.round((vh - h) / 2)}px` });
    if (!area.children.length && chart) {
      chart.forEach(([name, rgb], i) => {
        const patch = document.createElement('div'); patch.className = 'patch'; patch.title = name; patch.hidden = true;
        const col = i % 6, row = Math.floor(i / 6);
        Object.assign(patch.style, { left: `${(col + 0.1) / 6 * 100}%`, top: `${(row + 0.1) / 4 * 100}%`, width: `${0.8 / 6 * 100}%`, height: `${0.8 / 4 * 100}%`, background: `rgb(${rgb.join(',')})` });
        area.append(patch);
      });
    }
  }

  function showStep(run) {
    const shown = $('#run');
    if (shown.hidden) {
      shown.hidden = false; document.body.classList.add('running');
      place();
    }
    if (!turned) $('#step').textContent = run.said;
    if (run.step <= painted || !run.show) return;
    const area = $('#area');
    area.classList.toggle('lit', run.show === 'locate');
    for (const patch of area.children) patch.hidden = run.show !== 'chart';
    painted = run.step;
    // Said back once it is on the screen: two frames later, so the change has been drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => api('/api/calibrate/shown', { run: run.id, step: run.step }).catch(error => say(error.message))));
  }

  function leaveRun() {
    if ($('#run').hidden) return;
    $('#run').hidden = true; document.body.classList.remove('running'); painted = 0; turned = false;
    if (lock) { lock.release().catch(() => {}); lock = null; }
  }

  $('#start-colour').onclick = async () => {
    say('');
    if (!chart) { say('The chart has not loaded yet: wait a moment.'); return; }
    // Awake for the run, asked on this tap. Not full screen: going full screen (or leaving it) resizes the page, which
    // would move the patch area after the manager had found it; the run covers the page as it is instead.
    try { navigator.wakeLock?.request('screen').then(held => { lock = held; }).catch(() => {}); } catch (error) { /* the screen may dim; keep tapping it */ }
    painted = 0; $('#area').replaceChildren();
    try { take(await api('/api/calibrate/start', { kind: 'colour', reference: $('#reference').value, obs: $('#obs').checked })); }
    catch (error) { leaveRun(); say(error.message); }
    refresh();
  };
  $('#stop').onclick = async () => { try { await api('/api/calibrate/stop', {}); } catch (error) { say(error.message); } leaveRun(); refresh(); };
  // Placed again only before the manager has looked for it: once found, the patch area must stay where it was, so a
  // screen that changes shape mid-run (the phone turned) says to start again rather than moving it.
  addEventListener('resize', () => {
    if ($('#run').hidden) return;
    if (!painted) { place(); return; }
    turned = true; $('#step').textContent = 'The screen changed shape: press Stop and start again, holding the phone the same way.';
  });

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

  fetch('/colour-chart.json').then(r => r.json()).then(data => { chart = data.patches.map(p => [p.name, p.rgb]); }).catch(() => {});
  fetch('/api/session').then(r => r.ok ? r.json() : null).catch(() => null).then(found => enter(found));
})();
