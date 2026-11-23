'use strict';
// Calibrate sync's flash page (syncflash.html, avsync.py): white flashes and 2 kHz beeps together, at uneven times.
// Uneven gaps (seconds), so a flash cannot be paired with the wrong beep: none of them shorter than 0.7 s.
const GAPS = [0.9, 1.3, 0.8, 1.6, 1.1, 0.75, 1.45, 1.0, 1.25, 0.85, 1.55, 1.15];
const FLASH = 0.12, TONE = 2000;
let audio = null, lock = null, next = 0, step = 0;
// From the calibrate page logged in: the manager measures while it flashes, and it stops by itself when the manager
// has done, saying what was measured. ?manager=1 is calibrate.py's sound run (each camera's lip sync); ?manager=timing
// its timing run (each network camera timed against the phones by the flashes both see, flashsync.py), which needs
// the light only: no beeps. ?manager=walk is its camera-by-camera run ("Pre-show calibration check", called "Do what is due" until 2026-11-22): the page stays open for the
// whole of it, shows what the manager asks at each camera (run.ask) with the answers to tap, and flashes and beeps only
// while the manager says it is measuring (run.show === 'flash'). At the same stop, after the flashes, it shows the
// chart for that camera's colours (run.show black, locate or chart: chartrun.js), each step said back to the manager
// as on the calibrate page. Its last question, with the programme mix, is how the mix's own timing is measured: from the
// stage beacon (the answer 'beacon', offered first when it can be), with the flashes at the leading camera ('go'), or not.
// A run already going on is never a dead end (2026-11-21 and 22: a walk left at a question on a page since navigated
// away from, and "Pre-show calibration check" could not be started again until the manager was restarted). Opened while a walk
// waits at a question, this page offers to pick it up where it was, or to end it and start again (offer); a start the
// manager refuses is said, with the same way out.
const ASKED = new URLSearchParams(location.search).get('manager');
const KIND = ASKED === 'timing' ? 'timing' : ASKED === 'walk' ? 'walk' : ASKED === '1' ? 'sync' : null;
const WALK = KIND === 'walk', ALL = new URLSearchParams(location.search).get('all') === '1';
let flashing = !WALK, asked = 0, quiet = false;      // quiet: the walk timing a network camera, by the light alone
const MANAGER = KIND !== null, SILENT = KIND === 'timing';
const SECONDS = SILENT ? 20 : 15;
function measured(run) {
  if (run.kind === 'walk') {
    const beacon = b => b.why ? `Stage beacon: did not measure (${b.why})` : `Stage beacon (${b.beacon}): ${b.settled.length ? `settled ${b.settled.join(', ')}` : 'settled no camera'}${Object.keys(b.left).length ? `; left to walk to: ${Object.keys(b.left).join(', ')}` : ''}`;
    const r = run.result || {}, lines = Object.values(r.cameras || {}).map(c => `${c.name}: ${c.set_ms != null ? `lip sync ${c.set_ms} ms` : c.skipped ? 'skipped' : `not measured (${c.why})`}`);
    if (r.beacon && !r.beacon.skipped) lines.unshift(beacon(r.beacon));
    if (r.timing && !r.timing.skipped) lines.push(r.timing.why ? `Network cameras: not timed (${r.timing.why})` : Object.values(r.timing.cameras || {}).map(c => `${c.name}: ${c.why ? `not timed (${c.why})` : `held by ${c.held_ms} ms (±${c.spread_ms} ms)`}`).join('; '));
    if (r.colour && !r.colour.skipped) lines.push(r.colour.why ? `Colour: not matched (${r.colour.why})` : !r.colour.reference ? 'Colour: no camera’s chart was read' : `Colour: matched to ${r.colour.reference}${r.colour.in_obs ? ', in OBS' : r.colour.held ? ' (measured only: not put on the pictures; look at it on the Colour page)' : ''}`
      + Object.values(r.colour.cameras || {}).filter(c => c.problem).map(c => `; not ${c.name}`).join('')
      + Object.values(r.colour.cameras || {}).filter(c => c.warnings?.length).map(c => `\n   ${c.name}, to put right: ${c.warnings.join('; ')}`).join(''));
    if (r.sound) lines.push(r.sound.kept ? 'Programme sound: left as it was' : `Programme sound: ${r.sound.camera}${{ muted: ' alone', aligned: ', the others joined in time', mixed: ' leading the programme mix' }[r.sound.others] || ''}`);
    // The mix's own timing, the run's last step: set with the flashes, or by the stage beacon set, checked (as good as
    // right, and left), or read and not set over what is kept (calibrate.Calibrate.mix_timing).
    const late = ms => `${Math.abs(ms)} ms ${ms >= 0 ? 'late' : 'early'}`, m = r.mix;
    if (m && !m.skipped) lines.push(m.by !== 'beacon' ? (m.trim_ms != null ? `Programme mix: timing set to ${m.trim_ms} ms` : `Programme mix: not measured (${m.why})`)
      : m.state === 'set' ? `Programme mix: timing set to ${m.trim_ms} ms from the stage beacon (it was heard ${late(m.off_ms)})`
      : m.state === 'checked' ? `Programme mix: timing left at ${m.trim_ms} ms, checked from the stage beacon (heard ${late(m.off_ms)}, within what that reading can tell)`
      : m.state === 'left' ? `Programme mix: the stage beacon heard it ${late(m.off_ms)} and set nothing, it is still ${m.trim_ms} ms (${m.why})`
      : `Programme mix: not timed from the stage beacon (${m.why})`);
    return 'Done.\n' + (lines.join('\n') || 'Nothing was due.');
  }
  if (run.kind === 'timing') {
    const cameras = Object.values(run.result?.cameras || {});
    return 'Timed. ' + cameras.map(c => `${c.name}: ${c.why ? `not timed (${c.why})` : `${c.own_ms} ms late by itself, held by ${c.held_ms} ms`}`).join('; ');
  }
  const cameras = run.result?.calibration?.cameras || {};
  return 'Measured. ' + Object.entries(cameras).map(([name, r]) => `${name}: ${r.set_ms != null ? `lip sync ${r.set_ms} ms` : `not measured (${r.why})`}`).join('; ');
}
let csrf = '', watching = null;
async function call(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `The manager answered ${response.status}`);
  return data;
}
// how: 'pick' goes on with the walk that is waiting (taken over first when another page or login started it); 'over'
// ends a run that is only waiting, whoever started it, for this one.
async function measure(how) {
  try {
    csrf = (await call('/api/session')).csrf;
    if (how === 'pick') {
      const run = (await call('/api/calibrate')).run;
      if (!run || run.state !== 'running' || run.kind !== 'walk') throw new Error('That run has ended' + (run && run.state !== 'done' && run.problem ? `: ${run.problem}` : '.'));
      if (!run.yours) await call('/api/calibrate/take', { run: run.id });
    } else await call('/api/calibrate/start', { kind: KIND, ...(WALK ? { all: ALL } : {}), ...(how === 'over' ? { over: true } : {}) });
  } catch (error) { stop(`Not started. ${error.message}`); offer(); return; }
  document.getElementById('state').textContent = WALK ? '' : `Flashing while the manager measures (about ${SECONDS} seconds). Tap to stop.`;
  if (WALK) { document.getElementById('walk').hidden = false; document.querySelector('#words p').hidden = true; }      // the questions take the page
  const look = async () => {
    let run = null;
    try { run = (await call('/api/calibrate')).run; } catch (error) { /* asked again */ }
    if (!audio) return;
    if (run && run.state !== 'running') {
      stop(run.state === 'done' ? measured(run) : (run.problem || run.state));
      return;
    }
    if (WALK && run) walk(run);
    watching = setTimeout(look, WALK ? 500 : 1000);
  };
  watching = setTimeout(look, 1000);
}
// The camera-by-camera run: what the manager says, the answers to what it asks, and flashing only while it measures.
function walk(run) {
  const was = flashing;
  flashing = run.show === 'flash' || run.show === 'flash-silent'; quiet = run.show === 'flash-silent';
  if (flashing && !was && audio) next = audio.currentTime + 0.4;
  // Measuring is over: the beeps already put out for the next two seconds are taken back with their flashes (a beep
  // was heard over a dark screen after each camera, 2026-11-21).
  if (!flashing && was) hush();
  document.getElementById('walk-said').textContent = run.said || '';
  // The colour step: the page is the chart's while the manager asks for it.
  if (['black', 'locate', 'chart'].includes(run.show)) {
    chartRun.onMoved = () => call('/api/calibrate/moved', { run: run.id }).catch(() => {});
    chartRun.show(run, step => call('/api/calibrate/shown', { run: run.id, step }).catch(() => {}));
  } else chartRun.leave();
  const options = document.getElementById('walk-options'), pictures = document.getElementById('walk-pictures'), ask = run.ask;
  if (!ask) { options.replaceChildren(); pictures.replaceChildren(); asked = 0; return; }
  if (ask.step === asked) return;
  asked = ask.step; options.replaceChildren(); pictures.replaceChildren();
  // A colour match by the scene: the camera matched to, and this camera with its match on, both as OBS has them.
  for (const [words, which] of ask.pictures || []) {
    const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
    image.src = `/api/calibrate/picture/${which}?step=${ask.step}`; image.alt = words; caption.textContent = words;
    figure.append(image, caption); pictures.append(figure);
  }
  const answer = async choice => {
    options.replaceChildren(); pictures.replaceChildren();
    try { await call('/api/calibrate/choose', { run: run.id, step: ask.step, choice }); } catch (error) { document.getElementById('walk-said').textContent = error.message; asked = 0; }
  };
  let select = null;
  if (ask.kind === 'sound') {
    select = document.createElement('select');
    for (const camera of ask.cameras) select.append(new Option(camera.name, camera.id));
    if (ask.cameras.some(c => c.id === ask.now.camera)) select.value = ask.now.camera;
    const label = document.createElement('label'); label.textContent = 'Camera: '; label.append(select);
    options.append(label);
  }
  ask.options.forEach(([value, words], index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = words;
    // The answer the manager offers first, when it says which (a network camera not timed while the delays move: go on).
    if (ask.prefer ? value !== ask.prefer : value === 'skip' || value === 'keep' || (ask.kind !== 'sound' && index)) button.className = 'other';
    button.onclick = () => answer(select && value !== 'keep' ? { camera: select.value, others: value } : value);
    options.append(button);
  });
}
// What is going on already, asked when the page opens and when a start is refused: a run waiting at a question can be
// picked up (a walk, on the walk's page) or ended for a new one; one that is measuring ends by itself, and is waited for.
let offering = null;
async function offer() {
  clearTimeout(offering);
  const box = document.getElementById('going'), options = document.getElementById('going-options'), begin = document.getElementById('start');
  let run = null;
  try { run = (await call('/api/calibrate')).run; } catch (error) { /* not logged in: Start says so */ }
  if (audio) return;                                  // started meanwhile
  options.replaceChildren();
  if (!run || run.state !== 'running') { box.hidden = true; begin.hidden = false; return; }
  const what = { walk: 'camera-by-camera', sync: 'sound', timing: 'timing', beacon: 'stage beacon' }[run.kind] || 'colour', whose = run.yours ? 'you started' : `started by ${run.by_name}`;
  box.hidden = false; begin.hidden = true;
  if (!run.waiting) {
    document.getElementById('going-said').textContent = `A ${what} run ${whose} is measuring just now: “${run.said}” It ends by itself within seconds, and this can start then.`;
    offering = setTimeout(offer, 2000);
    return;
  }
  document.getElementById('going-said').textContent = `A ${what} run ${whose} is waiting for an answer: “${run.said}”`;
  const button = (words, how, other) => {
    const made = document.createElement('button'); made.type = 'button'; made.textContent = words; if (other) made.className = 'other';
    made.onclick = event => { event.stopPropagation(); start(how); };
    options.append(made);
  };
  if (WALK && run.kind === 'walk') button('Pick it up where it was', 'pick');
  button(WALK ? 'End it and start again' : 'End it and start this', 'over', WALK && run.kind === 'walk');
}
async function start(how) {
  clearTimeout(offering); document.getElementById('going').hidden = true;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  await audio.resume();
  try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* the screen may dim; keep tapping it */ }
  document.getElementById('start').hidden = true;
  document.getElementById('state').textContent = WALK ? '' : 'Flashing. Tap to stop.';
  if (!WALK) document.body.onclick = stop;
  next = audio.currentTime + 1.0;
  schedule();
  if (MANAGER) measure(how);
}
// The beeps given to the sound clock ahead of time (schedule): silenced, when their flashes will not be shown.
const ahead = [];
function hush() {
  for (const { gain } of ahead.splice(0)) { try { gain.gain.cancelScheduledValues(0); gain.gain.value = 0; } catch (e) { /* played already */ } }
}
function schedule() {
  if (!audio) return;
  if (!flashing) { next = audio.currentTime + 0.4; setTimeout(schedule, 200); return; }      // between cameras: quiet and dark
  // The beep is put out early by the device's own sound latency, so it is heard as the screen lights.
  const late = (audio.outputLatency || 0) + (audio.baseLatency || 0);
  while (ahead.length && ahead[0].until < audio.currentTime) ahead.shift();
  while (next < audio.currentTime + 2) {
    const at = next, osc = audio.createOscillator(), gain = audio.createGain();
    if (SILENT || quiet) gain.gain.value = 0;      // the sound's clock still times the flashes; nothing is heard
    osc.frequency.value = TONE; osc.connect(gain); gain.connect(audio.destination);
    if (!SILENT && !quiet) {
      gain.gain.setValueAtTime(0, Math.max(0, at - late));
      gain.gain.linearRampToValueAtTime(0.9, Math.max(0, at - late) + 0.002);
      gain.gain.setValueAtTime(0.9, Math.max(0, at - late) + FLASH - 0.002);
      gain.gain.linearRampToValueAtTime(0, Math.max(0, at - late) + FLASH);
    }
    osc.start(Math.max(0, at - late)); osc.stop(Math.max(0, at - late) + FLASH + 0.01);
    ahead.push({ gain, until: at + FLASH });
    const wait = (at - audio.currentTime) * 1000;
    setTimeout(() => flash(at), Math.max(0, wait - 30));
    next += GAPS[step++ % GAPS.length];
  }
  setTimeout(schedule, 500);
}
function flash(at) {
  // Lit on the first screen refresh at or after the beep's moment.
  const paint = () => {
    if (!audio || !flashing) return;
    if (audio.currentTime < at) { requestAnimationFrame(paint); return; }
    // Too late to light with its beep (the page in the background, the device busy): skipped, never paired wrongly.
    if (audio.currentTime - at > 0.05) return;
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), FLASH * 1000);
  };
  requestAnimationFrame(paint);
}
function stop(said) {
  const told = typeof said === 'string';
  if (MANAGER && audio && !told) call('/api/calibrate/stop', {}).catch(() => {});     // tapped: the manager stops too
  clearTimeout(watching);
  if (audio) audio.close(); audio = null;
  if (lock) lock.release(); lock = null;
  document.body.onclick = null; document.body.classList.remove('flash');
  document.getElementById('start').hidden = false;
  document.getElementById('state').textContent = told ? said : 'Stopped.';
  document.getElementById('state').style.whiteSpace = 'pre-line';
  document.getElementById('walk').hidden = true; asked = 0; flashing = !WALK;
  chartRun.leave();
  if (WALK) document.querySelector('#words p').hidden = false;
}
document.getElementById('start').onclick = (event) => { event.stopPropagation(); start(); };
document.getElementById('run-stop').onclick = () => document.getElementById('walk-stop').click();
document.getElementById('walk-stop').onclick = async () => {
  // Between cameras it stops at once; while a camera is on air being measured, once that measurement has finished.
  try { const state = await call('/api/calibrate/stop', {}); if (state.run?.state !== 'running') stop('Stopped. What was measured until now is kept.'); } catch (error) { stop(error.message); }
};
if (MANAGER) offer();
if (WALK) {
  document.querySelector('#words h1').textContent = ALL ? 'Every camera, one by one' : 'Pre-show calibration check';
  document.querySelector('#words p').textContent = 'Turn this phone’s sound and brightness up and press Start. With a stage beacon standing ready it first offers to measure from the beacon, and a camera the beacon settles is not walked to. It then takes you from camera to camera, once each: hold the phone in front of it and tap; the manager puts that camera on air with its own microphone and measures its lip sync while this flashes and beeps. Then the network cameras; then, when the cameras’ colours need matching, they are matched by what they see, and each is shown here beside the one it is matched to, to keep or leave; and last where the programme’s sound comes from. With the programme mix chosen there, the mix’s own timing is measured at the very end: from the stage beacon when one stands ready and can be sure of it, with nobody going back on stage, else with the flashes at the camera that leads the mix.';
  document.getElementById('start').textContent = 'Start';
} else if (MANAGER) {
  document.querySelector('#words p').textContent = SILENT
    ? 'Turn the screen’s brightness up, press Start, and hold the screen still where a network camera and at least one phone camera both see it. The manager times the network camera by the flashes both see, and it stops by itself when done (about 20 seconds). No sound is needed.'
    : 'Turn this device’s sound up, press Start, and hold the screen where every camera sees and hears it, about an arm’s length from the nearest. The manager measures while it flashes, and it stops by itself when done (about 15 seconds).';
  document.getElementById('start').textContent = SILENT ? 'Start timing' : 'Start measuring';
  if (SILENT) document.querySelector('#words h1').textContent = 'Time the network cameras';
}
