'use strict';
// The colour card (colourcard.html): what a phone or tablet shows the cameras to set white balance, exposure and a
// LUT by. The chart's colours come from the manager (/colour-chart.json, colour.py's CHART), so they are the ones the
// Colour page fits to; the rest is drawn here. Colours are set through the CSSOM: the page's policy allows no inline style.
(() => {
  const stage = document.getElementById('stage'), modes = document.getElementById('modes'), labels = document.getElementById('labels');
  const rgb = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const block = (cls, colour, name) => {
    const el = document.createElement('div'); el.className = cls; el.style.background = rgb(colour);
    if (name && labels.checked) { const n = document.createElement('span'); n.className = 'name'; n.textContent = name; el.append(n); }
    return el;
  };
  // sRGB, 8-bit, for a CIE lightness L* (D65): the grey scale is in even steps as the eye sees them.
  const greyFor = L => {
    const y = L > 8 ? ((L + 16) / 116) ** 3 : L / 903.3;
    const v = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255); return [n, n, n];
  };
  const GREY_CARD = [119, 119, 119];                 // an 18% grey card, L* 50 (colour.py's GREY_CARD)
  let chart = null;                                  // [[name, [r, g, b]], ...], 24 of them, row by row
  const SHOWS = {
    chart: ['Chart', () => {
      const grid = document.createElement('div'); grid.className = 'chart';
      grid.setAttribute('aria-label', 'Colour chart, 24 patches');
      if (!chart) { grid.append(document.createTextNode('Loading the chart…')); return grid; }
      for (const [name, colour] of chart) grid.append(block('patch', colour, name));
      return grid;
    }],
    grey: ['18% grey', () => block('solid', GREY_CARD, '18% grey (L* 50), for a white balance lock')],
    white: ['White', () => block('solid', [255, 255, 255], 'White')],
    steps: ['Grey scale', () => {
      const row = document.createElement('div'); row.className = 'steps';
      for (let L = 0; L <= 100; L += 10) row.append(block('step', greyFor(L), `L* ${L}`));
      return row;
    }],
    bars: ['Colour bars', () => {
      // 75% bars, as on a test signal, over the same colours at 100%.
      const COLOURS = [['white', [1, 1, 1]], ['yellow', [1, 1, 0]], ['cyan', [0, 1, 1]], ['green', [0, 1, 0]], ['magenta', [1, 0, 1]], ['red', [1, 0, 0]], ['blue', [0, 0, 1]]];
      const bars = document.createElement('div'); bars.className = 'bars';
      for (const [level, cls] of [[191, 'row'], [255, 'row full']]) {
        const row = document.createElement('div'); row.className = cls;
        for (const [name, on] of COLOURS) row.append(block('bar', on.map(v => v * level), `${name} ${level === 255 ? 100 : 75}%`));
        bars.append(row);
      }
      return bars;
    }],
    black: ['Black', () => block('solid', [0, 0, 0], '')],
  };
  const params = new URLSearchParams(location.search);
  let showing = SHOWS[params.get('show')] ? params.get('show') : 'chart';
  labels.checked = params.get('names') === '1';

  function paint() {
    stage.replaceChildren(SHOWS[showing][1]());
    for (const b of modes.children) b.setAttribute('aria-pressed', String(b.dataset.show === showing));
    // Kept in the address, so a page reloaded or shared shows the same card.
    const here = new URLSearchParams({ show: showing, ...(labels.checked ? { names: '1' } : {}) });
    history.replaceState(null, '', `${location.pathname}?${here}`);
  }
  for (const [key, [title]] of Object.entries(SHOWS)) {
    const b = document.createElement('button'); b.textContent = title; b.dataset.show = key;
    b.onclick = () => { showing = key; paint(); };
    modes.append(b);
  }
  labels.onchange = paint;
  stage.onclick = () => document.body.classList.toggle('bare');
  document.getElementById('full').onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (e) { /* not on every phone: tapping hides the controls instead */ }
    document.body.classList.add('bare');
  };
  // The screen stays on while the card is shown.
  const awake = async () => { try { await navigator.wakeLock.request('screen'); } catch (e) { /* the screen may dim; keep tapping it */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') awake(); });
  awake();
  paint();
  fetch('/colour-chart.json').then(r => r.json()).then(data => { chart = data.patches.map(p => [p.name, p.rgb]); paint(); })
    .catch(() => { stage.textContent = 'The chart could not be loaded: reload the page.'; });
})();
