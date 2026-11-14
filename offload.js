'use strict';
let csrf='', listing={}, cameras=[], working=false;
const selected=new Set(), samples=new Map(), result=document.querySelector('#result');
// This page's own look. The manager's pages allow no inline <style>, so the rules are added here as a stylesheet.
{const sheet=new CSSStyleSheet();sheet.replaceSync(`
#headline p { margin:6px 0; } #headline .notice-actions { display:inline-flex; flex-wrap:wrap; gap:2px; margin-left:4px; vertical-align:middle; }
#headline .notice-actions button { margin:2px; padding:6px 10px; }
#steps { list-style:none; padding:0; margin:12px 0; }
#steps > li { border-left:3px solid #3a5166; border-radius:4px; padding:4px 0 4px 10px; margin:6px 0; }
#steps > li.current { border-left-color:#ffd17a; background:#18232d; }
#steps .step-head { flex:1 1 100%; display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; }
#steps .step-head small { color:#b7c6d4; }
#steps .now { display:none; background:#ffd17a; color:#101820; border-radius:4px; padding:0 6px; font-size:.8rem; }
#steps > li.current .now { display:inline-block; }
#steps > li.later .step-head > span, #steps > li.later .step-head small { color:#8ea1b2; }
#steps > li.later button:not(.danger):not(:disabled) { background:transparent; border-color:#3a5166; color:#d4e0ea; }
#offload #steps .step { margin:0; }
#devices article h3, #jobs article h3 { margin:0 0 6px; overflow-wrap:anywhere; }
#result details { margin-top:6px; } #result summary { cursor:pointer; color:#8fcafa; }
@media (max-width: 700px) { #headline .notice-actions { display:flex; margin:4px 0 0; } }`);document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];}
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
function bytes(v){return Number.isFinite(v)?`${(v/1073741824).toFixed(2)} GiB`:'unknown';}
async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.detail||`HTTP ${r.status}`);return d;}
const activityLine=document.querySelector('#activity');
function gib(v){return v<1073741824?`${Math.round(v/1048576)} MiB`:`${(v/1073741824).toFixed(2)} GiB`;}
function span(seconds){if(!Number.isFinite(seconds))return 'unknown';const m=Math.ceil(seconds/60);return m>=60?`${Math.floor(m/60)} h ${m%60} min`:`${m} min`;}
const plural=(n,one,many=one+'s')=>`${n} ${n===1?one:many}`;
const nameOf=id=>cameras.find(c=>c.id===id)?.name||String(id).slice(0,8);
// What a reply means, said as a sentence: #result is read aloud, and a screen reader reading out JSON helps nobody.
function said(label,answer){
 const refused=list=>{const bad=list.filter(x=>x&&x.error);return bad.length?`; ${bad.length} refused: ${bad[0].error}${bad.length>1?' (and others, see Details)':''}`:'';};
 if(Array.isArray(answer))return answer.length?`${label}: done for ${plural(answer.filter(x=>!x?.error).length,'transfer')}${refused(answer)}.`:`${label}: nothing to do; no transfer was waiting for that.`;
 if(!answer||typeof answer!=='object')return `${label}: done.`;
 if(answer.cancelled)return `${label}: cancelled, nothing changed.`;
 if(Array.isArray(answer.results))return answer.results.length?`${label}: ${plural(answer.results.filter(x=>!x?.error).length,'recording')} accepted${refused(answer.results)}.`:`${label}: nothing to send; no recording matched.`;
 if(answer.expires)return `The offload window is open until ${new Date(answer.expires*1000).toLocaleTimeString()}. Close it before OBS records again.`;
 if(answer.state==='CLOSED')return 'The offload window is closed.';
 if(Array.isArray(answer.requested))return `Scan asked of ${answer.requested.map(nameOf).join(', ')||'no camera'}. Each camera answers when it can.`;
 if(Array.isArray(answer.moved))return `${plural(answer.moved.length,'copy','copies')} moved into ${answer.library}${answer.problems?.length?`; ${plural(answer.problems.length,'problem')}, see Details`:''}.`;
 if(answer.id&&answer.state)return `${label}: the transfer is now ${String(answer.state).toLowerCase()}${answer.cleanup&&answer.cleanup!=='NOT_REQUESTED'?`, cleanup ${String(answer.cleanup).toLowerCase()}`:''}.`;
 if(answer.library)return `Verified copies will be saved to ${answer.library}. ${answer.note||''}`.trim();
 return `${label}: done.`;}
function tellResult(sentence,answer){
 const parts=[node('span',sentence)];
 if(answer!==undefined){const fold=document.createElement('details');fold.append(node('summary','Details'),node('code',JSON.stringify(answer,null,2)));parts.push(fold);}
 result.replaceChildren(...parts);}
async function operation(fn,label='Request'){if(working)return;working=true;const started=Date.now();
 activityLine.hidden=false;activityLine.className='activity running';activityLine.replaceChildren(document.createElement('progress'),node('span',`${label}: working…`));
 let failed=null;try{const answer=await fn();tellResult(said(label,answer),answer);}catch(e){failed=e.message;tellResult(`${label} failed: ${e.message}`);}
 finally{working=false;activityLine.className=`activity ${failed?'failed':'done'}`;activityLine.replaceChildren(node('span',`${label}: ${failed?`failed — ${failed}`:'sent'} (${new Date().toLocaleTimeString()}, ${((Date.now()-started)/1000).toFixed(1)} s)`));await refresh();}}
async function enter(session){csrf=session.csrf;document.querySelector('#password').value='';document.querySelector('#login').hidden=true;document.querySelector('#offload').hidden=false;window.concert.session=session;window.concert.nav(session.role);window.concert.tabs(document.querySelector('#recordings-tabs'),window.concert.recordingTabs,'/offload');await refresh();setInterval(refresh,2000);}
document.querySelector('#login').onsubmit=async e=>{e.preventDefault();try{await enter(await api('/api/login',{name:document.querySelector('#username').value,password:document.querySelector('#password').value}));}catch(e){result.textContent=e.message;}};
window.concert.resume().then(session=>{if(session)enter(session);});
// A button drawn afresh on every refresh. Its key lets the keyboard's place survive the redraw (see redraw()).
function button(label,fn,{key=label,name}={}){const b=node('button',label);b.dataset.key=key;if(name)b.setAttribute('aria-label',name);b.onclick=()=>operation(fn,name||label);return b;}
// Swaps a section's contents, putting the keyboard back on the control with the same key, so Tab goes on from where it was.
function redraw(container,children){const had=container.contains(document.activeElement)?document.activeElement.dataset.key:null;
 container.replaceChildren(...children);if(had){const again=[...container.querySelectorAll('[data-key]')].find(e=>e.dataset.key===had);if(again&&!again.disabled)again.focus({preventScroll:true});}}
async function batch(action,filter){const outcomes=[];for(const j of listing.jobs.filter(filter)){try{outcomes.push(await api(`/api/offload/jobs/${encodeURIComponent(j.id)}/${action}`,{}));}catch(e){outcomes.push({job:j.id,error:e.message});}}return outcomes;}
function enqueue(records){return api('/api/offload/enqueue',{recordings:records.map(r=>({camera:r.camera,id:r.id}))});}
document.querySelector('#window').onclick=async ()=>{const minutes=Number(document.querySelector('#window-minutes').value);if(await concert.sure(`Confirm OBS production recording is stopped. Transfers may use camera Wi-Fi for the next ${minutes} minutes; close the window before recording again.`))operation(()=>api('/api/offload/window',{obs_recording_idle:true,minutes}),'Open offload window');};
document.querySelector('#library-form').onsubmit=e=>{e.preventDefault();const path=document.querySelector('#library-path').value;operation(async()=>{const saved=await api('/api/offload/library',{path});document.querySelector('#library-path').value=saved.library;return saved;},'Save folder');};
document.querySelector('#relocate').onclick=async ()=>{if(await concert.sure('Move every verified copy that is outside this folder into it, under its camera subfolder?'))operation(()=>api('/api/offload/library/relocate',{}),'Move existing copies');};
document.querySelector('#close-window').onclick=()=>operation(()=>api('/api/offload/window/close',{}),'Close offload window');
document.querySelector('#scan').onclick=()=>operation(()=>api('/api/offload/scan',{}),'Scan all cameras');
document.querySelector('#selected').onclick=()=>operation(()=>enqueue(listing.recordings.filter(r=>selected.has(`${r.camera}/${r.id}`))),'Queue selected recordings');
document.querySelector('#all').onclick=()=>operation(()=>enqueue(listing.recordings),'Queue all completed recordings');
for(const [id,action,filter] of [['pause','pause',j=>['UPLOADING','QUEUED'].includes(j.state)],['resume','resume',j=>j.state==='PAUSED'],['retry','retry',j=>j.state==='FAILED'],['verify','verify',j=>j.offset===JSON.parse(j.metadata).byte_count]])document.querySelector('#'+id).onclick=()=>operation(()=>batch(action,filter),document.querySelector('#'+id).textContent);
document.querySelector('#approve').onclick=async ()=>{if(await concert.sure('Approve deletion of selected verified originals? A second verified backup is recommended.'))operation(()=>batch('approve',j=>selected.has(`${j.camera}/${j.recording}`)&&j.state==='VERIFIED'),'Approve cleanup');};
// Test footage nobody wants: deleted on the camera with no copy made. Only recordings that have not been copied.
document.querySelector('#discard').onclick=async()=>{
 const uncopied=r=>!listing.jobs.some(j=>j.camera===r.camera&&j.recording===r.id&&['VERIFIED','DISCARDED'].includes(j.state));
 const chosen=listing.recordings.filter(r=>selected.has(`${r.camera}/${r.id}`)),doomed=chosen.filter(uncopied);
 if(!doomed.length){concert.tell(chosen.length?'Every selected recording has already been copied. Use Approve Cleanup for those.':'Tick the recordings to delete first.');return;}
 const name=r=>`${cameras.find(c=>c.id===r.camera)?.name||r.camera.slice(0,8)}: ${JSON.parse(r.metadata).filename}`;
 const total=doomed.reduce((n,r)=>n+JSON.parse(r.metadata).byte_count,0);
 const got=await concert.ask({title:'Delete from the cameras without copying',text:`DELETE ${doomed.length} recording${doomed.length===1?'':'s'} (${gib(total)}) from the cameras WITHOUT copying?\n\n${doomed.slice(0,12).map(r=>'  • '+name(r)).join('\n')}${doomed.length>12?`\n  … and ${doomed.length-12} more`:''}\n\nNo copy exists anywhere. This cannot be undone.${chosen.length>doomed.length?`\n(${chosen.length-doomed.length} selected recording(s) already copied are left alone.)`:''}\n\nType DELETE to go ahead.`,fields:[{name:'word',label:'Type DELETE to go ahead'}],ok:'Delete',danger:true});
 const typed=got?got.word:null;
 if(typed!=='DELETE'){if(typed!==null)concert.tell('Nothing deleted: the word typed was not DELETE.');return;}
 operation(()=>api('/api/offload/discard',{confirm:'DELETE',recordings:doomed.map(r=>({camera:r.camera,id:r.id}))}),'Delete from cameras without copying');};
document.querySelector('#cleanup').onclick=async ()=>{if(await concert.sure('Delete ONLY explicitly approved, verified originals from their cameras?'))operation(()=>batch('cleanup',j=>j.cleanup==='APPROVED'),'Clean verified originals');};
// A notice's button is the step's own button pressed for you: the same words, the same questions asked, off when it is off.
function pressFor(id){const own=document.querySelector('#'+id),b=node('button',own.textContent);b.type='button';b.dataset.key=`notice-${id}`;b.disabled=own.disabled;b.onclick=()=>own.click();return b;}
let saidBefore='';
async function refresh(){if(!csrf)return;try{
 listing=await api('/api/offload');const data=await api('/api/cameras');cameras=data.cameras;
 const open=listing.offload_window_until*1000>Date.now();
 document.querySelector('#capacity').textContent=`Destination: ${bytes(listing.destination.free_bytes)} free / ${bytes(listing.destination.total_bytes)} · Window ${open?`open until ${new Date(listing.offload_window_until*1000).toLocaleTimeString()}`:'closed'} · Cleanup ${listing.cleanup_enabled?'enabled':'disabled'}`;
 const field=document.querySelector('#library-path');if(document.activeElement!==field)field.value=listing.destination.root;
 const outside=listing.jobs.filter(j=>j.state==='VERIFIED'&&!(j.library_path||'').startsWith(listing.destination.root+'/')).length;
 document.querySelector('#relocate').hidden=!outside;document.querySelector('#relocate').textContent=`Move ${outside} existing cop${outside===1?'y':'ies'} here`;
 document.querySelector('#library-example').textContent=`${listing.destination.root}/${(cameras.find(c=>c.name)?.name||'Camera-1').replace(/[^A-Za-z0-9._-]+/g,'_')}/`;
 for(const id of ['approve','cleanup','discard'])document.querySelector('#'+id).disabled=!listing.cleanup_enabled;
 const size=list=>gib(list.reduce((n,x)=>n+JSON.parse(x.metadata).byte_count,0));
 const jobFor=r=>listing.jobs.find(j=>j.camera===r.camera&&j.recording===r.id&&j.state!=='CANCELLED');
 const whole=j=>j.offset===JSON.parse(j.metadata).byte_count, unchecked=j=>whole(j)&&!['VERIFIED','DISCARDED'].includes(j.state);
 // Forget ticks for recordings that are no longer listed, so the count stays true.
 const listed=new Set(listing.recordings.map(r=>`${r.camera}/${r.id}`));for(const key of [...selected])if(!listed.has(key))selected.delete(key);
 // One card per paired camera, with only the buttons that would do something for it now.
 const cards=[];
 for(const c of [...cameras].sort((a,b)=>(a.slot??99)-(b.slot??99))){const card=node('article','');card.append(node('h3',c.name||`Camera ${c.slot}`),node('p',`${c.online?'Online':'Offline'} · ${bytes(c.storage?.free_bytes)} free / ${bytes(c.storage?.total_bytes)} total`));
 const t=c.telemetry||{},mine=listing.jobs.filter(j=>j.camera===c.id),waiting=mine.filter(j=>['QUEUED','UPLOADING'].includes(j.state)).length,deleting=mine.filter(j=>j.cleanup==='REQUESTED').length,scanning=(listing.scans||[]).includes(c.id),pending=waiting||deleting||scanning;
 const capturing=t.recording||t.streaming||t.capture?.streamRequested;
 const blocker=!c.online?'camera is offline':t.locked_since_boot?'phone needs its screen lock entered once after restarting':capturing?'camera is streaming or recording':!open?'offload window is closed':null;
 const doing=node('p','');doing.className=`activity ${pending&&blocker?'failed':pending?'running':''}`;
 if(pending&&!blocker)doing.append(document.createElement('progress'));
 doing.append(node('span',pending&&blocker?`Waiting: ${blocker}. Pending: ${[waiting&&`${waiting} transfer(s)`,deleting&&`${deleting} cleanup(s)`,scanning&&'scan'].filter(Boolean).join(', ')}.`:`Camera reports: ${(t.offload_status==='Hashing finalized recordings'&&listing.scans&&!scanning)?'Idle (last scan finished)':t.offload_status||'no offload status'}${pending?` · pending: ${[waiting&&`${waiting} transfer(s)`,deleting&&`${deleting} cleanup(s)`,scanning&&'scan'].filter(Boolean).join(', ')}`:''}`));
 card.append(doing);
 const offer=(applies,label,fn)=>{if(applies)card.append(button(label,fn,{key:`${c.id}/${label}`,name:`${label}: ${c.name||c.slot}`}));};
 offer(!scanning,'Scan camera',()=>api('/api/offload/scan',{camera_ids:[c.id]}));
 offer(listing.recordings.some(r=>r.camera===c.id&&!jobFor(r)),'Offload completed',()=>enqueue(listing.recordings.filter(r=>r.camera===c.id)));
 offer(waiting,'Pause camera transfers',()=>batch('pause',j=>j.camera===c.id&&['UPLOADING','QUEUED'].includes(j.state)));
 offer(mine.some(j=>j.state==='PAUSED'),'Resume camera transfers',()=>batch('resume',j=>j.camera===c.id&&j.state==='PAUSED'));
 offer(mine.some(j=>j.state==='FAILED'),'Retry camera failures',()=>batch('retry',j=>j.camera===c.id&&j.state==='FAILED'));
 offer(mine.some(unchecked),'Verify camera files',()=>batch('verify',j=>j.camera===c.id&&whole(j)));
 offer(listing.cleanup_enabled&&mine.some(j=>j.state==='VERIFIED'&&selected.has(`${j.camera}/${j.recording}`)&&!['APPROVED','REQUESTED','DELETED'].includes(j.cleanup)),'Approve selected camera cleanup',async ()=>await concert.sure(`Approve deletion of selected verified originals on ${c.name}? A second verified backup is recommended.`)?batch('approve',j=>j.camera===c.id&&selected.has(`${j.camera}/${j.recording}`)&&j.state==='VERIFIED'):{cancelled:true});
 offer(listing.cleanup_enabled&&mine.some(j=>j.cleanup==='APPROVED'),'Clean approved camera originals',async ()=>await concert.sure(`Delete explicitly approved originals on ${c.name}?`)?batch('cleanup',j=>j.camera===c.id&&j.cleanup==='APPROVED'):{cancelled:true});
 cards.push(card);}
 redraw(document.querySelector('#devices'),cards);
 const rows=[];
 for(const error of listing.scan_errors||[])rows.push(node('p',`${nameOf(error.camera)} / ${error.recording}: ${error.error}`));
 const standing=r=>{const j=jobFor(r);return !j?'only on camera':j.state==='DISCARDED'?(j.cleanup==='FAILED'?'DELETE WITHOUT COPY FAILED':'being deleted from camera, not copied'):j.state==='FAILED'?'copy failed':j.state==='PAUSED'?'copy paused':j.state==='VERIFIED'?(j.cleanup==='REQUESTED'?'copied · deletion requested':j.cleanup==='APPROVED'?'copied · cleanup approved':'copied and verified'):'copying';};
 if(listing.recordings.length){const all=node('label','');all.className='select-all';const box=document.createElement('input');box.type='checkbox';box.id='select-all';box.dataset.key='select-all';
  box.checked=selected.size===listed.size;box.indeterminate=selected.size>0&&selected.size<listed.size;
  box.onchange=()=>{if(box.checked)for(const key of listed)selected.add(key);else selected.clear();refresh();};
  all.append(box,node('span',`Select all ${listed.size} · ${selected.size} selected${selected.size?` (${size(listing.recordings.filter(r=>selected.has(`${r.camera}/${r.id}`)))})`:''}`));rows.push(all);}
 for(const r of listing.recordings){const m=JSON.parse(r.metadata),key=`${r.camera}/${r.id}`;const label=node('label','');const check=document.createElement('input');check.type='checkbox';check.dataset.key=key;check.checked=selected.has(key);check.onchange=()=>{check.checked?selected.add(key):selected.delete(key);refresh();};label.append(check,node('span',`${nameOf(r.camera)}: ${m.filename} · ${bytes(m.byte_count)} · ${(m.duration_ms/1000).toFixed(1)}s · ${standing(r)}`));rows.push(label);}
 redraw(document.querySelector('#recordings'),rows);
 // One plain summary of where things stand, each line with the button it names.
 const lines=[];const say=(text,...presses)=>lines.push({text,presses});
 const uncopied=listing.recordings.filter(r=>!jobFor(r)),moving=listing.jobs.filter(j=>['QUEUED','UPLOADING'].includes(j.state)),failedJobs=listing.jobs.filter(j=>j.state==='FAILED'),paused=listing.jobs.filter(j=>j.state==='PAUSED'),checking=listing.jobs.filter(unchecked);
 const kept=listing.jobs.filter(j=>j.state==='VERIFIED'&&!['REQUESTED','DELETED'].includes(j.cleanup)&&listing.recordings.some(r=>r.camera===j.camera&&r.id===j.recording)),approved=kept.filter(j=>j.cleanup==='APPROVED'),deleting=listing.jobs.filter(j=>j.cleanup==='REQUESTED');
 const keptTicked=kept.some(j=>j.cleanup!=='APPROVED'&&selected.has(`${j.camera}/${j.recording}`));
 if(moving.length){if(open)say(`Copying ${moving.length} recording(s) from the cameras (${size(moving)}). Progress is under Transfer jobs.`);else say(`${moving.length} recording(s) are queued but the offload window is closed. Press “Open offload window”.`,'window');}
 if(uncopied.length)say(`${uncopied.length} recording(s) (${size(uncopied)}) are only on the cameras. Press “Offload All Completed Recordings”, or tick some and press “Offload Selected Recordings”.`,'all',...(listing.recordings.some(r=>selected.has(`${r.camera}/${r.id}`)&&!jobFor(r))?['selected']:[]));
 if(failedJobs.length)say(`${failedJobs.length} copy(ies) failed. Press “Retry Failed Transfers”.`,'retry');
 if(paused.length)say(`${paused.length} copy(ies) are paused. Press “Resume Transfers”.`,'resume');
 if(deleting.length){if(open)say(`${deleting.length} original(s) are waiting for their camera to delete them.`);else say(`${deleting.length} deletion(s) are waiting, but the offload window is closed. Press “Open offload window”.`,'window');}
 if(kept.length){if(!listing.cleanup_enabled)say(`${kept.length} recording(s) (${size(kept)}) are copied and verified; their originals are still on the cameras (cleanup is switched off).`);
  else if(approved.length===kept.length)say(`${kept.length} verified original(s) (${size(kept)}) are approved for deletion. Press “Clean Verified Originals”.`,'cleanup');
  else say(`${kept.length} recording(s) (${size(kept)}) are copied and verified; their originals still take space on the cameras. To free it: tick them under Available recordings, press “Approve Cleanup”, then “Clean Verified Originals”.`,'tick',...(keptTicked?['approve']:[]),...(approved.length?['cleanup']:[]));}
 if(open&&!moving.length&&!deleting.length&&!uncopied.length&&!failedJobs.length&&!paused.length)say('Nothing is being copied or deleted. Close the offload window before OBS records again.','close-window');
 if(!lines.length)say(listing.recordings.length?'Nothing waiting.':'No recordings are listed on the cameras. Press “Scan All Cameras” to look again.',...(listing.recordings.length?[]:['scan']));
 const headline=document.querySelector('#headline');headline.className=`activity ${moving.length&&open?'running':failedJobs.length||((moving.length||deleting.length)&&!open)?'failed':''}`;
 const ticks=kept.filter(j=>j.cleanup!=='APPROVED').map(j=>`${j.camera}/${j.recording}`).filter(k=>!selected.has(k));
 // Drawn again only when something in it changed: it is read aloud, and a redraw would repeat it every two seconds.
 const now=JSON.stringify([lines,ticks.length,['window','all','selected','retry','resume','cleanup','approve','close-window','scan'].map(id=>document.querySelector('#'+id).disabled)]);
 if(now!==saidBefore){saidBefore=now;redraw(headline,lines.map(({text,presses})=>{const p=node('p',text);const own=presses.map(id=>{
  if(id!=='tick')return pressFor(id);
  // Ticking is not deleting: it only marks the copied recordings, ready for Approve Cleanup.
  const b=node('button',ticks.length?`Tick the ${plural(ticks.length,'copied recording')}`:'All copied recordings are ticked');b.type='button';b.dataset.key='notice-tick';b.disabled=!ticks.length;b.onclick=()=>{for(const k of ticks)selected.add(k);refresh();};return b;});
  if(own.length){const row=node('span','');row.className='notice-actions';row.append(...own);p.append(' ',row);}return p;}));}
 // The four steps: the one to do now marked, the ones after it quieter, every button still there.
 const current=(moving.length||deleting.length)&&!open?'window':uncopied.length||failedJobs.length||paused.length||moving.length?'copy':checking.length?'check':kept.length&&listing.cleanup_enabled?'clean':open?'window':!listing.recordings.length?'copy':null;
 const order=['window','copy','check','clean'],at=order.indexOf(current);
 for(const li of document.querySelectorAll('#steps > li')){const i=order.indexOf(li.dataset.step);li.className=i===at?'current':at>=0&&i>at?'later':'';if(i===at)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}
 const verified=listing.jobs.filter(j=>j.state==='VERIFIED').length;
 document.querySelector('#state-window').textContent=open?`Open until ${new Date(listing.offload_window_until*1000).toLocaleTimeString()}${current==='window'?'; close it before OBS records again':''}`:'Closed';
 document.querySelector('#state-copy').textContent=[uncopied.length&&`${uncopied.length} only on the cameras`,moving.length&&`${moving.length} ${open?'copying':'queued'}`,failedJobs.length&&`${failedJobs.length} failed`,paused.length&&`${paused.length} paused`].filter(Boolean).join(' · ')||(listing.recordings.length?'Nothing left to copy':'Nothing listed yet: scan the cameras');
 document.querySelector('#state-check').textContent=`${verified} of ${plural(listing.jobs.filter(j=>j.state!=='DISCARDED').length,'copy','copies')} verified${checking.length?` · ${checking.length} waiting to be checked`:''}`;
 document.querySelector('#state-clean').textContent=!listing.cleanup_enabled?'Switched off on this manager':[kept.length&&`${plural(kept.length,'original')} can be freed`,approved.length&&`${approved.length} approved`,deleting.length&&`${deleting.length} being deleted`].filter(Boolean).join(' · ')||'Nothing to free';
 const jobCards=[];let total=0,sent=0,rate=0;for(const j of listing.jobs){const m=JSON.parse(j.metadata), old=samples.get(j.id), stamp=Date.now();const speed=old&&stamp>old.time?Math.max(0,j.offset-old.offset)/((stamp-old.time)/1000):0;samples.set(j.id,{offset:j.offset,time:stamp});const card=node('article','');const bar=document.createElement('progress');bar.max=m.byte_count;bar.value=j.offset;
 const going=j.state==='UPLOADING'&&speed>0,verifying=j.state==='UPLOADING'&&j.offset===m.byte_count,title=`${nameOf(j.camera)}: ${m.filename}`;
 const stage=j.state==='DISCARDED'?(j.cleanup==='DELETED'?'Deleted from camera without copying':j.cleanup==='FAILED'?'Camera refused to delete it':'Waiting for the camera to delete it (not copied)'):j.cleanup==='DELETED'?'Original deleted from camera':j.cleanup==='REQUESTED'?'Waiting for the camera to delete its original':j.cleanup==='APPROVED'?'Verified · cleanup approved, not yet requested':j.state==='VERIFIED'?'Verified':verifying?'Uploaded · verifying copy':j.state==='UPLOADING'?`Uploading ${(100*j.offset/m.byte_count).toFixed(1)}%${going?` · ${(speed/1048576).toFixed(1)} MiB/s · about ${span((m.byte_count-j.offset)/speed)} left`:''}`:j.state==='QUEUED'?'Queued · waiting for the camera':j.state;
 if(j.cleanup==='REQUESTED'||verifying)bar.removeAttribute('value');
 bar.setAttribute('aria-label',title);
 card.append(node('h3',title),bar,node('p',`${stage} · ${gib(j.offset)} of ${gib(m.byte_count)}`),node('small',`SHA-256 ${j.destination_hash===m.sha256?'matches':'pending/failed'} · Media ${j.media&&j.state==='VERIFIED'?'passed':'pending/failed'} · Cleanup ${j.cleanup||'not approved'}`));
 if(['QUEUED','UPLOADING','PAUSED'].includes(j.state)){total+=m.byte_count;sent+=j.offset;rate+=speed;}
 if(j.error)card.append(node('p',j.error));if(j.cleanup_result)card.append(node('p',`Cleanup result: ${j.cleanup_result}`));
 // Only what the manager would accept for this transfer now (offload.py action/verify).
 const can={pause:['QUEUED','UPLOADING'].includes(j.state),resume:j.state==='PAUSED',cancel:['QUEUED','UPLOADING','PAUSED','FAILED'].includes(j.state),retry:['FAILED','CANCELLED'].includes(j.state),verify:j.state!=='DISCARDED'&&j.offset===m.byte_count};
 const words={pause:'Pause',resume:'Resume',cancel:'Cancel',retry:'Retry',verify:j.state==='VERIFIED'?'Verify again':'Verify'};
 for(const a of ['pause','resume','cancel','retry','verify'])if(can[a])card.append(button(words[a],()=>api(`/api/offload/jobs/${j.id}/${a}`,{}),{key:`${j.id}/${a}`,name:`${words[a]} ${title}`}));
 jobCards.push(card);}
 redraw(document.querySelector('#jobs'),jobCards);
 const summary=document.querySelector('#summary');summary.replaceChildren();
 if(listing.jobs.length){const overall=document.createElement('progress');overall.max=Math.max(total,1);overall.value=total?sent:1;overall.setAttribute('aria-label','All transfers');
  summary.append(overall,node('p',`${verified} of ${listing.jobs.length} recordings verified${total?` · ${gib(sent)} of ${gib(total)} uploaded${rate>0?` · ${(rate/1048576).toFixed(1)} MiB/s · about ${span((total-sent)/rate)} left`:' · not moving right now'}`:' · nothing waiting to upload'}`));}
 }catch(e){result.textContent=e.message;}}
