'use strict';
// Calibrate sync's flash page (syncflash.html, avsync.py): white flashes and 2 kHz beeps together, at uneven times.
// Uneven gaps (seconds), so a flash cannot be paired with the wrong beep: none of them shorter than 0.7 s.
const GAPS = [0.9, 1.3, 0.8, 1.6, 1.1, 0.75, 1.45, 1.0, 1.25, 0.85, 1.55, 1.15];
const FLASH = 0.12, TONE = 2000;
let audio = null, lock = null, next = 0, step = 0;
// From the calibrate page logged in: the manager measures while it flashes, and it stops by itself when the manager
// has done, saying what was measured. ?manager=1 is calibrate.py's sound run (each camera's lip sync); ?manager=timing
// its timing run (each network camera timed against the phones by the flashes both see, flashsync.py), which needs
// the light only: no beeps. ?manager=walk is its camera-by-camera run ("Do what is due"): the page stays open for the
// whole of it, shows what the manager asks at each camera (run.ask) with the answers to tap, and flashes and beeps only
// while the manager says it is measuring (run.show === 'flash'). At the same stop, after the flashes, it shows the
// chart for that camera's colours (run.show black, locate or chart: chartrun.js), each step said back to the manager
// as on the calibrate page.
const ASKED = new URLSearchParams(location.search).get('manager');
const KIND = ASKED === 'timing' ? 'timing' : ASKED === 'walk' ? 'walk' : ASKED === '1' ? 'sync' : null;
const WALK = KIND === 'walk', ALL = new URLSearchParams(location.search).get('all') === '1';
let flashing = !WALK, asked = 0, quiet = false;      // quiet: the walk timing a network camera, by the light alone
const MANAGER = KIND !== null, SILENT = KIND === 'timing';
const SECONDS = SILENT ? 20 : 15;
function measured(run) {
  if (run.kind === 'walk') {
    const r = run.result || {}, lines = Object.values(r.cameras || {}).map(c => `${c.name}: ${c.set_ms != null ? `lip sync ${c.set_ms} ms` : c.skipped ? 'skipped' : `not measured (${c.why})`}`);
    if (r.timing && !r.timing.skipped) lines.push(r.timing.why ? `Network cameras: not timed (${r.timing.why})` : Object.values(r.timing.cameras || {}).map(c => `${c.name}: ${c.why ? `not timed (${c.why})` : `held by ${c.held_ms} ms (±${c.spread_ms} ms)`}`).join('; '));
    if (r.colour && !r.colour.skipped) lines.push(r.colour.why ? `Colour: not matched (${r.colour.why})` : !r.colour.reference ? 'Colour: no camera’s chart was read' : `Colour: matched to ${r.colour.reference}${r.colour.in_obs ? ', in OBS' : ''}`
      + Object.values(r.colour.cameras || {}).filter(c => c.problem).map(c => `; not ${c.name}`).join('')
      + Object.values(r.colour.cameras || {}).filter(c => c.warnings?.length).map(c => `\n   ${c.name}, to put right: ${c.warnings.join('; ')}`).join(''));
    if (r.sound) lines.push(r.sound.kept ? 'Programme sound: left as it was' : `Programme sound: ${r.sound.camera}${{ muted: ' alone', aligned: ', the others joined in time', mixed: ' leading the programme mix' }[r.sound.others] || ''}`);
    if (r.mix && !r.mix.skipped) lines.push(r.mix.trim_ms != null ? `Programme mix: timing set to ${r.mix.trim_ms} ms` : `Programme mix: not measured (${r.mix.why})`);
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
async function measure() {
  try {
    csrf = (await call('/api/session')).csrf;
    await call('/api/calibrate/start', WALK ? { kind: KIND, all: ALL } : { kind: KIND });
  } catch (error) { stop(error.message); return; }
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
  document.getElementById('walk-said').textContent = run.said || '';
  // The colour step: the page is the chart's while the manager asks for it.
  if (['black', 'locate', 'chart'].includes(run.show)) {
    chartRun.onMoved = () => call('/api/calibrate/moved', { run: run.id }).catch(() => {});
    chartRun.show(run, step => call('/api/calibrate/shown', { run: run.id, step }).catch(() => {}));
  } else chartRun.leave();
  const options = document.getElementById('walk-options'), ask = run.ask;
  if (!ask) { options.replaceChildren(); asked = 0; return; }
  if (ask.step === asked) return;
  asked = ask.step; options.replaceChildren();
  const answer = async choice => {
    options.replaceChildren();
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
    if (value === 'skip' || value === 'keep' || (ask.kind !== 'sound' && index)) button.className = 'other';
    button.onclick = () => answer(select && value !== 'keep' ? { camera: select.value, others: value } : value);
    options.append(button);
  });
}
async function start() {
  audio = new (window.AudioContext || window.webkitAudioContext)();
  await audio.resume();
  try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* the screen may dim; keep tapping it */ }
  document.getElementById('start').hidden = true;
  document.getElementById('state').textContent = WALK ? '' : 'Flashing. Tap to stop.';
  if (!WALK) document.body.onclick = stop;
  next = audio.currentTime + 1.0;
  schedule();
  if (MANAGER) measure();
}
function schedule() {
  if (!audio) return;
  if (!flashing) { next = audio.currentTime + 0.4; setTimeout(schedule, 200); return; }      // between cameras: quiet and dark
  // The beep is put out early by the device's own sound latency, so it is heard as the screen lights.
  const late = (audio.outputLatency || 0) + (audio.baseLatency || 0);
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
if (WALK) {
  document.querySelector('#words h1').textContent = ALL ? 'Every camera, one by one' : 'Do what is due';
  document.querySelector('#words p').textContent = 'Turn this phone’s sound and brightness up and press Start. It then takes you from camera to camera, once each: hold the phone in front of it and tap; the manager puts that camera on air with its own microphone and measures its lip sync while this flashes and beeps, and then, when the cameras’ colours need matching, this shows a colour chart to the same camera: keep it there, still, until it asks for the next. Then the network cameras, and last where the programme’s sound comes from.';
  document.getElementById('start').textContent = 'Start';
} else if (MANAGER) {
  document.querySelector('#words p').textContent = SILENT
    ? 'Turn the screen’s brightness up, press Start, and hold the screen still where a network camera and at least one phone camera both see it. The manager times the network camera by the flashes both see, and it stops by itself when done (about 20 seconds). No sound is needed.'
    : 'Turn this device’s sound up, press Start, and hold the screen where every camera sees and hears it, about an arm’s length from the nearest. The manager measures while it flashes, and it stops by itself when done (about 15 seconds).';
  document.getElementById('start').textContent = SILENT ? 'Start timing' : 'Start measuring';
  if (SILENT) document.querySelector('#words h1').textContent = 'Time the network cameras';
}
