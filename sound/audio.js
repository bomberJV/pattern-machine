import { SCALES, VOLUMES, midiFrequency, loopDuration, sequencePosition, stepDuration, encodeWav } from './model.js';
const waves = new WeakMap(), noises = new WeakMap();
export function makeGraph(context, state, destination = context.destination, live = false) {
  const bus = context.createGain(), compressor = context.createDynamicsCompressor(), master = context.createGain();
  compressor.threshold.value=-14;compressor.knee.value=12;compressor.ratio.value=8;compressor.attack.value=.003;compressor.release.value=.15;
  bus.connect(compressor);compressor.connect(master);master.gain.value=VOLUMES[state.volume];
  const analyser = live ? context.createAnalyser() : null;
  if(analyser){analyser.fftSize=1024;analyser.smoothingTimeConstant=.75;master.connect(analyser);analyser.connect(destination);}else master.connect(destination);
  const tracks=Array.from({length:9},(_,r)=>{const gain=context.createGain();gain.gain.value=state.muted[r]?0:1;gain.connect(bus);return gain;});
  return {bus,master,analyser,tracks};
}
function periodic(context,voice){
  if(!waves.has(context))waves.set(context,new Map());const cache=waves.get(context);if(cache.has(voice))return cache.get(voice);
  const count=voice==='pure'?1:voice==='warm'?5:9, real=new Float32Array(count+1),imag=new Float32Array(count+1);
  for(let n=1;n<=count;n++)imag[n]=1/n**(voice==='bright'?1.25:2);
  const wave=context.createPeriodicWave(real,imag);cache.set(voice,wave);return wave;
}
function noise(context){
  if(noises.has(context))return noises.get(context);const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),data=buffer.getChannelData(0);let seed=1999;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2**31-1;}
  noises.set(context,buffer);return buffer;
}
function connectVoice(context,source,target,time,duration,peak,attack,cleanup,filter=null){
  const gain=context.createGain();gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),time+attack);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
  source.connect(filter||gain);if(filter)filter.connect(gain);gain.connect(target);source.start(time);source.stop(time+duration+.015);
  if(cleanup)cleanup.add(source);
  source.onended=()=>{source.disconnect();gain.disconnect();filter?.disconnect();cleanup?.delete(source);};
}
export function scheduleStep(context,graph,state,event,cleanup=null){
  const column=state.patterns[event.bank].map(row=>row[event.column]),polyphony=Math.max(1,column.slice(0,6).filter(Boolean).length);
  column.forEach((value,r)=>{
    if(!value||state.muted[r])return;const time=event.time,velocity=value===2?1:.68,target=graph.tracks[r];
    if(r<6){
      const osc=context.createOscillator();osc.frequency.value=midiFrequency(state.root+SCALES[state.scale][r]);osc.setPeriodicWave(periodic(context,state.voice));
      connectVoice(context,osc,target,time,Math.min(.5,event.duration*(state.voice==='warm'?1.65:1.05)),.17*velocity/Math.sqrt(polyphony),state.voice==='warm'?.014:.004,cleanup);
    }else if(r===6){
      const osc=context.createOscillator();osc.type='sine';osc.frequency.setValueAtTime(150,time);osc.frequency.exponentialRampToValueAtTime(48,time+.075);connectVoice(context,osc,target,time,.22,.55*velocity,.003,cleanup);
    }else{
      const source=context.createBufferSource();source.buffer=noise(context);const filter=context.createBiquadFilter();filter.type='highpass';filter.frequency.value=r===7?1100:6500;
      connectVoice(context,source,target,time,r===7?.13:.045,(r===7?.22:.09)*velocity,.002,cleanup,filter);
      if(r===7){const body=context.createOscillator();body.type='triangle';body.frequency.value=175;connectVoice(context,body,target,time,.09,.11*velocity,.002,cleanup);}
    }
  });
}
export async function renderWav(state){
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!Offline)throw Error('Offline audio rendering is unavailable in this browser.');
  const rate=44100,duration=loopDuration(state),frames=Math.round(duration*rate),context=new Offline(2,frames*3+rate,rate),graph=makeGraph(context,state),steps=state.chain?32:16;
  // Render three repetitions and extract the middle, keeping note tails across the loop seam.
  let time=0;
  for(let step=0;step<steps*3;step++){const event={time,step,duration:stepDuration(step,state.tempo,state.swing),...sequencePosition(state,step)};scheduleStep(context,graph,state,event);time+=event.duration;}
  const buffer=await context.startRendering(),channels=[0,1].map(c=>buffer.getChannelData(c).slice(frames,frames*2));
  return new Blob([encodeWav(channels,rate)],{type:'audio/wav'});
}
