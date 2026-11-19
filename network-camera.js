'use strict';
// Adding a network camera: a camera that is not a phone, taken into OBS over NDI (netcams.py). The page asks its name,
// its slot and the NDI source it sends, offering the sources found (by OBS's plugin, or announced on the network).
const result = document.querySelector('#result'), trouble = document.querySelector('#trouble'), plugin = document.querySelector('#plugin');
const nameBox = document.querySelector('#camera-name'), slotBox = document.querySelector('#camera-slot'), ndiBox = document.querySelector('#ndi-name');
let csrf = '', latest = null;
function node(tag, text, name) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (name) e.className = name; return e; }
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Request failed (${r.status})`);
  return data;
}

function draw() {
  const said = latest;
  // Whether OBS can take NDI at all: said plainly, and never in the way of adding the camera.
  plugin.hidden = false;
  plugin.className = said.plugin ? 'activity done' : 'recording-warning';
  plugin.textContent = said.obs_problem ? `OBS could not be asked (${said.obs_problem}). The camera can be added now; its source is made once OBS is running.`
    : said.plugin ? 'OBS has the NDI plugin.' : `${said.requirement}. The camera can be added now; it stays not ready until then.`;
  // The slot: kept as chosen while the list is redrawn.
  const chosen = slotBox.value;
  slotBox.replaceChildren(...said.free_slots.map(slot => { const option = node('option', `Slot ${slot}`); option.value = slot; return option; }));
  if (said.free_slots.map(String).includes(chosen)) slotBox.value = chosen;
  document.querySelector('#slot-note').textContent = said.free_slots.length ? 'Its place among the cameras; any free one will do.'
    : `Every one of the ${said.camera_capacity} camera slots is taken: raise the camera slots on the System page, or remove a camera.`;
  document.querySelector('#add button').disabled = !said.free_slots.length;
  // The sources found, to choose from; typing the name always works.
  const found = document.querySelector('#found'); found.replaceChildren();
  if (said.sources.length) {
    found.append(node('p', said.found_by === 'obs' ? 'NDI sources OBS sees now:' : 'NDI sources announcing themselves on this network now:'));
    const list = node('ul');
    for (const source of said.sources) {
      const line = node('li'), pick = node('button', source.name); pick.type = 'button'; pick.disabled = source.taken;
      pick.onclick = () => { ndiBox.value = source.name; if (!nameBox.value.trim()) nameBox.focus(); };
      line.append(pick); if (source.taken) line.append(node('small', ' already a camera here'));
      list.append(line);
    }
    found.append(list);
  } else found.append(node('p', 'No NDI source was found on this network just now. Check the camera is on and has NDI switched on, or type its name below.'));
  const have = document.querySelector('#have'), list = document.querySelector('#have-list');
  have.hidden = !said.cameras.length;
  list.replaceChildren(...said.cameras.map(c => node('li', `${c.name} · slot ${c.slot} · ${c.ndi_name}`)));
}

async function refresh() {
  try { latest = await api('/api/network-cameras'); draw(); }
  catch (error) { concert.fail(error); }
}

document.querySelector('#add').onsubmit = async e => {
  e.preventDefault();
  try {
    const done = await api('/api/network-cameras', { name: nameBox.value, ndi_name: ndiBox.value, slot: Number(slotBox.value) });
    result.textContent = `${done.name} is added in slot ${done.slot}. Press “Refresh OBS scenes” on the Show page to make its source and scenes in OBS.`;
    nameBox.value = ''; ndiBox.value = '';
  } catch (error) { concert.fail(error); }
  refresh();
};

async function enter(session) {
  csrf = session.csrf; window.concert.session = session; window.concert.nav(session.role);
  document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#setup').hidden = false;
  if (session.role !== 'admin') { trouble.hidden = false; trouble.textContent = 'Cameras are added by an administrator.'; document.querySelector('#add').hidden = true; return; }
  await refresh();
  setInterval(() => { if (!document.hidden && document.activeElement?.tagName !== 'INPUT') refresh(); }, 5000);
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { name: document.querySelector('#username').value, password: document.querySelector('#password').value })); }
  catch (error) { concert.fail(error); }
};
window.concert.resume().then(session => { if (session) enter(session); });
