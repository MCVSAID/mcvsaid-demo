// The host's recipe page (kitchen.html). Asks the manager for the recipe being cooked and where the cooking is
// (/api/kitchen) every couple of seconds, so the operator's moves and the director's own show here too; Next and Back
// (buttons, a swipe, or the arrow keys) move that place for everyone (/api/kitchen/step), and its On screen buttons show or put away the recipe card and pop the step's name up on the
// programme (/api/kitchen/screen). What is this device's alone
// is kept in it: the ingredients ticked, the timers running and the text size.
(() => {
  const $ = id => document.getElementById(id);
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem('kitchen.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem('kitchen.' + key, JSON.stringify(value)); } catch (e) { /* kept for this visit only */ } },
  };
  let state = null, view = 'step', busy = false, lastOk = Date.now();
  let scale = store.get('scale', 1);
  let timers = store.get('timers', []);          // [{id, label, ends, seconds, rang}]

  // -- text size --------------------------------------------------------------------------------------------------
  const setScale = value => { scale = Math.min(1.8, Math.max(0.8, Math.round(value * 10) / 10)); document.documentElement.style.setProperty('--scale', scale); store.set('scale', scale); };
  setScale(scale);
  $('smaller').onclick = () => setScale(scale - 0.1);
  $('larger').onclick = () => setScale(scale + 0.1);

  // -- views ------------------------------------------------------------------------------------------------------
  const show = name => {
    view = name;
    for (const tab of document.querySelectorAll('#views [role=tab]')) tab.setAttribute('aria-selected', String(tab.dataset.view === name));
    for (const v of ['step', 'ingredients', 'all']) $('view-' + v).hidden = v !== name || !state?.recipe;
  };
  for (const tab of document.querySelectorAll('#views [role=tab]')) tab.onclick = () => show(tab.dataset.view);

  // -- times named in a step ("boil for 3 minutes", "at least 30 minutes", "two hours") ------------------------------
  const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    fifteen: 15, twenty: 20, 'twenty-five': 25, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90, half: 0.5 };
  const UNIT = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };
  const NUMBER = `(\\d+(?:[.,]\\d+)?|${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})`;
  const TIME = new RegExp(`\\b${NUMBER}(?:\\s*(?:-|–|to|or)\\s*${NUMBER})?(?:\\s+an?)?\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b`, 'gi');
  const value = word => WORDS[word.toLowerCase()] ?? parseFloat(word.replace(',', '.'));
  const times = text => {
    const found = [], seen = new Set();
    for (const match of String(text || '').matchAll(TIME)) {
      const low = value(match[1]), high = match[2] ? value(match[2]) : null, unit = UNIT[match[3].toLowerCase()];
      if (!(low > 0) || !unit) continue;
      const seconds = Math.round(low * unit);
      if (seen.has(seconds) || seconds > 6 * 3600) continue;
      seen.add(seconds);
      const short = match[3].toLowerCase().startsWith('h') ? 'hr' : match[3].toLowerCase().startsWith('s') ? 'sec' : 'min';
      const say = n => String(Math.round(n * 10) / 10);
      found.push({ seconds, label: `${say(low)}${high ? '–' + say(high) : ''} ${short}` });
    }
    return found;
  };
  const clock = seconds => {
    seconds = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
  };

  // -- timers -------------------------------------------------------------------------------------------------------
  let audio = null;
  const beep = () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 3; i++) {
        const tone = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.35;
        tone.frequency.value = 880; gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
        tone.connect(gain).connect(audio.destination); tone.start(at); tone.stop(at + 0.3);
      }
    } catch (e) { /* no sound here: the timer still flashes */ }
    try { navigator.vibrate?.([300, 150, 300]); } catch (e) { /* no vibration */ }
  };
  const saveTimers = () => store.set('timers', timers);
  const startTimer = (seconds, label) => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch (e) { /* sound starts on a tap, where allowed */ }
    timers.push({ id: Date.now() + Math.random(), label, seconds, ends: Date.now() + seconds * 1000, rang: false });
    saveTimers(); drawTimers();
  };
  const drawTimers = () => {
    const box = $('timers'); box.replaceChildren();
    for (const timer of timers) {
      const left = (timer.ends - Date.now()) / 1000;
      if (left <= 0 && !timer.rang) { timer.rang = true; saveTimers(); beep(); }
      const pill = document.createElement('span');
      pill.className = 'timer' + (timer.rang ? ' rang' : '');
      const words = document.createElement('span');
      words.textContent = timer.rang ? `${timer.label}: done` : `${timer.label} · ${clock(left)}`;
      const more = document.createElement('button');
      more.textContent = '+1'; more.setAttribute('aria-label', 'One more minute');
      more.onclick = () => { timer.ends = Math.max(timer.ends, Date.now()) + 60000; timer.rang = false; saveTimers(); drawTimers(); };
      const stop = document.createElement('button');
      stop.textContent = '✕'; stop.setAttribute('aria-label', timer.rang ? 'Dismiss timer' : 'Stop timer');
      stop.onclick = () => { timers = timers.filter(t => t !== timer); saveTimers(); drawTimers(); };
      pill.append(words, more, stop);
      box.append(pill);
    }
  };
  setInterval(() => { if (timers.length) drawTimers(); }, 500);

  // -- ingredients ticked, by recipe ----------------------------------------------------------------------------------
  const tickKey = () => 'ticked.' + (state?.recipe?.title || '');
  const checklist = (list, items, prefix) => {
    const ticked = new Set(store.get(tickKey(), []));
    list.replaceChildren(...items.map((item, n) => {
      const li = document.createElement('li'), label = document.createElement('label'), box = document.createElement('input'), words = document.createElement('span');
      box.type = 'checkbox'; box.checked = ticked.has(prefix + n + ':' + item);
      box.onchange = () => {
        const now = new Set(store.get(tickKey(), []));
        box.checked ? now.add(prefix + n + ':' + item) : now.delete(prefix + n + ':' + item);
        store.set(tickKey(), [...now]); counted();
      };
      words.textContent = item; label.append(box, words); li.append(label); return li;
    }));
  };
  const counted = () => {
    const all = state?.recipe?.ingredients?.length || 0;
    const have = [...$('ingredients').querySelectorAll('input')].filter(b => b.checked).length;
    $('have').textContent = all ? `${have}/${all}` : '';
  };
  $('untick').onclick = () => { store.set(tickKey(), []); drawIngredients(); };
  let drawnIngredients = '';
  const drawIngredients = () => {
    const recipe = state.recipe;
    checklist($('ingredients'), recipe.ingredients, 'i');
    checklist($('equipment'), recipe.equipment, 'e');
    $('equipment-title').hidden = !recipe.equipment.length;
    drawnIngredients = JSON.stringify([recipe.title, recipe.ingredients, recipe.equipment]);
    counted();
  };

  // -- drawing the recipe ---------------------------------------------------------------------------------------------
  const draw = () => {
    const recipe = state?.recipe;
    $('empty').hidden = !!recipe;
    $('views').hidden = !recipe;
    if (!recipe) {
      $('title').textContent = 'Recipe'; $('where').textContent = state?.cooking === false ? 'The manager is not in Cooking mode' : '';
      $('controls').hidden = true; $('follow').hidden = true; show(view); return;
    }
    const steps = state.steps, at = state.current ? steps[state.current - 1] : null;
    $('title').textContent = recipe.title; document.title = recipe.title;
    $('where').textContent = state.finished ? 'All done' : at ? `${at.label} of ${steps.filter(s => s.section === at.section).length}` + (at.section === 'prep' ? ' (prep)' : '') : `${steps.length} steps`;
    if (JSON.stringify([recipe.title, recipe.ingredients, recipe.equipment]) !== drawnIngredients) drawIngredients();

    $('view-step').classList.toggle('before', !at);
    if (at) {
      $('label').textContent = at.label + (state.finished ? ' · done' : '');
      $('short').hidden = !at.short; $('short').textContent = at.short || '';
      $('text').textContent = at.text;
    } else {
      $('label').textContent = 'Ready when you are';
      $('short').hidden = false; $('short').textContent = recipe.title;
      $('text').textContent = `${recipe.ingredients.length} ingredients, ${steps.length} steps. Check the ingredients, then press Start.`;
    }
    const chips = $('step-timers'); chips.replaceChildren();
    for (const t of at ? times(at.text) : []) {
      const chip = document.createElement('button'); chip.className = 'chip';
      chip.textContent = `⏱ Start ${t.label}`;
      chip.onclick = () => startTimer(t.seconds, `${at.label} · ${t.label}`);
      chips.append(chip);
    }
    const index = state.current ? state.current - 1 : -1;
    const coming = steps.slice(index + 1).find(s => s.status === 'to come');
    $('upnext').hidden = !coming || !at;
    if (coming) { $('upnext-label').textContent = coming.label + ':'; $('upnext-text').textContent = coming.short || coming.text; }

    $('all').replaceChildren(...steps.map((step, n) => {
      const li = document.createElement('li'), button = document.createElement('button');
      button.className = step.status === 'current' || n === index ? 'current' : step.status;
      const number = document.createElement('span'); number.className = 'n'; number.textContent = step.label;
      const words = document.createElement('span'); words.className = 't'; words.textContent = step.short || step.text;
      button.append(number, words);
      button.disabled = !state.can_move;
      button.onclick = () => { move(n + 1); show('step'); };
      li.append(button); return li;
    }));

    const screen = state.screen || {};
    $('screen').hidden = !screen.allowed;
    $('screen-note').textContent = !state.cooking ? '(the manager is not in Cooking mode)' : screen.in_obs ? '' : '(the overlay is not in OBS yet)';
    $('card').textContent = screen.card_up ? 'Hide recipe' : 'Show recipe';
    $('card').setAttribute('aria-pressed', String(!!screen.card_up));
    $('card').disabled = busy || !state.cooking;
    $('pop').disabled = busy || !at || !state.cooking;
    $('moves').hidden = !state.can_move;
    $('controls').hidden = !state.can_move && !screen.allowed; $('follow').hidden = state.can_move || !!screen.allowed;
    document.body.style.setProperty('--foot', ($('controls').hidden ? 3.5 : (screen.allowed ? 4.5 : 0) + (state.can_move ? 5 : 0) + 1.5) + 'em');
    $('back').disabled = busy || !at || index === 0;
    $('next').disabled = busy || state.finished;
    $('next').textContent = !at ? 'Start ›' : coming ? 'Next ›' : 'Finish ✓';
    show(view);
  };

  // -- the manager ---------------------------------------------------------------------------------------------------
  const said = text => { $('said').textContent = text || ''; };
  const load = async () => {
    try {
      const reply = await fetch('/api/kitchen', { cache: 'no-store' });
      if (!reply.ok) throw new Error(reply.status);
      const fresh = await reply.json();
      lastOk = Date.now(); $('link').classList.remove('lost'); $('link').title = 'Connected to the manager';
      if (!busy) { state = fresh; draw(); }
    } catch (e) {
      if (Date.now() - lastOk > 5000) { $('link').classList.add('lost'); $('link').title = 'Not reaching the manager'; }
    }
  };
  const move = async go => {
    if (busy || !state?.can_move) return;
    busy = true; said(''); draw();
    try {
      const reply = await fetch('/api/kitchen/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ go }) });
      const body = await reply.json().catch(() => ({}));
      if (!reply.ok) throw new Error(body.detail || `The manager said no (${reply.status})`);
      state = body;
    } catch (e) { said(e.message === 'Failed to fetch' ? 'Not reaching the manager: try again' : e.message); }
    busy = false; draw();
  };
  const onScreen = async what => {
    if (busy || !state?.screen?.allowed) return;
    busy = true; said(''); draw();
    try {
      const reply = await fetch('/api/kitchen/screen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(what) });
      const body = await reply.json().catch(() => ({}));
      if (!reply.ok) throw new Error(body.detail || `The manager said no (${reply.status})`);
      state = body;
      if (what.pop) said('');
    } catch (e) { said(e.message === 'Failed to fetch' ? 'Not reaching the manager: try again' : e.message); }
    busy = false; draw();
  };
  $('card').onclick = () => onScreen({ card: state?.screen?.card_up ? 'hide' : 'show' });
  $('pop').onclick = () => onScreen({ pop: true });
  $('next').onclick = () => move('next');
  $('back').onclick = () => move('back');
  document.addEventListener('keydown', e => {
    if (e.target.closest('input')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); move('next'); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); move('back'); }
  });
  // A swipe across the step: left for Next, right for Back.
  let touch = null;
  $('view-step').addEventListener('touchstart', e => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() } : null; }, { passive: true });
  $('view-step').addEventListener('touchend', e => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && Date.now() - touch.at < 800) move(dx < 0 ? 'next' : 'back');
    touch = null;
  });

  // -- the screen kept awake on the counter --------------------------------------------------------------------------
  const awake = async () => { try { if (document.visibilityState === 'visible') await navigator.wakeLock?.request('screen'); } catch (e) { /* the screen may dim */ } };
  document.addEventListener('visibilitychange', () => { awake(); if (document.visibilityState === 'visible') load(); });
  awake();

  drawTimers(); load(); setInterval(load, 2000);
})();
