'use strict';
// Actions that apply to every camera at once, for the dashboard's All cameras (app.js) and the Operate page's bar
// (operate.js): one set of rules, so the two never differ on which cameras an action touches and which it leaves alone.
// Each says exactly which cameras it will touch (targets) and why it leaves the others (skipped), and the page that
// runs it does nothing until the operator accepts the list.
(() => {
const armedNow = c => c.online && c.telemetry?.armed === true;
const streamingNow = c => !!(c.telemetry?.streaming || c.telemetry?.capture?.streamRequested);
// Only a phone still on app 0.7.6 that was armed on its own screen starts a recording along with its stream.
const recordsWithStream = c => !c.telemetry?.capabilities?.explicit_recording && c.telemetry?.armed === true && c.telemetry?.capture?.localRecordingWanted !== false && !c.telemetry?.recording;
// Every one of these is a command to a phone: a network camera (taken into OBS over NDI) takes none, and is neither
// a target nor something left out with a reason.
const phonesOnly = action => ({ ...action, targets: c => c.kind !== 'network' && action.targets(c), skipped: c => c.kind === 'network' ? null : action.skipped(c) });
const EVERY = [
  { label: 'Arm all cameras', command: 'camera.arm', step: 'arming', did: 'armed',
    // Arming never switches recording on. Phones on app 0.7.6 need to be told; 0.7.7 and later never record unasked.
    parameters: c => c.telemetry?.capabilities?.stream_only_arm ? { local_recording: false } : {},
    lead: n => `Arm ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Arming leaves a camera idle. Streaming and local recording are separate steps; neither starts by itself.',
    targets: c => c.online && c.telemetry?.armed === false && c.telemetry?.capabilities?.device_owner,
    skipped: c => !c.online ? (c.telemetry?.armed ? null : 'offline') : c.telemetry?.armed === false && !c.telemetry?.capabilities?.device_owner ? 'not device owner, so it must be armed on the phone' : null },
  { label: 'Start all streams', command: 'stream.start', step: 'starting the stream', did: 'started streaming on', preflight: true,
    lead: n => `Start the stream on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Each needs its OBS input listening. Starting a stream does not start recording on the phone, except on a camera marked with a warning above.',
    targets: c => armedNow(c) && !streamingNow(c),
    detail: c => recordsWithStream(c) ? 'WARNING: this one WILL ALSO START RECORDING; press Arm on its card first to turn that off' : null,
    skipped: c => !c.online ? 'offline' : c.telemetry?.armed === false ? 'not armed' : null },
  { label: 'Stop all streams', command: 'stream.stop', step: 'stopping the stream', did: 'stopped streaming on', danger: true,
    lead: n => `Stop the stream on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Their pictures will stop in OBS. Local recordings keep running.',
    targets: c => c.online && streamingNow(c),
    skipped: c => !c.online && streamingNow(c) ? 'offline; was streaming when last heard from' : null },
  { label: 'Start all recordings', command: 'recording.start', step: 'starting recording', did: 'started recording on', preflight: true,
    lead: n => `Start local recording on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Recording and streaming together runs two encoders and makes phones hotter.',
    targets: c => armedNow(c) && !c.telemetry?.recording,
    skipped: c => !c.online ? 'offline' : c.telemetry?.armed === false ? 'not armed' : null },
  { label: 'Stop all recordings', command: 'recording.stop', step: 'stopping recording', did: 'stopped recording on', danger: true,
    lead: n => `Stop local recording on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Each file is finalised. Streams to OBS keep running.',
    targets: c => c.online && !!c.telemetry?.recording,
    skipped: c => !c.online && c.telemetry?.recording ? 'offline; was recording when last heard from' : null },
  { label: 'Disarm all cameras', command: 'camera.disarm', step: 'disarming', did: 'disarmed', danger: true,
    lead: n => `Disarm ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Disarming stops the capture service: any stream stops and any recording is finalised. Unarmed cameras can take app updates. A camera that is not device owner must be armed again on the phone.',
    targets: c => armedNow(c),
    detail: c => [streamingNow(c) ? 'streaming' : null, c.telemetry?.recording ? 'RECORDING' : null, c.telemetry?.capabilities?.device_owner ? null : 'cannot be re-armed from here'].filter(Boolean).join(', ') || null,
    skipped: c => !c.online && c.telemetry?.armed ? 'offline; was armed when last heard from' : null },
];
const FLEET = EVERY.map(phonesOnly);
window.concertFleet = { FLEET, armedNow, streamingNow, recordsWithStream };
})();
