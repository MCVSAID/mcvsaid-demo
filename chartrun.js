'use strict';
// The chart a colour calibration reads from a phone's screen (calibrate.py): black, the patch area lit white, the
// chart, each as the manager asks for it and said back once it is on the screen. Shared by the calibrate page's colour
// run (calibrate.js) and the colour step of its camera-by-camera run (syncflash.js); each page has #run, holding
// #area and #step.
//
// The manager finds the patch area by lighting it, then reads the patches where it found them, so the area must not
// move once the first step is shown. On a phone it can: a browser bar comes or goes, or the phone is turned
// (2026-11-20: the page then said "press Stop and start again" over a run that went on regardless). The page is told
// (onMoved) and tells the manager (POST /api/calibrate/moved), which gives up what it was reading.
window.chartRun = (() => {
  const $ = id => document.getElementById(id);
  let chart = null, painted = 0, placed = '', moved = false;
  const shape = () => `${innerWidth}x${innerHeight}`;
  const run = { onMoved: null, ready: () => !!chart, open: () => !$('run').hidden };

  function place() {
    // The patch area, 3:2, as large as fits with room round it; each of its 6 x 4 cells holds a patch in its middle,
    // as the Colour page samples a chart (colour.chart_patches: the middle half of each cell).
    const vw = innerWidth, vh = innerHeight, margin = Math.round(Math.min(vw, vh) * 0.05);
    const room = { w: vw - 2 * margin, h: vh - 2 * margin - 64 };
    const w = Math.floor(Math.min(room.w, room.h * 1.5)), h = Math.floor(w / 1.5);
    Object.assign($('area').style, { width: `${w}px`, height: `${h}px`, left: `${Math.round((vw - w) / 2)}px`, top: `${Math.round((vh - h) / 2)}px` });
    placed = shape();
  }

  function patches() {
    const area = $('area');
    if (area.children.length || !chart) return;
    chart.forEach(([name, rgb], i) => {
      const patch = document.createElement('div'); patch.className = 'patch'; patch.title = name; patch.hidden = true;
      const col = i % 6, row = Math.floor(i / 6);
      Object.assign(patch.style, { left: `${(col + 0.1) / 6 * 100}%`, top: `${(row + 0.1) / 4 * 100}%`, width: `${0.8 / 6 * 100}%`, height: `${0.8 / 4 * 100}%`, background: `rgb(${rgb.join(',')})` });
      area.append(patch);
    });
  }

  // The page given over to the chart, black, before the manager asks for anything.
  run.begin = said => {
    if (run.open()) return;
    $('run').hidden = false; document.body.classList.add('running');
    $('area').classList.remove('lit'); $('area').replaceChildren();
    painted = 0; moved = false;
    $('step').textContent = said || '';
    place();
  };

  // What the manager's run asks for now (run.show: black, locate or chart), drawn; `shown(step)` once it is on screen.
  run.show = (state, shown) => {
    run.begin(state.said);
    if (!moved) $('step').textContent = state.said;
    if (moved || state.step <= painted || !state.show) return;
    const area = $('area');
    patches();
    if (state.show === 'chart' && !area.children.length) return;      // the chart has not loaded: asked again in a moment
    area.classList.toggle('lit', state.show === 'locate');
    // Dimmer when the manager says so (run.dim): cameras matched to one another need the same chart, not a bright one.
    for (const patch of area.children) { patch.hidden = state.show !== 'chart'; patch.style.opacity = state.dim ?? 1; }
    painted = state.step;
    // Said back once it is on the screen: two frames later, so the change has been drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => shown(state.step)));
  };

  run.leave = () => {
    if (!run.open()) return;
    $('run').hidden = true; document.body.classList.remove('running'); painted = 0; moved = false;
  };

  // Resolves once the page has kept one size for a moment (a browser bar that shows itself as the page stops
  // scrolling has done so), or after a second and a half.
  run.settled = () => new Promise(resolve => {
    let quiet = null;
    const done = () => { removeEventListener('resize', again); clearTimeout(quiet); clearTimeout(limit); resolve(); };
    const again = () => { clearTimeout(quiet); quiet = setTimeout(done, 350); };
    const limit = setTimeout(done, 1500);
    addEventListener('resize', again); again();
  });

  addEventListener('resize', () => {
    if (!run.open() || shape() === placed) return;
    if (!painted) { place(); return; }             // nothing shown yet: placed again for the screen as it is now
    if (moved) return;
    moved = true; $('step').textContent = 'The screen changed size: starting that again';
    if (run.onMoved) run.onMoved();
  });

  fetch('/colour-chart.json').then(r => r.json()).then(data => { chart = data.patches.map(p => [p.name, p.rgb]); }).catch(() => {});
  return run;
})();
