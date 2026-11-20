'use strict';
// Search and the assistant (helpdesk.py), opened from the side bar's Search, with / or with Ctrl or ⌘ and K, on every
// page. One box: what is typed is looked for, as it is typed, among the places of the dashboard (a button, a setting,
// a section: choosing one opens its page and marks it there) and in the guide (the README and docs this installation
// came with, cut at their headings: choosing one opens it to read here). A question is also put to the assistant: the
// model on this computer answers it from the pieces of the guide and the places the search found, with those named
// under its answer. Where no model can be asked (No AI, or while it is choosing shots on air) the pieces themselves are
// shown. Nothing asked is kept: the conversation is this dialog's, gone when the page is left.
(() => {
const concert = window.concert;
const el = (tag, text, className) => { const made = document.createElement(tag); if (text != null) made.textContent = text; if (className) made.className = className; return made; };

// ---- the search: words, and how well a place or a piece of the guide answers them ---------------------------------------
const STOP = new Set(('a an and are as at be by can do does for from how i in is it me my of on or so that the there this to was what when where which who why will with ' +
                      'you your get got use using want need find show page button setting settings section').split(' '));
const stem = word => word.length > 4 ? word.replace(/(ing|ed|es|s)$/, '') : word.length > 3 ? word.replace(/s$/, '') : word;
const words = text => (String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ’']/g, '').match(/[a-z0-9]+/g) || []);
const terms = text => words(text).filter(w => !STOP.has(w)).map(stem);
const bag = text => { const counts = new Map(); for (const term of terms(text)) counts.set(term, (counts.get(term) || 0) + 1); return counts; };

let index = null;            // {places, sections, assistant, common: how many pieces each word is in}
function prepare(report) {
  const common = new Map();
  const sections = report.sections.map(section => {
    const run = terms(`${section.title} . ${section.text}`);
    const made = { ...section, head: bag(section.title), above: bag(`${section.doc || ''} ${section.trail.join(' ')}`), body: bag(section.text), run: ` ${run.join(' ')} `, size: run.length };
    for (const term of new Set([...made.head.keys(), ...made.body.keys()])) common.set(term, (common.get(term) || 0) + 1);
    return made;
  });
  const places = report.places.map(place => ({ ...place, head: bag(place.title), also: bag(place.words), said: bag(place.about) }));
  return { places, sections, assistant: report.assistant, common, usual: sections.reduce((sum, section) => sum + section.size, 0) / Math.max(1, sections.length) };
}
// How many times a bag has a word; the word still being typed (the last) also counts where it begins a longer one.
const has = (counts, term, open) => {
  const exact = counts.get(term) || 0;
  if (exact || !open || term.length < 2) return exact;
  let begun = 0; for (const [known, count] of counts) if (known.startsWith(term)) begun += count;
  return begun * 0.6;
};
function search(text) {
  const asked = terms(text), typing = !/\s$/.test(text);
  if (!asked.length) return { places: [], sections: [] };
  const rare = term => Math.log(1 + index.sections.length / (1 + (index.common.get(term) || 0)));
  const rank = (items, score) => items.map(item => {
    let total = 0, met = 0;
    asked.forEach((term, n) => { const got = score(item, term, typing && n === asked.length - 1); if (got > 0) { total += got; met += 1; } });
    // Every word found counts for far more than one word found often.
    return { item, score: met ? total * (met / asked.length) ** 2 : 0, met };
  }).filter(found => found.score > 0 && found.met >= Math.ceil(asked.length / 2)).sort((a, b) => b.score - a.score)
    .filter((found, n, all) => found.score >= all[0].score * 0.3);          // not what only brushes against the words, beside what answers them
  const places = rank(index.places, (place, term, open) => 6 * Math.min(1, has(place.head, term, open)) + 4 * Math.min(1, has(place.also, term, open)) + 2 * Math.min(1, has(place.said, term, open)));
  // The guide: a word counts for more the rarer it is and the shorter the piece it is found in (BM25), most of all in
  // the heading; and words found side by side, as they were typed, count for more than the same words apart.
  const pairs = asked.slice(1).map((term, n) => ` ${asked[n]} ${term}`);
  const sections = rank(index.sections, (section, term, open) => {
    const body = has(section.body, term, open), length = 0.25 + 0.75 * section.size / index.usual;
    return rare(term) * (4 * Math.min(1, has(section.head, term, open)) + 1.5 * Math.min(1, has(section.above, term, open)) + (body ? body * 2.2 / (body + 1.2 * length) : 0));
  }).map(found => ({ ...found, score: found.score * (1 + 1.5 * pairs.filter(pair => found.item.run.includes(pair)).length / Math.max(1, pairs.length)) })).sort((a, b) => b.score - a.score);
  // One piece of a section is enough in the list: its best.
  const seen = new Set(), pieces = sections.filter(({ item }) => { const key = `${item.file}#${item.anchor}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return { places: places.map(found => found.item), sections: pieces.map(found => found.item), every: sections.map(found => found.item) };
}
const question = text => /\?\s*$/.test(text) || /^\s*(how|what|why|when|where|which|who|can|could|does|do|is|are|should|will)\b/i.test(text) || words(text).length >= 4;

// ---- the guide's Markdown, as much of it as the guide uses, made into elements (never markup from text) --------------
function inline(into, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]*\)|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) into.append(text.slice(last, match.index));
    const part = match[0];
    if (part.startsWith('**')) { const strong = el('strong'); inline(strong, part.slice(2, -2)); into.append(strong); }
    else if (part.startsWith('`')) into.append(el('code', part.slice(1, -1)));
    else if (part.startsWith('[')) {
      // A link to another part of the guide opens it here; any other is its words alone.
      const [, said, href] = part.match(/^\[([^\]]+)\]\(([^)]*)\)$/);
      const target = guideLink(href);
      if (target) { const link = el('button', null, 'help-link'); link.type = 'button'; inline(link, said); link.onclick = () => read(target); into.append(link); }
      else inline(into, said);
    }
    else { const em = el('em'); inline(em, part.slice(1, -1)); into.append(em); }
    last = match.index + part.length;
  }
  if (last < text.length) into.append(text.slice(last));
}
let reading = null;          // the piece of the guide being read, for the links within it
function guideLink(href) {
  if (/^[a-z]+:/i.test(href)) return null;
  const [path, anchor] = href.split('#');
  const from = reading ? reading.file : 'README.md';
  const file = !path ? from : path.startsWith('docs/') ? path : from.startsWith('docs/') && !path.includes('/') ? (path === 'README.md' ? path : `docs/${path}`) : path.replace(/^\.\.\//, '');
  return index.sections.find(section => section.file === file && (!anchor || section.anchor === anchor)) || null;
}
function markdown(text) {
  const out = document.createDocumentFragment(), lines = text.split('\n');
  let n = 0;
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  while (n < lines.length) {
    const line = lines[n];
    if (!line.trim()) { n += 1; continue; }
    if (line.trim().startsWith('```')) {
      const code = []; n += 1;
      while (n < lines.length && !lines[n].trim().startsWith('```')) code.push(lines[n++]);
      n += 1; out.append(el('pre', code.join('\n'))); continue;
    }
    if (line.trim().startsWith('|')) {
      const table = el('table'), rows = [];
      while (n < lines.length && lines[n].trim().startsWith('|')) rows.push(cells(lines[n++]));
      rows.filter(row => !row.every(cell => /^:?-{2,}:?$/.test(cell))).forEach((row, r) => { const tr = el('tr'); for (const cell of row) { const td = el(r ? 'td' : 'th'); inline(td, cell); tr.append(td); } table.append(tr); });
      const wrap = el('div', null, 'help-table'); wrap.append(table); out.append(wrap); continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+/;
    if (item.test(line)) {
      const list = el(/^\s*\d+\./.test(line) ? 'ol' : 'ul');
      while (n < lines.length && (item.test(lines[n]) || (/^\s+\S/.test(lines[n]) && list.lastChild))) {
        if (item.test(lines[n])) { const li = el('li'); li.dataset.text = lines[n].replace(item, ''); list.append(li); }
        else list.lastChild.dataset.text += ` ${lines[n].trim()}`;
        n += 1;
      }
      for (const li of list.children) { inline(li, li.dataset.text); delete li.dataset.text; }
      out.append(list); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { const h = el('h4'); inline(h, heading[2]); out.append(h); n += 1; continue; }
    const para = [];
    while (n < lines.length && lines[n].trim() && !lines[n].trim().startsWith('```') && !lines[n].trim().startsWith('|') && !item.test(lines[n])) para.push(lines[n++].trim());
    const p = el('p'); inline(p, para.join(' ').replace(/^>\s*/, '')); out.append(p);
  }
  return out;
}

// ---- the dialog ---------------------------------------------------------------------------------------------------------
let dialog, box, list, note, view = 'results', history = [], asking = false, picked = 0, shown = [];
const pageOf = path => {
  const [base, tab] = path.split('#'), page = concert.pages.find(p => p[0] === (concert.under[base] || base));
  const sub = tab ? concert.systemTabs.find(([href]) => href === path)?.[1] : base === '/recordings' ? 'PC recordings' : null;
  return `${page ? page[1] : base}${sub ? ` › ${sub}` : ''}`;
};
const onlyIn = path => {
  const kind = concert.onlyIn[path.split('#')[0]];
  if (!kind || concert.mode?.mode === kind) return '';
  return ` · in a ${concert.mode?.modes?.find(mode => mode.id === kind)?.name || kind} event`;
};
// Where a part of the guide is: its document and the headings over it (not its own, where it is the document's first).
const above = section => [section.doc, ...section.trail].filter(each => each && each !== section.title).join(' › ');
function build() {
  dialog = el('dialog'); dialog.id = 'help'; dialog.setAttribute('aria-label', 'Search and the assistant');
  const top = el('form', null, 'help-top'); top.method = 'dialog'; top.onsubmit = event => { event.preventDefault(); choose(); };
  box = el('input'); box.type = 'search'; box.id = 'help-box'; box.placeholder = 'Find a button or a setting, or ask how something is done'; box.autocomplete = 'off'; box.spellcheck = false; box.maxLength = 400;
  box.setAttribute('aria-label', 'Search the dashboard and its guide'); box.setAttribute('aria-controls', 'help-list');
  const shut = el('button', '×', 'help-close'); shut.type = 'button'; shut.setAttribute('aria-label', 'Close the search'); shut.onclick = () => dialog.close();
  top.append(box, shut);
  list = el('div', null, 'help-list'); list.id = 'help-list';
  note = el('p', null, 'help-note');
  dialog.append(top, list, note); document.body.append(dialog);
  box.oninput = () => { view = 'results'; picked = 0; draw(); };
  box.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (view !== 'results' || !shown.length) return; picked = (picked + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; mark(); }
  };
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });      // a press on the dimmed page behind it
}
const mark = () => { shown.forEach((row, n) => { row.classList.toggle('picked', n === picked); if (n === picked) { row.scrollIntoView({ block: 'nearest' }); box.setAttribute('aria-activedescendant', row.id); } }); };
function row(kind, title, under, act) {
  const made = el('button', null, `help-row ${kind}`); made.type = 'button'; made.id = `help-row-${shown.length}`;
  made.innerHTML = concert.icon(kind === 'place' ? 'go' : kind === 'ask' ? 'ask' : 'guide');
  const text = el('span', null, 'help-words'); text.append(el('strong', title), el('small', under)); made.append(text);
  made.onclick = act; shown.push(made); return made;
}
function draw() {
  const text = box.value;
  shown = []; list.replaceChildren(); reading = null;
  // Typed into before the manager has answered with what there is to search: drawn once it has (open()).
  if (!index) { list.append(el('p', 'Reading the guide…', 'help-waiting')); return; }
  const ready = index.assistant.ready;
  note.textContent = ready ? 'Answers come from the guide, written by the model on this computer. They can be wrong: the guide’s own words are a press away.' : index.assistant.why;
  if (!text.trim()) {
    list.append(el('p', 'Try what you are looking for, in your own words:', 'help-hint'));
    const tries = el('div', null, 'help-tries');
    for (const example of ['record the programme', 'pair a gimbal', 'shot length', 'How do I add a phone?', 'What does Arm do?']) { const chip = el('button', example); chip.type = 'button'; chip.onclick = () => { box.value = example; box.focus(); draw(); }; tries.append(chip); }
    list.append(tries);
    if (history.length) { const back = el('button', 'Back to the conversation', 'help-back'); back.type = 'button'; back.onclick = talk; list.append(back); }
    return;
  }
  const found = search(text);
  const asks = question(text) || (!found.places.length && !found.sections.length);
  const ask = () => put(text, found);
  // A question is the assistant's first; anything else is somewhere to go first, and may be asked about as well.
  const askRow = () => list.append(row('ask', ready ? `Ask the assistant: “${text.trim()}”` : `What the guide says about “${text.trim()}”`, ready ? 'Answered from the guide by the model on this computer' : 'The parts of the guide that match, to read here', ask));
  if (asks) askRow();
  if (found.places.length) { list.append(el('h3', 'Go to')); for (const place of found.places.slice(0, 6)) list.append(row('place', place.title, `${pageOf(place.path)}${onlyIn(place.path)} · ${place.about}`, () => go(place))); }
  if (found.sections.length) { list.append(el('h3', 'In the guide')); for (const section of found.sections.slice(0, 6)) list.append(row('guide', section.title, above(section), () => read(section))); }
  if (!asks) askRow();
  if (!found.places.length && !found.sections.length) list.append(el('p', 'Nothing on the dashboard or in the guide matches those words. Try others, or fewer.', 'help-hint'));
  picked = Math.min(picked, shown.length - 1); mark();
}
function choose() {
  if (view !== 'results') { if (box.value.trim()) { view = 'results'; draw(); if (shown.length) shown[0].click(); } return; }
  shown[picked]?.click();
}
function go(place) { dialog.close(); concert.goTo(place.path, place.find); }

/** A section of the guide, whole (every piece of it), to read here. */
function read(section) {
  view = 'reading'; reading = section; list.replaceChildren(); shown = [];
  const back = el('button', '‹ Back', 'help-back'); back.type = 'button'; back.onclick = () => { if (history.length && !box.value.trim()) talk(); else { view = 'results'; draw(); } };
  const whole = index.sections.filter(each => each.file === section.file && each.anchor === section.anchor);
  const article = el('article', null, 'help-read');
  article.append(el('p', above(section), 'help-trail'), el('h3', section.title));
  for (const piece of whole) article.append(markdown(piece.text));
  // What follows in the same document, to read on.
  const after = index.sections[index.sections.indexOf(whole[whole.length - 1]) + 1];
  list.append(back, article);
  if (after && after.file === section.file) { const next = el('button', `Next: ${after.title} ›`, 'help-back'); next.type = 'button'; next.onclick = () => read(after); list.append(next); }
  list.scrollTop = 0;
}

/** Puts a question to the assistant, with what the search found for it. */
async function put(text, found) {
  if (asking) return;
  const asked = text.trim(), sections = (found.every || found.sections).slice(0, 4), places = found.places.slice(0, 5);
  const turn = { question: asked, answer: null, why: null, sections, places, waiting: true };
  history.push(turn); box.value = ''; asking = true; talk();
  try {
    const { response, data } = await concert.fetchJson('/api/help/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': concert.session?.csrf || '' },
      body: JSON.stringify({ question: asked.slice(0, 400), sections: sections.map(s => s.id), places: places.map(p => p.title), history: history.slice(0, -1).filter(t => t.answer).slice(-2).map(t => ({ question: t.question, answer: t.answer })) }) });
    if (!response.ok) throw new Error(data.detail || `The manager answered ${response.status}`);
    turn.answer = data.answer; turn.why = data.why;
    if (!data.answer && data.why) index.assistant = { ready: false, why: data.why };
  } catch (error) { turn.why = `The question could not be asked: ${error.message}`; }
  turn.waiting = false; asking = false;
  if (dialog.open && view === 'talk') talk();
}
/** The conversation: each question, its answer, where to go for it and where in the guide it came from. */
function talk() {
  view = 'talk'; list.replaceChildren(); shown = []; reading = null;
  for (const turn of history) {
    const said = el('div', null, 'help-turn');
    said.append(el('p', turn.question, 'help-asked'));
    if (turn.waiting) said.append(el('p', 'Reading the guide…', 'help-waiting'));
    else if (turn.answer) { const answer = el('div', null, 'help-answer'); answer.append(markdown(turn.answer)); said.append(answer); }
    else {
      // No words from a model: the guide's own, the best piece open.
      if (turn.why) said.append(el('p', turn.why, 'help-why'));
      if (turn.sections[0]) { const answer = el('div', null, 'help-answer guide'); answer.append(el('p', [above(turn.sections[0]), turn.sections[0].title].filter(Boolean).join(' › '), 'help-trail'), markdown(turn.sections[0].text)); said.append(answer); }
      else if (!turn.places.length) said.append(el('p', 'Nothing in the guide matches those words.', 'help-hint'));
    }
    if (!turn.waiting && (turn.places.length || turn.sections.length)) {
      const more = el('div', null, 'help-more');
      for (const place of turn.places.slice(0, 3)) { const chip = el('button', `Go to: ${place.title}`, 'place'); chip.type = 'button'; chip.title = `${pageOf(place.path)} · ${place.about}`; chip.onclick = () => go(place); more.append(chip); }
      const seen = new Set();
      for (const section of turn.sections) { const key = `${section.file}#${section.anchor}`; if (seen.has(key)) continue; seen.add(key); const chip = el('button', `Guide: ${section.title}`); chip.type = 'button'; chip.title = above(section); chip.onclick = () => read(section); more.append(chip); }
      said.append(more);
    }
    list.append(said);
  }
  const clear = el('button', 'Clear the conversation', 'help-back'); clear.type = 'button'; clear.onclick = () => { history = []; view = 'results'; draw(); box.focus(); };
  if (!asking) list.append(clear);
  box.placeholder = 'Ask something else, or search';
  // The latest question at the top of what is seen, so its answer is read from its beginning.
  [...list.querySelectorAll('.help-turn')].pop()?.scrollIntoView({ block: 'start' }); box.focus();
}

window.concertHelp = {
  async open() {
    if (!dialog) build();
    if (dialog.open) { box.focus(); box.select(); return; }
    dialog.showModal();
    if (!index) draw();
    try {
      // Read each time it is opened: whether the assistant answers changes with the show (on air, the AI level).
      const { response, data } = await concert.fetchJson('/api/help');
      if (!response.ok) throw new Error(data.detail || `The manager answered ${response.status}`);
      index = prepare(data);
    } catch (error) {
      if (!index) { list.replaceChildren(el('p', `The search could not be read: ${error.message}`, 'help-why')); return; }
    }
    const typed = document.activeElement === box && box.value;          // typed while it was being read: left as it is
    if (view === 'talk' && history.length && !typed) talk(); else { view = 'results'; draw(); }
    box.focus(); if (!typed) box.select();
  },
};
})();
