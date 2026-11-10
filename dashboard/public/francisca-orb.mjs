// Lightweight real-time Francisca visualizer: contour waves driven by TTS RMS.
// No network, framework, microphone access or stored voice data.
export const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:0));
export function contourRadius(angle,phase,intensity=0,ring=0){
 const v=clamp(intensity),wave=Math.sin(angle*5-phase*1.75)*.62+Math.sin(angle*8+phase*1.1)*.38;
 return 75+ring*8+v*(5+ring*4)+v*wave*(2.5+ring*1.45);
}
export function rmsIntensity(samples){
 if(!samples?.length)return 0;
 let sum=0;
 for(const value of samples){const d=(value-128)/128;sum+=d*d;}
 return clamp((Math.sqrt(sum/samples.length)-.012)*7.5);
}

const surfaces=new Map();
const audioSources=new Map();
let active=false,lastTime=0;
const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const stateFor={floating:'idle',training:'idle'};

function edge(ctx,radius,stroke,blur,width,phase,level,ring){
 ctx.beginPath();
 const count=128;
 for(let j=0;j<=count;j++){
  const angle=j/count*Math.PI*2;
  const rad=contourRadius(angle,phase,level,ring)+(radius-(75+ring*8));
  const px=120+Math.cos(angle)*rad,py=120+Math.sin(angle)*rad;
  if(j===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
 }
 ctx.closePath();
 ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.shadowBlur=blur;ctx.shadowColor=stroke;ctx.stroke();ctx.shadowBlur=0;
}
function paint(canvas,phase,amp,mode){
 const ctx=canvas.getContext('2d',{alpha:true});
 if(!ctx)return;
 // Internal 240px viewBox is scaled by CSS, high-DPI is resolved by the browser.
 if(canvas.width!==240)canvas.width=240;if(canvas.height!==240)canvas.height=240;
 ctx.clearRect(0,0,240,240);
 const halo=ctx.createRadialGradient(120,120,54,120,120,118);
 halo.addColorStop(0,'rgba(97,44,240,0)');halo.addColorStop(.64,'rgba(144,90,255,.10)');
 halo.addColorStop(.88,'rgba(122,69,255,.075)');halo.addColorStop(1,'rgba(111,66,255,0)');
 ctx.fillStyle=halo;ctx.beginPath();ctx.arc(120,120,118,0,Math.PI*2);ctx.fill();
 const core=ctx.createRadialGradient(89,83,5,125,137,81);
 core.addColorStop(0,'#d1fcff');core.addColorStop(.19,'#6bc6ff');
 core.addColorStop(.39,'#626bea');core.addColorStop(.67,'#6331c7');
 core.addColorStop(.91,'#230c63');core.addColorStop(1,'#120b35');
 ctx.shadowColor='rgba(100,58,245,.42)';ctx.shadowBlur=20+amp*24;
 ctx.fillStyle=core;ctx.beginPath();ctx.arc(120,120,72,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
 ctx.save();ctx.beginPath();ctx.arc(120,120,71,0,Math.PI*2);ctx.clip();
 const light=ctx.createLinearGradient(62,50,170,179);
 light.addColorStop(0,'rgba(255,255,255,.67)');light.addColorStop(.28,'rgba(255,255,255,.03)');
 light.addColorStop(1,'rgba(103,203,255,.09)');
 ctx.fillStyle=light;ctx.beginPath();ctx.ellipse(101,78,44,22,-.48,0,Math.PI*2);ctx.fill();
 // Transparent inner waveform retains the orb's fixed core silhouette.
 ctx.beginPath();
 for(let i=0;i<=96;i++){
  const x=63+i*114/96;
  const u=i/96,falloff=Math.pow(Math.sin(u*Math.PI),1.5);
  const y=123+falloff*(Math.sin(u*18-phase*3)*6+(mode==='speaking'?amp*16:2)*Math.sin(u*37+phase*2.6));
  if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
 }
 ctx.strokeStyle='rgba(142,238,255,.84)';ctx.lineWidth=1.6;ctx.shadowBlur=9;
 ctx.shadowColor='#91f0ff';ctx.stroke();ctx.shadowBlur=0;ctx.restore();
 const moving=mode==='speaking'?amp:mode==='hearing'?.22:mode==='listening'?.11:mode==='processing'?.08:0;
 edge(ctx,0,'rgba(214,251,255,.9)',10+moving*8,1.8,phase,moving,0);
 edge(ctx,0,'rgba(133,95,255,.8)',16+moving*13,2.2,phase+1.9,moving,1);
 edge(ctx,0,'rgba(93,202,255,.55)',18+moving*15,1.25,phase+3.2,moving,2);
 // A restrained perimeter accent that expands more than the inner sphere.
 const dots=mode==='speaking'?8:4;
 for(let i=0;i<dots;i++){
  const a=i*Math.PI*2/dots+phase*.23;
  const r=103+moving*9,px=120+Math.cos(a)*r,py=120+Math.sin(a)*r;
  ctx.fillStyle=i%2?'rgba(180,100,255,.38)':'rgba(104,216,255,.4)';
  ctx.beginPath();ctx.arc(px,py,1.1+moving*1.5,0,Math.PI*2);ctx.fill();
 }
}
function readLevel(scope){
 const track=audioSources.get(scope)||(scope==='training'?audioSources.get('floating'):null);
 if(!track||track.audio.ended||track.audio.paused)return 0;
 try{track.analyser.getByteTimeDomainData(track.samples);return rmsIntensity(track.samples);}catch{return 0;}
}
function frame(timestamp){
 if(typeof document==='undefined'||document.hidden){active=false;return;}
 // 30fps cap keeps mobile responsive; no layout reads during drawing.
 if(timestamp-lastTime<31){requestAnimationFrame(frame);return;}
 lastTime=timestamp;
 for(const [canvas,item] of surfaces){
  if(!canvas.isConnected){surfaces.delete(canvas);continue;}
  const state=stateFor[item.scope]||'idle';
  const loud=state==='speaking'?readLevel(item.scope):0;
  const target=state==='speaking'?loud:state==='hearing'?.13:0;
  item.level+= (target-item.level)*(target>item.level?.24:.11);
  const phase=reduced()?0:timestamp/1000;
  paint(canvas,phase,reduced()?0:item.level,state);
 }
 if(surfaces.size&&!reduced())requestAnimationFrame(frame);
 else active=false;
}
function run(){
 if(!active&&surfaces.size&&typeof requestAnimationFrame==='function'&&typeof document!=='undefined'&&!document.hidden){
  active=true;requestAnimationFrame(frame);
 }
}
export function syncFranciscaOrbs(next={}){
 Object.assign(stateFor,next);
 if(typeof document==='undefined')return;
 for(const canvas of document.querySelectorAll('canvas[data-francisca-orb]')){
  if(!surfaces.has(canvas))surfaces.set(canvas,{scope:canvas.dataset.franciscaOrb,level:0});
 }
 for(const c of surfaces.keys())if(!c.isConnected)surfaces.delete(c);
 if(reduced()){
  for(const [canvas,item] of surfaces)paint(canvas,0,0,stateFor[item.scope]||'idle');
 }else run();
}
export function attachFranciscaAudio(audio,scope){
 if(!audio||!['floating','training'].includes(scope))return false;
 detachFranciscaAudio(scope);
 if(typeof window==='undefined')return false;
 const AudioContextClass=window.AudioContext||window.webkitAudioContext;
 if(!AudioContextClass)return false;
 let ctx=null,source=null,analyser=null;
 try{
  ctx=new AudioContextClass();source=ctx.createMediaElementSource(audio);
  analyser=ctx.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=.7;
  source.connect(analyser);analyser.connect(ctx.destination);
  audioSources.set(scope,{audio,ctx,source,analyser,samples:new Uint8Array(analyser.fftSize)});
  Promise.resolve(ctx.resume()).catch(()=>{});
  run();
  return true;
 }catch(error){
  try{source?.disconnect();}catch{}
  try{ctx?.close();}catch{}
  return false;
 }
}
export function detachFranciscaAudio(scope){
 const track=audioSources.get(scope);audioSources.delete(scope);
 if(!track)return;
 try{track.source.disconnect();track.analyser.disconnect();}catch{}
 try{track.ctx.close();}catch{}
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden)run();});
