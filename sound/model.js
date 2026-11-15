/** Pure sequencer state, musical timing, and portable-file validation. */
export const ROWS = 9;
export const STEPS = 16;
export const SCALES = { minor: [12, 10, 7, 5, 3, 0], major: [12, 9, 7, 4, 2, 0] };
export const VOICES = ['pure', 'warm', 'bright'];
export const VOLUMES = { quiet: .22, medium: .38, full: .52 };
export const emptyPattern = () => Array.from({ length: ROWS }, () => Array(STEPS).fill(0));
export const clone = value => JSON.parse(JSON.stringify(value));
export const midiFrequency = midi => 440 * 2 ** ((midi - 69) / 12);
export function noteName(midi) { return ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][midi % 12] + (Math.floor(midi / 12) - 1); }
export function laneNames(state) { return [...SCALES[state.scale].map(n => noteName(state.root + n)), 'Kick', 'Snare', 'Hat']; }
export function stepDuration(step, tempo, swing) { return 60 / tempo / 4 * (1 + (step % 2 === 0 ? swing : -swing)); }
export function sequencePosition(state, step) { return { bank: state.chain ? Math.floor(step / STEPS) % 2 : state.editBank, column: step % STEPS }; }
export function loopDuration(state) { return 60 / state.tempo * 4 * (state.chain ? 2 : 1); }
export function soundingCells(state) { return (state.chain ? state.patterns : [state.patterns[state.editBank]]).reduce((sum, pattern) => sum + pattern.reduce((n, row, r) => n + (state.muted[r] ? 0 : row.filter(Boolean).length), 0), 0); }
export function validateState(input) {
  if (!input || typeof input !== 'object' || input.version !== 2) throw Error('Choose a Pattern Machine version 2 file.');
  const number = (key, low, high, integer = false) => { const n = input[key]; if (!Number.isFinite(n) || n < low || n > high || (integer && !Number.isInteger(n))) throw Error(`Invalid ${key}.`); return n; };
  if (typeof input.title !== 'string' || input.title.length > 48) throw Error('Invalid pattern name.');
  if (!Object.hasOwn(SCALES, input.scale) || !VOICES.includes(input.voice) || !Object.hasOwn(VOLUMES, input.volume)) throw Error('Invalid sound settings.');
  if (typeof input.chain !== 'boolean' || !Array.isArray(input.muted) || input.muted.length !== ROWS || input.muted.some(v => typeof v !== 'boolean')) throw Error('Invalid track settings.');
  if (!Array.isArray(input.patterns) || input.patterns.length !== 2 || input.patterns.some(p => !Array.isArray(p) || p.length !== ROWS || p.some(row => !Array.isArray(row) || row.length !== STEPS || row.some(v => ![0, 1, 2].includes(v))))) throw Error('A pattern must contain two 9 × 16 grids.');
  return { version: 2, title: input.title.trim() || 'Untitled loop', tempo: number('tempo', 50, 180, true), root: number('root', 48, 71, true), scale: input.scale, voice: input.voice, swing: number('swing', 0, .45), volume: input.volume, editBank: number('editBank', 0, 1, true), chain: input.chain, muted: [...input.muted], patterns: input.patterns.map(p => p.map(row => [...row])) };
}
const put = (p, row, steps, value = 1) => steps.forEach(step => p[row][step] = value);
export function preset(name = 'afterhours') {
  const state = { version: 2, title: 'After hours', tempo: 108, root: 60, scale: 'minor', voice: 'warm', swing: .16, volume: 'quiet', editBank: 0, chain: false, muted: Array(ROWS).fill(false), patterns: [emptyPattern(), emptyPattern()] };
  const a = state.patterns[0], b = state.patterns[1];
  if (name === 'daylight') {
    Object.assign(state, { title: 'Daylight', tempo: 122, scale: 'major', voice: 'pure', swing: 0 });
    [[5,[0,8]],[3,[2,10]],[2,[4,12]],[0,[6,14]]].forEach(([r, steps]) => put(a,r,steps));
    [[5,[0,8]],[4,[3]],[2,[4,10]],[1,[6,12]],[0,[14]]].forEach(([r, steps]) => put(b,r,steps));
  } else if (name === 'nightdrive') {
    Object.assign(state, { title: 'Night drive', tempo: 136, root: 57, voice: 'bright', swing: .08 });
    [[5,[0,3,8,11]],[3,[2,6,10]],[2,[4,12]],[1,[14]]].forEach(([r, steps]) => put(a,r,steps));
    [[5,[0,3,8]],[3,[2,6,10]],[2,[4,11]],[0,[12,14]]].forEach(([r, steps]) => put(b,r,steps));
  } else {
    [[5,[0,8]],[3,[3,10]],[2,[6,14]],[1,[7]]].forEach(([r, steps]) => put(a,r,steps));
    [[5,[0,8]],[4,[3]],[3,[6,11]],[2,[10]],[0,[14]]].forEach(([r, steps]) => put(b,r,steps));
  }
  for (const pattern of [a,b]) { put(pattern,6,[0,8],2); put(pattern,6,[11]); put(pattern,7,[4,12],2); put(pattern,8,[0,2,4,6,8,10,12,14]); }
  put(b,8,[15]);
  return state;
}
export function variedPattern(pattern, random = Math.random) {
  const next = pattern.map(row => [...row]);
  // Keep the pulse. Vary only a few melody notes and offbeat hats.
  for (let n = 0; n < 5; n++) { const r = Math.floor(random() * 6), c = Math.floor(random() * 16); next[r][c] = next[r][c] ? 0 : 1; }
  for (const c of [3,7,11,15]) if (random() > .45) next[8][c] = next[8][c] ? 0 : 1;
  return next;
}
/** Advance an audio-clock cursor. Delayed JS callbacks skip stale beats rather than bunching them. */
export function planSchedule(cursor, now, state, horizon = .12) {
  let time = cursor.time, step = cursor.step, skipped = 0;
  while (time < now + .005 && skipped < 1024) { time += stepDuration(step, state.tempo, state.swing); step++; skipped++; }
  if (time < now + .005) time = now + .03;
  const events = [];
  while (time < now + horizon && events.length < 64) {
    const duration = stepDuration(step, state.tempo, state.swing);
    events.push({ time, step, duration, ...sequencePosition(state, step) });
    time += duration; step++;
  }
  return { events, cursor: { time, step }, skipped };
}
export function encodeWav(channels, sampleRate) {
  if (!channels.length || channels.length > 2 || !Number.isInteger(sampleRate) || sampleRate < 8000 || channels.some(c => c.length !== channels[0].length)) throw Error('Invalid audio buffer.');
  const frames = channels[0].length, count = channels.length, buffer = new ArrayBuffer(44 + frames * count * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,36+frames*count*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*count*2,true);view.setUint16(32,count*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*count*2,true);
  let offset=44;
  for(let i=0;i<frames;i++)for(const channel of channels){const v=Number.isFinite(channel[i])?Math.max(-1,Math.min(1,channel[i])):0;view.setInt16(offset,Math.round(v*(v<0?32768:32767)),true);offset+=2;}
  return buffer;
}
