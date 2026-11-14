'use strict';
// Calibrate sync's flash page (syncflash.html, avsync.py): white flashes and 2 kHz beeps together, at uneven times.
// Uneven gaps (seconds), so a flash cannot be paired with the wrong beep: none of them shorter than 0.7 s.
const GAPS = [0.9, 1.3, 0.8, 1.6, 1.1, 0.75, 1.45, 1.0, 1.25, 0.85, 1.55, 1.15];
const FLASH = 0.12, TONE = 2000;
let audio = null, lock = null, next = 0, step = 0;
// From the calibrate page logged in (?manager=1): the manager measures while it flashes (calibrate.py's sound run), and
// it stops by itself when the manager has done, saying what was measured.
const MANAGER = new URLSearchParams(location.search).get('manager') === '1';
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
    await call('/api/calibrate/start', { kind: 'sync' });
  } catch (error) { stop(error.message); return; }
  document.getElementById('state').textContent = 'Flashing while the manager measures (about 15 seconds). Tap to stop.';
  const look = async () => {
    let run = null;
    try { run = (await call('/api/calibrate')).run; } catch (error) { /* asked again */ }
    if (!audio) return;
    if (run && run.state !== 'running') {
      const cameras = run.result?.calibration?.cameras || {};
      stop(run.state === 'done' ? 'Measured. ' + Object.entries(cameras).map(([name, r]) => `${name}: ${r.set_ms != null ? `lip sync ${r.set_ms} ms` : `not measured (${r.why})`}`).join('; ') : (run.problem || run.state));
      return;
    }
    watching = setTimeout(look, 1000);
  };
  watching = setTimeout(look, 1000);
}
async function start() {
  audio = new (window.AudioContext || window.webkitAudioContext)();
  await audio.resume();
  try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* the screen may dim; keep tapping it */ }
  document.getElementById('start').hidden = true;
  document.getElementById('state').textContent = 'Flashing. Tap to stop.';
  document.body.onclick = stop;
  next = audio.currentTime + 1.0;
  schedule();
  if (MANAGER) measure();
}
function schedule() {
  if (!audio) return;
  // The beep is put out early by the device's own sound latency, so it is heard as the screen lights.
  const late = (audio.outputLatency || 0) + (audio.baseLatency || 0);
  while (next < audio.currentTime + 2) {
    const at = next, osc = audio.createOscillator(), gain = audio.createGain();
    osc.frequency.value = TONE; osc.connect(gain); gain.connect(audio.destination);
    gain.gain.setValueAtTime(0, Math.max(0, at - late));
    gain.gain.linearRampToValueAtTime(0.9, Math.max(0, at - late) + 0.002);
    gain.gain.setValueAtTime(0.9, Math.max(0, at - late) + FLASH - 0.002);
    gain.gain.linearRampToValueAtTime(0, Math.max(0, at - late) + FLASH);
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
    if (!audio) return;
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
}
document.getElementById('start').onclick = (event) => { event.stopPropagation(); start(); };
if (MANAGER) {
  document.querySelector('#words p').textContent = 'Turn this device’s sound up, press Start, and hold the screen where every camera sees and hears it, about an arm’s length from the nearest. The manager measures while it flashes, and it stops by itself when done (about 15 seconds).';
  document.getElementById('start').textContent = 'Start measuring';
}
