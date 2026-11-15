import { canvasSize, safeLoad, safeSave } from '../shared/core.js';
import { ROWS, STEPS, VOLUMES, preset, clone, validateState, laneNames, noteName, emptyPattern, variedPattern, planSchedule, soundingCells, loopDuration } from './model.js';
import { makeGraph, scheduleStep, renderWav } from './audio.js';

const $ = selector => document.querySelector(selector);
const storageKey = 'brandon-pattern-machine-v2';
let state, recovered = false;
try { const saved = safeLoad(storageKey, null); state = saved ? validateState(saved) : preset(); recovered = !!saved; }
catch { state = preset(); }
const history = [], cells = [], trackButtons = [], headers = [];
let strength = 1, focus = { row: 5, column: 0 }, playing = false, starting = false, context = null, graph = null;
let clock = null, timer = null, startTicket = 0, frame = 0, queue = [], audible = null, lastVisual = 0;
const sources = new Set(), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const canvas = $('#wave'), surface = canvasSize(canvas), { ctx } = surface;
let waveform = null, spectrum = null;
const say = message => $('#sound-status').textContent = message;

function save() {
  const saved = safeSave(storageKey, state);
  $('#save-status').textContent = saved ? 'SAVED ON THIS DEVICE' : 'STORAGE UNAVAILABLE · EXPORT TO KEEP';
}
function remember() { history.push(clone(state)); if (history.length > 24) history.shift(); }
function change(mutator, message) { remember(); mutator(); renderState(); save(); if (message) say(message); }
function setCell(row, column, value) { change(() => state.patterns[state.editBank][row][column] = value); }
function cellValue(row, column) { return state.patterns[state.editBank][row][column]; }
function toggleCell(row, column, accent = false) { const value = accent ? 2 : strength; setCell(row, column, cellValue(row, column) === value ? 0 : value); }
function moveFocus(row, column) {
  cells[focus.row][focus.column].tabIndex = -1;
  focus = { row: Math.max(0, Math.min(ROWS - 1, row)), column: Math.max(0, Math.min(STEPS - 1, column)) };
  const button = cells[focus.row][focus.column]; button.tabIndex = 0; button.focus({ preventScroll: true });
  // Scroll only the grid, leaving the page and transport in place.
  const scroll = $('#grid-scroll'), left = button.offsetLeft - scroll.offsetLeft, right = left + button.offsetWidth;
  if (left < scroll.scrollLeft + 82) scroll.scrollLeft = Math.max(0, left - 90);
  else if (right > scroll.scrollLeft + scroll.clientWidth - 10) scroll.scrollLeft = right - scroll.clientWidth + 16;
}
function buildGrid() {
  const grid = $('#sequencer'), head = document.createElement('div'); head.className = 'step-row step-header'; head.setAttribute('role', 'row');
  const corner = document.createElement('span'); corner.className = 'track-heading'; corner.textContent = 'TRACK / MUTE'; corner.setAttribute('role', 'columnheader'); head.append(corner);
  for (let c = 0; c < STEPS; c++) { const h = document.createElement('span'); h.setAttribute('role', 'columnheader'); h.className = c % 4 === 0 ? 'beat-start' : ''; h.textContent = c % 4 === 0 ? String(c / 4 + 1) : '·'; h.setAttribute('aria-label', `Beat ${Math.floor(c / 4) + 1}, sixteenth ${c % 4 + 1}`); head.append(h); headers.push(h); }
  grid.append(head);
  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement('div'); row.className = `step-row${r >= 6 ? ' drum-row' : ''}${r === 6 ? ' first-drum' : ''}`; row.setAttribute('role', 'row');
    const label = document.createElement('div'); label.className = 'track-label'; label.setAttribute('role', 'rowheader');
    const mute = document.createElement('button'); mute.type = 'button'; mute.onclick = () => change(() => state.muted[r] = !state.muted[r], `${laneNames(state)[r]} ${state.muted[r] ? 'unmuted' : 'muted'}.`); label.append(mute); row.append(label); trackButtons.push(mute); cells[r] = [];
    for (let c = 0; c < STEPS; c++) {
      const wrap = document.createElement('div'); wrap.setAttribute('role', 'gridcell');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'step-cell' + (c % 4 === 0 ? ' beat-start' : ''); button.tabIndex = r === focus.row && c === focus.column ? 0 : -1;
      button.onclick = event => toggleCell(r, c, event.shiftKey);
      button.onfocus = () => { cells[focus.row]?.[focus.column]?.setAttribute('tabindex', '-1'); focus = { row: r, column: c }; button.tabIndex = 0; };
      button.onkeydown = event => {
        const delta = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
        if (delta) { event.preventDefault(); moveFocus(r + delta[0], c + delta[1]); }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); moveFocus(event.ctrlKey ? (event.key === 'Home' ? 0 : ROWS - 1) : r, event.key === 'Home' ? 0 : STEPS - 1); }
        else if (event.key.toLowerCase() === 'a') { event.preventDefault(); toggleCell(r, c, true); }
        else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (cellValue(r, c)) setCell(r, c, 0); }
      };
      cells[r][c] = button; wrap.append(button); row.append(wrap);
    }
    grid.append(row);
  }
}
function applyAudioSettings() {
  if (!graph || !context) return;
  const now = context.currentTime;
  graph.master.gain.cancelScheduledValues(now); graph.master.gain.setTargetAtTime(playing ? VOLUMES[state.volume] : 0, now, .015);
  graph.tracks.forEach((gain, r) => gain.gain.setTargetAtTime(state.muted[r] ? 0 : 1, now, .01));
}
function renderState() {
  const names = laneNames(state);
  for (let r = 0; r < ROWS; r++) {
    trackButtons[r].textContent = names[r]; trackButtons[r].setAttribute('aria-label', `${state.muted[r] ? 'Unmute' : 'Mute'} ${names[r]} track`); trackButtons[r].setAttribute('aria-pressed', state.muted[r]);
    trackButtons[r].closest('.step-row').classList.toggle('muted', state.muted[r]);
    for (let c = 0; c < STEPS; c++) { const value = cellValue(r, c), button = cells[r][c]; button.setAttribute('aria-pressed', value > 0); button.classList.toggle('accent', value === 2); button.setAttribute('aria-label', `${names[r]}, step ${c + 1}${value === 2 ? ', accented' : ''}`); }
  }
  $('#tempo').value = state.tempo; $('#loop-title').value = state.title; $('#root-note').value = state.root; $('#scale').value = state.scale;
  $('#swing b').textContent = state.swing === 0 ? 'Straight' : state.swing === .16 ? 'Light' : state.swing === .3 ? 'Loose' : `${Math.round(state.swing * 100)}%`;
  $('#swing').setAttribute('aria-label', `Swing: ${$('#swing b').textContent}. Change swing`);
  $('#volume b').textContent = state.volume[0].toUpperCase() + state.volume.slice(1); $('#volume').setAttribute('aria-label', `Output: ${state.volume}. Change output level`);
  document.querySelectorAll('[data-bank]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.bank === state.editBank));
  document.querySelectorAll('[data-voice]').forEach(b => b.setAttribute('aria-pressed', b.dataset.voice === state.voice));
  document.querySelectorAll('[data-strength]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.strength === strength));
  $('#chain').setAttribute('aria-pressed', state.chain); $('#chain span').textContent = state.chain ? 'CHAIN ON' : 'CHAIN OFF';
  $('#copy-bank').textContent = state.editBank ? 'Copy B → A' : 'Copy A → B'; $('#undo').disabled = !history.length;
  $('#note-count').textContent = `${soundingCells(state)} HITS / ${state.chain ? '2 BARS' : '1 BAR'}`;
  applyAudioSettings(); markPlayhead(); drawSignal();
}
function markPlayhead() {
  const selected = playing && audible && audible.bank === state.editBank ? audible.column : -1;
  cells.forEach(row => row.forEach((button, c) => button.classList.toggle('playhead', c === selected)));
  document.querySelectorAll('[data-bank]').forEach(b => b.classList.toggle('playing-bank', !!(playing && audible && +b.dataset.bank === audible.bank)));
  if (playing && audible) $('#position-label').textContent = `${audible.bank ? 'B' : 'A'} / BEAT ${Math.floor(audible.column / 4) + 1} · ${audible.column % 4 + 1}`;
  else $('#position-label').textContent = `${state.chain ? 'A → B' : state.editBank ? 'B' : 'A'} · ${state.chain ? 32 : 16} STEPS`;
}
function schedule() {
  if (!playing || !context || context.state !== 'running') return;
  const plan = planSchedule(clock, context.currentTime, state); clock = plan.cursor;
  if (plan.skipped) queue = queue.filter(event => event.time >= context.currentTime);
  for (const event of plan.events) { scheduleStep(context, graph, state, event, sources); queue.push(event); }
}
async function start() {
  if (starting) return;
  starting = true; const ticket = ++startTicket; $('#play-sound').disabled = true; $('#play-label').textContent = 'Starting…';
  try {
    const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw Error('Web Audio is unavailable.');
    if (!context || context.state === 'closed') {
      context = new Audio({ latencyHint: 'interactive' });
      context.onstatechange = () => { if (playing && context.state !== 'running') stop('Audio was interrupted. Press Play to resume.'); };
      graph = makeGraph(context, state, context.destination, true); graph.master.gain.value = 0;
      waveform = new Uint8Array(graph.analyser.fftSize); spectrum = new Uint8Array(graph.analyser.frequencyBinCount);
    }
    let timeout;
    try { await Promise.race([context.resume(), new Promise((_, reject) => timeout = setTimeout(() => reject(Error('Audio did not start.')), 3500))]); }
    finally { clearTimeout(timeout); }
    if (ticket !== startTicket || document.hidden) return;
    if (context.state !== 'running') throw Error('Audio is not running.');
    playing = true; audible = null; queue = []; clock = { time: context.currentTime + .06, step: 0 };
    applyAudioSettings(); schedule(); timer = setInterval(schedule, 25);
    $('#play-label').textContent = 'Stop loop'; $('#play-icon').textContent = '■'; $('#play-sound').setAttribute('aria-label', 'Stop loop'); $('#power-light').classList.add('on');
    $('#signal-label').textContent = 'LIVE / ' + state.title.toUpperCase().slice(0, 24); say('Playing. Edit the pads, mute a track, or try a different voice.');
    startDrawing();
  } catch { stop('Audio could not start in this browser. Try Play again, or compose and export a pattern without sound.'); }
  finally { starting = false; $('#play-sound').disabled = false; if (!playing) $('#play-label').textContent = 'Play loop'; }
}
function stop(message = 'Stopped. Your pattern is still here.') {
  ++startTicket; playing = false; clearInterval(timer); timer = null; queue = []; audible = null;
  if (context && graph) {
    const now = context.currentTime; graph.master.gain.cancelScheduledValues(now); graph.master.gain.setTargetAtTime(0, now, .007);
    sources.forEach(source => { try { source.stop(now + .035); } catch {} }); sources.clear();
  }
  $('#play-label').textContent = 'Play loop'; $('#play-icon').textContent = '▶︎'; $('#play-sound').setAttribute('aria-label', 'Play loop'); $('#power-light').classList.remove('on');
  $('#signal-label').textContent = 'READY / PRESS PLAY'; cancelAnimationFrame(frame); frame = 0; markPlayhead(); drawSignal(); say(message);
}
function drawSignal() {
  const { w, h } = surface; if (!w || !h || !ctx) return;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0b120d'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#90b07016'; ctx.lineWidth = 1;
  for (let x = 16; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 35); ctx.lineTo(x, h - 30); ctx.stroke(); }
  for (let y = 43; y < h - 25; y += 28) { ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y); ctx.stroke(); }
  const mid = h * .39, height = h * .2;
  if (playing && graph?.analyser) { graph.analyser.getByteTimeDomainData(waveform); graph.analyser.getByteFrequencyData(spectrum); }
  ctx.strokeStyle = playing ? '#d9f4a1' : '#60774a'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 16; x <= w - 16; x += 2) { const index = Math.floor((x - 16) / Math.max(1, w - 32) * (waveform?.length - 1 || 1)); const value = playing && waveform ? (waveform[index] - 128) / 128 : 0; const y = mid + value * height * 2; x === 16 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  ctx.stroke();
  const bars = Math.max(16, Math.min(48, Math.floor(w / 10))), barWidth = (w - 32) / bars;
  for (let i = 0; i < bars; i++) { let amplitude = 0; if (playing && spectrum) { const low = Math.floor((i / bars) ** 1.6 * Math.min(spectrum.length, 235)), high = Math.max(low + 1, Math.floor(((i + 1) / bars) ** 1.6 * Math.min(spectrum.length, 235))); for (let b = low; b < high; b++) amplitude = Math.max(amplitude, spectrum[b] / 255); } const barHeight = Math.max(1, amplitude * h * .26); ctx.fillStyle = i % 4 === 0 ? '#c89fb566' : '#a5cb7780'; ctx.fillRect(16 + i * barWidth, h - 30 - barHeight, Math.max(2, barWidth - 3), barHeight); }
}
function drawFrame(now) {
  frame = 0; if (!playing || document.hidden) return;
  let changed = false;
  while (queue.length && queue[0].time <= context.currentTime) { audible = queue.shift(); changed = true; }
  if (changed) markPlayhead();
  if (!reducedMotion.matches || now - lastVisual >= 250) { drawSignal(); lastVisual = now; }
  frame = requestAnimationFrame(drawFrame);
}
function startDrawing() { if (!frame && playing && !document.hidden) frame = requestAnimationFrame(drawFrame); }
new ResizeObserver(() => requestAnimationFrame(drawSignal)).observe(canvas);

$('#play-sound').onclick = () => playing ? stop() : start();
$('#undo').onclick = () => { if (!history.length) return; state = history.pop(); renderState(); save(); say('Last edit undone.'); };
$('#clear-sound').onclick = () => change(() => state.patterns[state.editBank] = emptyPattern(), 'Bar cleared. Undo brings it back.');
$('#shuffle-sound').onclick = () => change(() => { state.patterns[state.editBank] = variedPattern(state.patterns[state.editBank]); }, 'Changed a few notes. The kick and snare stay put. Undo if you liked it better before.');
$('#copy-bank').onclick = () => change(() => state.patterns[1 - state.editBank] = clone(state.patterns[state.editBank]), `Copied ${state.editBank ? 'B into A' : 'A into B'}.`);
$('#chain').onclick = () => change(() => state.chain = !state.chain, state.chain ? 'Looping the selected bar.' : 'Playing A, then B, on repeat.');
document.querySelectorAll('[data-bank]').forEach(button => button.onclick = () => { state.editBank = +button.dataset.bank; renderState(); save(); say(`Editing bar ${state.editBank ? 'B' : 'A'}.${state.chain ? ' Both bars are in the chain.' : ''}`); });
document.querySelectorAll('[data-strength]').forEach(button => button.onclick = () => { strength = +button.dataset.strength; renderState(); say(strength === 2 ? 'Accent mode. New hits will be louder.' : 'Normal mode.'); });
document.querySelectorAll('[data-voice]').forEach(button => button.onclick = () => change(() => state.voice = button.dataset.voice));
document.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => change(() => { const volume = state.volume; state = preset(button.dataset.preset); state.volume = volume; }, 'Starting loop loaded. Change whatever you like. Undo brings back your previous loop.'));
function tempo(value) { const parsed = Number(value); if (!Number.isFinite(parsed)) { $('#tempo').value = state.tempo; return; } const next = Math.max(50, Math.min(180, Math.round(parsed))); if (next === state.tempo) { $('#tempo').value = next; return; } change(() => state.tempo = next, `Tempo: ${next} beats per minute.`); }
$('#tempo').onchange = event => tempo(event.target.value); $('#tempo-down').onclick = () => tempo(state.tempo - 5); $('#tempo-up').onclick = () => tempo(state.tempo + 5);
let taps = [];
$('#tap-tempo').onclick = () => { const now = performance.now(); if (taps.length && now - taps.at(-1) > 2000) taps = []; taps.push(now); if (taps.length > 6) taps.shift(); if (taps.length > 1) tempo(60000 / ((taps.at(-1) - taps[0]) / (taps.length - 1))); else say('Keep tapping a steady pulse.'); };
$('#swing').onclick = () => change(() => { const options = [0, .16, .3]; state.swing = options[(options.indexOf(state.swing) + 1) % options.length]; });
$('#volume').onclick = () => change(() => { const options = Object.keys(VOLUMES); state.volume = options[(options.indexOf(state.volume) + 1) % options.length]; });
for (let midi = 48; midi <= 71; midi++) { const option = document.createElement('option'); option.value = midi; option.textContent = noteName(midi); $('#root-note').append(option); }
$('#root-note').onchange = event => change(() => state.root = +event.target.value); $('#scale').onchange = event => change(() => state.scale = event.target.value);
$('#loop-title').onchange = event => change(() => state.title = event.target.value.trim().slice(0, 48) || 'Untitled loop');
function filename() { return (state.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loop').slice(0, 48); }
function saveBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); }
$('#export-pattern').onclick = () => { saveBlob(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `pattern-machine-${filename()}.json`); $('#export-status').textContent = 'Pattern saved. Open it here later to keep editing.'; };
$('#import-pattern').onchange = async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 64000) throw Error('Choose a pattern file smaller than 64 KB.'); const next = validateState(JSON.parse(await file.text())); stop('Saved pattern opened. Press Play to hear it.'); change(() => state = next); $('#export-status').textContent = 'Pattern opened and saved on this device. Undo brings back your previous session.'; }
  catch (error) { $('#export-status').textContent = error instanceof SyntaxError ? 'That file is not valid JSON. Choose an exported Pattern Machine file.' : error.message || 'Could not open this pattern.'; }
  finally { event.target.value = ''; }
};
$('#export-wav').onclick = async () => {
  if (!soundingCells(state)) { $('#export-status').textContent = 'This loop is silent. Add some notes or unmute a track first.'; return; }
  const button = $('#export-wav'), copy = clone(state), name = filename(); button.disabled = true; button.textContent = 'Rendering audio…';
  try { const blob = await renderWav(copy); saveBlob(blob, `pattern-machine-${name}-${copy.tempo}bpm.wav`); $('#export-status').textContent = `Saved ${copy.chain ? 'two bars' : 'one bar'} as a ${loopDuration(copy).toFixed(2)}-second, 44.1 kHz WAV, including your sound, swing, muted tracks, and output level.`; }
  catch { $('#export-status').textContent = 'Audio export is unavailable in this browser. Save the editable pattern instead, or try another browser.'; }
  finally { button.disabled = false; button.textContent = 'Download audio .wav ↓'; }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (playing || starting)) stop('Playback stopped while you were away. Press Play to continue.'); });
addEventListener('pagehide', () => stop());
addEventListener('keydown', event => { if (event.key === 'Escape' && (playing || starting)) stop(); });
reducedMotion.addEventListener('change', drawSignal);
buildGrid(); renderState();
if (recovered) say('Your last loop is back. Press Play when you’re ready.');
