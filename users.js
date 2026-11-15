'use strict';
// The Users page (administrators only): the named accounts that can log in, each with one role (users.py). Adding,
// renaming, a new password, another role, removing; each takes effect at once for whoever is logged in to it.
const result = document.querySelector('#result');
let state = null;

function el(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.concert.session?.csrf || '' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.detail || `HTTP ${response.status}`);
  return data;
}
// A password made here, shown until the page is left: the manager cannot show it again.
function showOnce(who, password) {
  const box = document.querySelector('#once');
  box.replaceChildren(el('h3', `Password for ${who}`), el('p', password), el('p', 'Hand it over or write it down now: it is not kept anywhere and cannot be shown again.'));
  box.hidden = false;
}
async function act(call, who) {
  try {
    result.textContent = '';
    const answer = await call();
    if (answer?.users) { state = answer; draw(); }
    if (answer?.password_once) showOnce(who, answer.password_once);
    if (answer?.backups_once) showBackups(who, answer.backups_once);
    return answer;
  } catch (error) { concert.fail(error); return null; }
}
// Backup codes for a lost phone, shown until the page is left: only their hashes are kept.
function showBackups(who, codes) {
  const box = document.querySelector('#once'), list = el('ul');
  for (const code of codes) list.append(el('li', code));
  box.replaceChildren(el('h3', `Backup codes for ${who}`), list, el('p', 'Each opens one login from the network in place of the authenticator code, for a lost or flat phone. Write them down or keep them in a password manager now: they cannot be shown again.'));
  box.hidden = false;
}
const gadget = text => /iPad/.test(text) ? 'iPad' : /iPhone/.test(text) ? 'iPhone' : /Android/.test(text) ? 'Android device' : /Macintosh/.test(text) ? 'Mac' : /Windows/.test(text) ? 'Windows PC' : /Linux/.test(text) ? 'Linux PC' : 'a browser';

// An administrator's authenticator code (twofactor.py): set up by scanning a QR code, then checked with the first code.
async function setUpCode(user, who) {
  const started = await act(() => api(`/api/users/${user.id}/second-step`, { start: true }), who);
  if (!started) return;
  const box = document.querySelector('#once'), picture = el('img'); picture.src = `${started.qr}?${Date.now()}`; picture.alt = 'QR code for the authenticator app'; picture.className = 'qr';
  box.replaceChildren(el('h3', `Authenticator code for ${who}`), el('p', 'Scan this with an authenticator app (Google or Microsoft Authenticator, 1Password, Authy…). Or type the key instead:'), el('p', started.secret.replace(/(.{4})/g, '$1 ').trim(), 'key'), picture);
  const form = el('form', null, 'row'), label = el('label', 'Then type the code it shows '), input = el('input');
  input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.maxLength = 20; input.required = true; label.append(input);
  const go = el('button', 'Set it up'), cancel = el('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => { box.hidden = true; };
  form.append(label, go, cancel);
  form.onsubmit = async event => {
    event.preventDefault();
    // Checked, the box shows the backup codes in its place (showBackups); wrong, it stays for another try.
    if (await act(() => api(`/api/users/${user.id}/second-step`, { code: input.value }), who)) result.textContent = `Authenticator code set up for ${who}.`;
  };
  box.append(form, el('p', `${user.you ? 'Your' : `${who}’s`} other logins from the network are logged out, and devices trusted before are forgotten.`, 'hint'));
  box.hidden = false; input.focus();
}

function secondStep(user, who) {
  const cell = el('td'), step = user.second_step || { code: false, backups_left: 0, devices: [] };
  if (user.role !== 'admin') return cell;
  if (!step.code) {
    cell.append(el('small', 'No code: an administrator at this PC only. '));
    const set = el('button', 'Set up a code…'); set.type = 'button'; set.onclick = () => setUpCode(user, who); cell.append(set);
    return cell;
  }
  cell.append(el('small', `Code set up; ${step.backups_left} backup code${step.backups_left === 1 ? '' : 's'} left. `));
  const again = el('button', 'New code…'); again.type = 'button';
  again.onclick = async () => { if (await concert.sure(`Set up a new authenticator code for ${who}?
The present one stops working once the new one is checked.`, { ok: 'Go on' })) setUpCode(user, who); };
  const backups = el('button', 'New backup codes'); backups.type = 'button';
  backups.onclick = async () => { if (await concert.sure(`Make ten new backup codes for ${who}?
The ones from before stop working.`, { ok: 'Make them' })) act(() => api(`/api/users/${user.id}/second-step`, { backups: 'new' }), who); };
  const remove = el('button', 'Remove code'); remove.type = 'button'; remove.className = 'danger';
  remove.onclick = async () => { if (await concert.sure(`Remove ${who}’s authenticator code?
They can then administer only at this PC; logged in from the network, they are an operator at once.`, { ok: 'Remove', danger: true })) act(() => api(`/api/users/${user.id}/second-step`, { remove: true }), who); };
  cell.append(again, backups, remove);
  if (step.devices.length) {
    const list = el('ul', null, 'devices');
    for (const device of step.devices) {
      const line = el('li', `Trusted: ${gadget(device.device)}, since ${day(device.since)}, last used ${day(device.seen)}, until ${day(device.until)} `);
      const forget = el('button', 'Forget'); forget.type = 'button'; forget.onclick = () => act(() => api(`/api/users/${user.id}/second-step`, { forget: device.id }), who);
      line.append(forget); list.append(line);
    }
    if (step.devices.length > 1) { const all = el('button', 'Forget them all'); all.type = 'button'; all.onclick = () => act(() => api(`/api/users/${user.id}/second-step`, { forget: 'all' }), who); list.append(el('li', null), all); }
    cell.append(list);
  }
  return cell;
}
const day = seconds => seconds ? new Date(seconds * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';

async function enter(session) {
  document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true;
  window.concert.session = session; window.concert.nav(session.role);
  if (session.role !== 'admin') { document.querySelector('header p').textContent = 'Only an administrator can see or change this page: at the manager PC, or from the camera network with an authenticator code once that is switched on (System › Logins).'; return; }
  document.querySelector('#users').hidden = false;
  await act(() => api('/api/users'));
}
document.querySelector('#login').onsubmit = async event => {
  event.preventDefault();
  try { await enter(await api('/api/login', { name: document.querySelector('#username').value, password: document.querySelector('#password').value })); } catch (error) { concert.fail(error); }
};
window.concert.resume().then(session => { if (session) enter(session); });

document.querySelector('#add').onsubmit = async event => {
  event.preventDefault();
  const name = document.querySelector('#add-name').value.trim(), role = document.querySelector('#add-role').value, password = document.querySelector('#add-password').value;
  const done = await act(() => api('/api/users', { name, role, ...(password ? { password } : {}) }), name);
  if (done) { document.querySelector('#add-name').value = ''; document.querySelector('#add-password').value = ''; if (password) result.textContent = `${name} added, with the password you typed.`; }
};

function label(user) { return user.name || (user.role === 'admin' ? 'The administrator (no name yet)' : user.role === 'operator' ? 'Operators’ shared password (no name yet)' : 'No name yet'); }

function draw() {
  const table = document.querySelector('#accounts');
  const head = el('tr'); for (const title of ['Name', 'Role', 'Logged in', 'Added', 'From the network', '']) head.append(el('th', title));
  table.replaceChildren(head);
  const admins = state.users.filter(u => u.role === 'admin').length;
  for (const user of state.users) {
    const row = el('tr'), who = label(user);
    const name = el('td', who); if (user.you) name.append(el('small', ' (you)'));
    if (!user.name) name.append(el('small', user.role === 'operator' ? ' Opened by the old operator password with no name: give it a name, or add each operator and remove it.' : ' Opened by its password with no name.', 'hint'));
    const role = el('td'), pick = document.createElement('select'); pick.setAttribute('aria-label', `Role of ${who}`);
    for (const [value, word] of Object.entries(state.roles)) { const option = el('option', word.charAt(0).toUpperCase() + word.slice(1)); option.value = value; option.selected = value === user.role; pick.append(option); }
    pick.disabled = user.role === 'admin' && admins === 1;
    if (pick.disabled) pick.title = 'The only administrator: make another administrator first';
    pick.onchange = async () => {
      const word = state.roles[pick.value];
      const less = ['admin', 'operator', 'tech', 'stage'].indexOf(pick.value) > ['admin', 'operator', 'tech', 'stage'].indexOf(user.role);
      if (!await concert.sure(`Give ${who} the ${word} role?${less ? '\nThis takes away rights at once: wherever they are logged in, they are logged down, or out where the new role does not open that page.' : ''}`, { danger: less })) { pick.value = user.role; return; }
      await act(() => api(`/api/users/${user.id}`, { role: pick.value }), who);
      if (user.you && pick.value !== 'admin') location.reload();
    };
    role.append(pick);
    const actions = el('td');
    const rename = el('button', user.name ? 'Rename' : 'Give a name'); rename.type = 'button';
    rename.onclick = async () => { const answer = await concert.ask({ title: `Name for ${who}`, fields: [{ name: 'name', label: 'Name', value: user.name }], ok: 'Save' }); if (answer) await act(() => api(`/api/users/${user.id}`, { name: answer.name }), answer.name); };
    const out = user.you ? 'Your other logins are logged out; this one stays.' : 'They are logged out everywhere.';
    const reset = el('button', 'Generate password'); reset.type = 'button';
    reset.onclick = async () => { if (await concert.sure(`Make a new password for ${who}?\nIt is shown here once. The present one stops working. ${out}`, { ok: 'Make one' })) await act(() => api(`/api/users/${user.id}`, { password: 'new' }), who); };
    const own = el('button', 'Type a password…'); own.type = 'button';
    own.onclick = async () => {
      const answer = await concert.ask({ title: `Password for ${who}`, text: `At least ${user.role === 'admin' ? 12 : 8} characters. ${out}`, fields: [{ name: 'password', label: 'Password', type: 'password', minLength: user.role === 'admin' ? 12 : 8 }], ok: 'Set' });
      if (answer && await act(() => api(`/api/users/${user.id}`, { password: answer.password }), who)) result.textContent = `Password set for ${who}.`;
    };
    const remove = el('button', 'Remove'); remove.type = 'button'; remove.className = 'danger'; remove.disabled = user.role === 'admin' && admins === 1;
    remove.onclick = async () => { if (await concert.sure(`Remove ${who}?\nThey can no longer log in, and are logged out everywhere now.`, { ok: 'Remove', danger: true })) { await act(() => api(`/api/users/${user.id}`, { remove: true }), who); if (user.you) location.reload(); } };
    actions.append(rename, reset, own, remove);
    row.append(name, role, el('td', user.logged_in ? `${user.logged_in} ${user.logged_in === 1 ? 'device' : 'devices'}` : '—'), el('td', day(user.since)), secondStep(user, who), actions);
    table.append(row);
  }
}
